/**
 * ERC404BondingInstance Adapter
 *
 * Extends ERC404Adapter with bonding-specific functionality:
 * - Staking operations
 * - Bonding lifecycle management
 * - Liquidity deployment
 * - Advanced pricing/supply queries
 * - Tier management
 * - NFT reroll operations
 * - Owner configuration functions
 */

import ERC404Adapter from './ERC404Adapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

class ERC404BondingInstanceAdapter extends ERC404Adapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC404Bonding', ethersProvider, signer);
    }

    /**
     * Initialize the adapter - load bonding-specific ABI
     * @override
     */
    async initialize() {
        try {
            // Check if we have a mock provider
            const isMockProvider = this.provider && this.provider.isMock === true;

            if (isMockProvider) {
                this.initialized = true;
                this.isMock = true;
                eventBus.emit('contract:adapter:initialized', {
                    contractAddress: this.contractAddress,
                    contractType: this.contractType,
                    isMock: true
                });
                return true;
            }

            // Validate provider
            if (!this.signer && !this.provider) {
                throw new Error('No provider or signer available for contract initialization');
            }

            // Load ERC404BondingInstance ABI (includes all ERC404 + bonding methods)
            const abi = await loadABI('ERC404BondingInstance');

            // Initialize main contract
            this.contract = new this.ethers.Contract(
                this.contractAddress,
                abi,
                this.signer || this.provider
            );

            // Initialize mirror contract (from parent)
            try {
                const mirrorAddress = await this.contract.mirrorERC721();
                const mirrorAbiResponse = await fetch('/EXEC404/mirrorabi.json');
                if (mirrorAbiResponse.ok) {
                    const mirrorABI = await mirrorAbiResponse.json();
                    this.mirrorContract = new this.ethers.Contract(
                        mirrorAddress,
                        mirrorABI,
                        this.signer || this.provider
                    );
                }
            } catch (error) {
                console.warn('[ERC404BondingInstanceAdapter] Mirror contract not available:', error);
            }

            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, 'ERC404BondingInstanceAdapter initialization failed');
        }
    }

    // =========================
    // Staking Operations
    // =========================

    /**
     * Stake tokens
     * @param {string} amount - Amount to stake (in wei)
     * @returns {Promise<Object>} Transaction receipt
     */
    async stake(amount) {
        try {
            eventBus.emit('transaction:pending', { type: 'stake', contractAddress: this.contractAddress });

            const receipt = await this.executeContractCall(
                'stake',
                [amount],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'stake',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance', 'staking');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'stake',
                error: this.wrapError(error, 'Staking failed'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Unstake tokens
     * @param {string} amount - Amount to unstake (in wei)
     * @returns {Promise<Object>} Transaction receipt
     */
    async unstake(amount) {
        try {
            eventBus.emit('transaction:pending', { type: 'unstake', contractAddress: this.contractAddress });

            const receipt = await this.executeContractCall(
                'unstake',
                [amount],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'unstake',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('balance', 'staking');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'unstake',
                error: this.wrapError(error, 'Unstaking failed'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Claim staking rewards
     * @returns {Promise<Object>} Transaction receipt
     */
    async claimStakerRewards() {
        try {
            eventBus.emit('transaction:pending', { type: 'claimStakerRewards', contractAddress: this.contractAddress });

            const receipt = await this.executeContractCall(
                'claimStakerRewards',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'claimStakerRewards',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('staking', 'balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'claimStakerRewards',
                error: this.wrapError(error, 'Claiming rewards failed'),
                contractAddress: this.contractAddress
            });
            throw error;
        }
    }

    /**
     * Calculate pending staking rewards for address
     * @param {string} stakerAddress - Staker address
     * @returns {Promise<string>} Pending rewards in wei
     */
    async calculatePendingRewards(stakerAddress) {
        return await this.getCachedOrFetch('calculatePendingRewards', [stakerAddress], async () => {
            const rewards = await this.executeContractCall('calculatePendingRewards', [stakerAddress]);
            return rewards.toString();
        });
    }

    /**
     * Get staking info for address
     * @param {string} userAddress - User address
     * @returns {Promise<Object>} Staking information
     */
    async getStakingInfo(userAddress) {
        return await this.getCachedOrFetch('getStakingInfo', [userAddress], async () => {
            const info = await this.executeContractCall('getStakingInfo', [userAddress]);
            return {
                stakedAmount: this.ethers.utils.formatUnits(info.stakedAmount || info[0], 18),
                stakingTimestamp: parseInt((info.stakingTimestamp || info[1]).toString()),
                pendingRewards: this.ethers.utils.formatUnits(info.pendingRewards || info[2], 18),
                lastClaimTimestamp: parseInt((info.lastClaimTimestamp || info[3]).toString())
            };
        });
    }

    /**
     * Get global staking stats
     * @returns {Promise<Object>} Global staking statistics
     */
    async getStakingStats() {
        return await this.getCachedOrFetch('getStakingStats', [], async () => {
            const stats = await this.executeContractCall('getStakingStats');
            return {
                totalStaked: this.ethers.utils.formatUnits(stats.totalStaked || stats[0], 18),
                totalStakers: parseInt((stats.totalStakers || stats[1]).toString()),
                rewardRate: this.ethers.utils.formatUnits(stats.rewardRate || stats[2], 18),
                isEnabled: stats.isEnabled !== undefined ? stats.isEnabled : stats[3]
            };
        });
    }

    // =========================
    // Bonding Lifecycle
    // =========================

    /**
     * Set bonding open time (owner only)
     * @param {number} timestamp - Unix timestamp
     * @returns {Promise<Object>} Transaction receipt
     */
    async setBondingOpenTime(timestamp) {
        try {
            const receipt = await this.executeContractCall(
                'setBondingOpenTime',
                [timestamp],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('bonding');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set bonding open time');
        }
    }

    /**
     * Set bonding maturity time (owner only)
     * @param {number} timestamp - Unix timestamp
     * @returns {Promise<Object>} Transaction receipt
     */
    async setBondingMaturityTime(timestamp) {
        try {
            const receipt = await this.executeContractCall(
                'setBondingMaturityTime',
                [timestamp],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('bonding');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set bonding maturity time');
        }
    }

    /**
     * Set bonding active state (owner only)
     * @param {boolean} active - Active state
     * @returns {Promise<Object>} Transaction receipt
     */
    async setBondingActive(active) {
        try {
            const receipt = await this.executeContractCall(
                'setBondingActive',
                [active],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('bonding');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set bonding active state');
        }
    }

    /**
     * Check if liquidity can be deployed permissionlessly
     * @returns {Promise<boolean>} True if permissionless deployment is allowed
     */
    async canDeployPermissionless() {
        return await this.executeContractCall('canDeployPermissionless');
    }

    // =========================
    // Liquidity Deployment
    // =========================

    /**
     * Deploy liquidity to Uniswap V4 (owner or permissionless)
     * @param {number} poolFee - Pool fee tier
     * @param {number} tickSpacing - Tick spacing
     * @param {string} amountToken - Token amount
     * @param {string} amountETH - ETH amount
     * @param {string} sqrtPriceX96 - Initial price (sqrt format)
     * @returns {Promise<Object>} Transaction receipt
     */
    async deployLiquidity(poolFee, tickSpacing, amountToken, amountETH, sqrtPriceX96) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'deployLiquidity',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'deployLiquidity',
                [poolFee, tickSpacing, amountToken, amountETH, sqrtPriceX96],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'deployLiquidity',
                receipt,
                contractAddress: this.contractAddress
            });

            contractCache.invalidateByPattern('liquidity', 'bonding', 'phase');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'deployLiquidity',
                error: this.wrapError(error, 'Liquidity deployment failed')
            });
            throw error;
        }
    }

    // =========================
    // Pricing & Supply Info
    // =========================

    /**
     * Get comprehensive pricing information
     * @param {string} amount - Amount to calculate pricing for
     * @returns {Promise<Object>} Pricing information
     */
    async getPricingInfo(amount) {
        const info = await this.executeContractCall('getPricingInfo', [amount]);
        return {
            cost: this.ethers.utils.formatEther(info.cost || info[0]),
            refund: this.ethers.utils.formatEther(info.refund || info[1]),
            currentPrice: this.ethers.utils.formatEther(info.currentPrice || info[2]),
            priceImpact: parseFloat((info.priceImpact || info[3]).toString()) / 10000 // basis points to decimal
        };
    }

    /**
     * Get bonding status
     * @returns {Promise<Object>} Bonding status information
     */
    async getBondingStatus() {
        return await this.getCachedOrFetch('getBondingStatus', [], async () => {
            const status = await this.executeContractCall('getBondingStatus');
            return {
                isActive: status.isActive !== undefined ? status.isActive : status[0],
                openTime: parseInt((status.openTime || status[1]).toString()),
                maturityTime: parseInt((status.maturityTime || status[2]).toString()),
                currentPhase: parseInt((status.currentPhase || status[3]).toString()),
                hasLiquidity: status.hasLiquidity !== undefined ? status.hasLiquidity : status[4]
            };
        });
    }

    /**
     * Get bonding curve parameters
     * @returns {Promise<Object>} Bonding curve configuration
     */
    async getBondingCurveParams() {
        return await this.getCachedOrFetch('getBondingCurveParams', [], async () => {
            const params = await this.executeContractCall('getBondingCurveParams');
            return {
                basePrice: this.ethers.utils.formatEther(params.basePrice || params[0]),
                k: (params.k || params[1]).toString(),
                maxSupply: this.ethers.utils.formatUnits(params.maxSupply || params[2], 18),
                liquidityReservePercent: parseInt((params.liquidityReservePercent || params[3]).toString())
            };
        });
    }

    /**
     * Get liquidity information
     * @returns {Promise<Object>} Liquidity details
     */
    async getLiquidityInfo() {
        return await this.getCachedOrFetch('getLiquidityInfo', [], async () => {
            const info = await this.executeContractCall('getLiquidityInfo');
            return {
                liquidityPool: info.liquidityPool || info[0],
                tokenReserve: this.ethers.utils.formatUnits(info.tokenReserve || info[1], 18),
                ethReserve: this.ethers.utils.formatEther(info.ethReserve || info[2]),
                lpTokenBalance: this.ethers.utils.formatUnits(info.lpTokenBalance || info[3], 18)
            };
        });
    }

    /**
     * Get supply information
     * @returns {Promise<Object>} Supply details
     */
    async getSupplyInfo() {
        return await this.getCachedOrFetch('getSupplyInfo', [], async () => {
            const info = await this.executeContractCall('getSupplyInfo');
            return {
                totalSupply: this.ethers.utils.formatUnits(info.totalSupply || info[0], 18),
                bondingSupply: this.ethers.utils.formatUnits(info.bondingSupply || info[1], 18),
                liquiditySupply: this.ethers.utils.formatUnits(info.liquiditySupply || info[2], 18),
                maxSupply: this.ethers.utils.formatUnits(info.maxSupply || info[3], 18)
            };
        });
    }

    // =========================
    // Tier Management
    // =========================

    /**
     * Get tier configuration summary
     * @returns {Promise<Object>} Tier configuration
     */
    async getTierConfigSummary() {
        return await this.getCachedOrFetch('getTierConfigSummary', [], async () => {
            const summary = await this.executeContractCall('getTierConfigSummary');
            return {
                totalTiers: parseInt((summary.totalTiers || summary[0]).toString()),
                currentTier: parseInt((summary.currentTier || summary[1]).toString()),
                tiers: summary.tiers || summary[2] || []
            };
        });
    }

    /**
     * Get user tier information
     * @param {string} userAddress - User address
     * @returns {Promise<Object>} User's tier details
     */
    async getUserTierInfo(userAddress) {
        return await this.getCachedOrFetch('getUserTierInfo', [userAddress], async () => {
            const info = await this.executeContractCall('getUserTierInfo', [userAddress]);
            return {
                currentTier: parseInt((info.currentTier || info[0]).toString()),
                hasAccess: info.hasAccess !== undefined ? info.hasAccess : info[1],
                volumePurchased: this.ethers.utils.formatUnits(info.volumePurchased || info[2], 18),
                tierUnlockTime: parseInt((info.tierUnlockTime || info[3]).toString())
            };
        });
    }

    /**
     * Check if user can access tier
     * @param {string} userAddress - User address
     * @param {string} passwordHash - Password hash (bytes32)
     * @returns {Promise<boolean>} True if user can access tier
     */
    async canAccessTier(userAddress, passwordHash) {
        return await this.executeContractCall('canAccessTier', [userAddress, passwordHash]);
    }

    /**
     * Get tier password hash
     * @param {number} tierIndex - Tier index
     * @returns {Promise<string>} Password hash (bytes32)
     */
    async getTierPasswordHash(tierIndex) {
        return await this.getCachedOrFetch('getTierPasswordHash', [tierIndex], async () => {
            return await this.executeContractCall('getTierPasswordHash', [tierIndex]);
        });
    }

    /**
     * Get tier volume cap
     * @param {number} tierIndex - Tier index
     * @returns {Promise<string>} Volume cap in tokens
     */
    async getTierVolumeCap(tierIndex) {
        return await this.getCachedOrFetch('getTierVolumeCap', [tierIndex], async () => {
            const cap = await this.executeContractCall('getTierVolumeCap', [tierIndex]);
            return this.ethers.utils.formatUnits(cap, 18);
        });
    }

    /**
     * Get tier unlock time
     * @param {number} tierIndex - Tier index
     * @returns {Promise<number>} Unix timestamp
     */
    async getTierUnlockTime(tierIndex) {
        return await this.getCachedOrFetch('getTierUnlockTime', [tierIndex], async () => {
            const time = await this.executeContractCall('getTierUnlockTime', [tierIndex]);
            return parseInt(time.toString());
        });
    }

    // =========================
    // NFT Reroll Operations
    // =========================

    /**
     * Reroll selected NFTs
     * @param {string} tokenAmount - Amount of tokens to use for reroll
     * @param {Array<number>} exemptedNFTIds - NFT IDs to exempt from reroll
     * @returns {Promise<Object>} Transaction receipt
     */
    async rerollSelectedNFTs(tokenAmount, exemptedNFTIds = []) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'rerollSelectedNFTs',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'rerollSelectedNFTs',
                [tokenAmount, exemptedNFTIds],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'rerollSelectedNFTs',
                receipt,
                contractAddress: this.contractAddress
            });

            contractCache.invalidateByPattern('balance', 'nft', 'reroll');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'rerollSelectedNFTs',
                error: this.wrapError(error, 'NFT reroll failed')
            });
            throw error;
        }
    }

    /**
     * Get reroll escrow balance for user
     * @param {string} userAddress - User address
     * @returns {Promise<string>} Escrow balance in tokens
     */
    async getRerollEscrow(userAddress) {
        return await this.getCachedOrFetch('getRerollEscrow', [userAddress], async () => {
            const escrow = await this.executeContractCall('getRerollEscrow', [userAddress]);
            return this.ethers.utils.formatUnits(escrow, 18);
        });
    }

    // =========================
    // Owner Functions
    // =========================

    /**
     * Set contract style (CSS) (owner only)
     * @param {string} styleUri - URI to style CSS
     * @returns {Promise<Object>} Transaction receipt
     */
    async setStyle(styleUri) {
        try {
            const receipt = await this.executeContractCall(
                'setStyle',
                [styleUri],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('style');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set style');
        }
    }

    /**
     * Get contract style URI
     * @returns {Promise<string>} Style URI
     */
    async getStyle() {
        return await this.getCachedOrFetch('getStyle', [], async () => {
            return await this.executeContractCall('getStyle');
        });
    }

    /**
     * Set Uniswap V4 hook address (owner only)
     * @param {string} hookAddress - Hook contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setV4Hook(hookAddress) {
        try {
            const receipt = await this.executeContractCall(
                'setV4Hook',
                [hookAddress],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('hook');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set V4 hook');
        }
    }

    /**
     * Set vault address (owner only)
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setVault(vaultAddress) {
        try {
            const receipt = await this.executeContractCall(
                'setVault',
                [vaultAddress],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('vault');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set vault');
        }
    }

    /**
     * Enable staking (owner only)
     * @returns {Promise<Object>} Transaction receipt
     */
    async enableStaking() {
        try {
            const receipt = await this.executeContractCall(
                'enableStaking',
                [],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('staking');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to enable staking');
        }
    }

    /**
     * Withdraw dust/small amounts (owner only)
     * @param {string} amount - Amount to withdraw
     * @returns {Promise<Object>} Transaction receipt
     */
    async withdrawDust(amount) {
        try {
            const receipt = await this.executeContractCall(
                'withdrawDust',
                [amount],
                { requiresSigner: true }
            );

            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to withdraw dust');
        }
    }

    // =========================
    // Override Metadata
    // =========================

    /**
     * Get contract metadata
     * @override
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        const baseMetadata = await super.getMetadata();
        const bondingStatus = await this.getBondingStatus();
        const stakingStats = await this.getStakingStats();

        return {
            ...baseMetadata,
            bondingStatus,
            stakingEnabled: stakingStats.isEnabled,
            totalStaked: stakingStats.totalStaked
        };
    }
}

export default ERC404BondingInstanceAdapter;
