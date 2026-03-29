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

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,       // 1 hour (name, symbol, addresses)
    CONTRACT_DATA: 5 * 60 * 1000, // 5 minutes (reserve, supply stats)
    REALTIME: 30 * 1000,          // 30 seconds (bonding status)
};

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
                this.provider
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
                        this.provider
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
     * Contract returns: (isConfigured, isActive, isEnded, openTime, currentSupply, maxBondingSupply, availableSupply, currentReserve)
     * @returns {Promise<Object>} Bonding status information
     */
    async getBondingStatus() {
        return await this.getCachedOrFetch('getBondingStatus', [], async () => {
            // Use individual contract getters (no aggregate getBondingStatus on contract)
            const [isActive, openTime, maturityTime, reserveWei, currentSupplyWei, maxSupplyWei, isGraduated] = await Promise.all([
                this.executeContractCall('bondingActive').catch(() => false),
                this.executeContractCall('bondingOpenTime').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('bondingMaturityTime').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('reserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('maxSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('graduated').catch(() => false)
            ]);

            const openTimeValue = parseInt(openTime.toString());
            const maturityTimeValue = parseInt(maturityTime.toString());
            const currentReserve = this.ethers.utils.formatEther(reserveWei);
            const currentSupply = this.ethers.utils.formatUnits(currentSupplyWei, 18);
            const maxBondingSupply = this.ethers.utils.formatUnits(maxSupplyWei, 18);

            // Compute currentPhase for component compatibility
            let currentPhase = 0;
            const now = Math.floor(Date.now() / 1000);
            if (isGraduated) {
                currentPhase = 4; // Liquidity Deployed
            } else if (maturityTimeValue > 0 && now >= maturityTimeValue) {
                currentPhase = 3; // Matured
            } else if (isActive && openTimeValue > 0 && now >= openTimeValue) {
                currentPhase = 2; // Active Bonding
            } else if (isActive) {
                currentPhase = 1; // Early Bonding (configured but not yet open)
            }

            return {
                isConfigured: isActive,
                isActive,
                isEnded: isGraduated,
                hasLiquidity: isGraduated,
                openTime: openTimeValue,
                maturityTime: maturityTimeValue,
                currentPhase,
                currentSupply,
                maxBondingSupply,
                availableSupply: (parseFloat(maxBondingSupply) - parseFloat(currentSupply)).toString(),
                currentReserve
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
    /**
     * Get supply information
     * Contract returns: (maxSupply, liquidityReserve, maxBondingSupply, currentBondingSupply, availableBondingSupply, totalERC20Supply)
     */
    async getSupplyInfo() {
        return await this.getCachedOrFetch('getSupplyInfo', [], async () => {
            // Use individual contract getters (no aggregate getSupplyInfo on contract)
            const [maxSupplyWei, totalBondingWei, totalSupplyWei, liquidityReserveWei] = await Promise.all([
                this.executeContractCall('maxSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('liquidityReserve').catch(() => this.ethers.BigNumber.from(0))
            ]);

            const maxSupply = this.ethers.utils.formatUnits(maxSupplyWei, 18);
            const liquidityReserve = this.ethers.utils.formatUnits(liquidityReserveWei, 18);
            const currentBondingSupply = this.ethers.utils.formatUnits(totalBondingWei, 18);
            const totalERC20Supply = this.ethers.utils.formatUnits(totalSupplyWei, 18);
            // maxBondingSupply = maxSupply - liquidityReserve
            const maxBondingSupply = (parseFloat(maxSupply) - parseFloat(liquidityReserve)).toString();
            const availableBondingSupply = (parseFloat(maxBondingSupply) - parseFloat(currentBondingSupply)).toString();

            return {
                maxSupply,
                liquidityReserve,
                maxBondingSupply,
                currentBondingSupply,
                availableBondingSupply,
                totalERC20Supply,
                totalSupply: totalERC20Supply,
                bondingSupply: currentBondingSupply
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
     * Set NFT token base URI (owner only)
     * @param {string} uri - Base URI; tokenURI(id) returns this + tokenId
     * @returns {Promise<Object>} Transaction receipt
     */
    async setMetadataURI(uri) {
        try {
            const receipt = await this.executeContractCall(
                'setMetadataURI',
                [uri],
                { requiresSigner: true }
            );
            contractCache.invalidateByPattern('metadataURI');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set metadata URI');
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
     * Get NFT token base URI
     * @returns {Promise<string>} Current token base URI
     */
    async metadataURI() {
        return await this.getCachedOrFetch('metadataURI', [], async () => {
            return await this.executeContractCall('metadataURI');
        });
    }

    /**
     * Migrate vault to a new address (owner only)
     * @param {string} vaultAddress - New vault contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async migrateVault(vaultAddress) {
        try {
            const receipt = await this.executeContractCall(
                'migrateVault',
                [vaultAddress],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('vault');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to migrate vault');
        }
    }

    /**
     * Activate staking (owner only, irreversible)
     * @returns {Promise<Object>} Transaction receipt
     */
    async activateStaking() {
        try {
            const receipt = await this.executeContractCall(
                'activateStaking',
                [],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('staking');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to activate staking');
        }
    }

    /**
     * Claim all accumulated fees from vaults (owner only)
     * If staking is active, fees are routed to the staking module.
     * @returns {Promise<Object>} Transaction receipt
     */
    async claimAllFees() {
        try {
            const receipt = await this.executeContractCall(
                'claimAllFees',
                [],
                { requiresSigner: true }
            );

            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to claim fees');
        }
    }

    // =========================
    // Public Constants & State Variables
    // =========================

    /**
     * Get liquidity reserve constant
     * @returns {Promise<string>} Liquidity reserve amount in wei
     */
    async LIQUIDITY_RESERVE() {
        return await this.getCachedOrFetch('LIQUIDITY_RESERVE', [], async () => {
            const reserve = await this.executeContractCall('LIQUIDITY_RESERVE');
            return reserve.toString();
        });
    }

    /**
     * Get max supply constant
     * @returns {Promise<string>} Max supply in wei
     */
    async MAX_SUPPLY() {
        return await this.getCachedOrFetch('MAX_SUPPLY', [], async () => {
            const supply = await this.executeContractCall('MAX_SUPPLY');
            return supply.toString();
        });
    }

    /**
     * Get bonding active status
     * @returns {Promise<boolean>} True if bonding is active
     */
    async bondingActive() {
        return await this.getCachedOrFetch('bondingActive', [], async () => {
            return await this.executeContractCall('bondingActive');
        });
    }

    /**
     * Get bonding maturity time
     * @returns {Promise<number>} Unix timestamp when bonding matures
     */
    async bondingMaturityTime() {
        return await this.getCachedOrFetch('bondingMaturityTime', [], async () => {
            const time = await this.executeContractCall('bondingMaturityTime');
            return parseInt(time.toString());
        });
    }

    /**
     * Get bonding open time
     * @returns {Promise<number>} Unix timestamp when bonding opens
     */
    async bondingOpenTime() {
        return await this.getCachedOrFetch('bondingOpenTime', [], async () => {
            const time = await this.executeContractCall('bondingOpenTime');
            return parseInt(time.toString());
        });
    }

    /**
     * Get curve parameters
     * @returns {Promise<Object>} Bonding curve parameters
     */
    async curveParams() {
        return await this.getCachedOrFetch('curveParams', [], async () => {
            const params = await this.executeContractCall('curveParams');
            return {
                a: params.a?.toString() || params[0]?.toString(),
                b: params.b?.toString() || params[1]?.toString(),
                c: params.c?.toString() || params[2]?.toString()
            };
        });
    }

    /**
     * Get token decimals
     * @returns {Promise<number>} Number of decimals
     */
    async decimals() {
        return await this.getCachedOrFetch('decimals', [], async () => {
            const dec = await this.executeContractCall('decimals');
            return parseInt(dec.toString());
        });
    }

    /**
     * Get free mint status
     * @returns {Promise<boolean>} True if free mint is available
     */
    async freeMint() {
        return await this.getCachedOrFetch('freeMint', [], async () => {
            return await this.executeContractCall('freeMint');
        });
    }

    /**
     * Get free supply amount
     * @returns {Promise<string>} Free supply in wei
     */
    async freeSupply() {
        return await this.getCachedOrFetch('freeSupply', [], async () => {
            const supply = await this.executeContractCall('freeSupply');
            return supply.toString();
        });
    }

    /**
     * Get factory address
     * @returns {Promise<string>} Factory contract address
     */
    async factory() {
        return await this.getCachedOrFetch('factory', [], async () => {
            return await this.executeContractCall('factory');
        });
    }

    /**
     * Get global message registry address
     * @returns {Promise<string>} Global message registry contract address
     */
    async getGlobalMessageRegistry() {
        return await this.getCachedOrFetch('getGlobalMessageRegistry', [], async () => {
            return await this.executeContractCall('getGlobalMessageRegistry');
        });
    }

    /**
     * Get liquidity pool address
     * @returns {Promise<string>} Liquidity pool address
     */
    async liquidityPool() {
        return await this.getCachedOrFetch('liquidityPool', [], async () => {
            // Contract doesn't have liquidityPool(); use graduated status
            const isGraduated = await this.executeContractCall('graduated').catch(() => false);
            if (isGraduated) {
                // Return a non-zero address to indicate liquidity is deployed
                return this.contractAddress;
            }
            return '0x0000000000000000000000000000000000000000';
        });
    }

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async masterRegistry() {
        return await this.getCachedOrFetch('masterRegistry', [], async () => {
            return await this.executeContractCall('masterRegistry');
        });
    }

    /**
     * Get mirror ERC721 contract address
     * @returns {Promise<string>} Mirror ERC721 contract address
     */
    async mirrorERC721() {
        return await this.getCachedOrFetch('mirrorERC721', [], async () => {
            return await this.executeContractCall('mirrorERC721');
        });
    }

    /**
     * Get token name
     * @returns {Promise<string>} Token name
     */
    async name() {
        return await this.getCachedOrFetch('name', [], async () => {
            return await this.executeContractCall('name');
        });
    }

    /**
     * Get reroll escrow for address
     * @param {string} userAddress - User address
     * @returns {Promise<string>} Reroll escrow amount in wei
     */
    async rerollEscrow(userAddress) {
        return await this.getCachedOrFetch('rerollEscrow', [userAddress], async () => {
            const escrow = await this.executeContractCall('rerollEscrow', [userAddress]);
            return escrow.toString();
        });
    }

    /**
     * Get reserve amount
     * @returns {Promise<string>} Reserve amount in wei
     */
    async reserve() {
        return await this.getCachedOrFetch('reserve', [], async () => {
            const res = await this.executeContractCall('reserve');
            return res.toString();
        });
    }

    /**
     * Get staked balance for address
     * @param {string} userAddress - User address
     * @returns {Promise<string>} Staked balance in wei
     */
    async stakedBalance(userAddress) {
        return await this.getCachedOrFetch('stakedBalance', [userAddress], async () => {
            const balance = await this.executeContractCall('stakedBalance', [userAddress]);
            return balance.toString();
        });
    }

    /**
     * Get staker fees already claimed
     * @param {string} stakerAddress - Staker address
     * @returns {Promise<string>} Fees already claimed in wei
     */
    async stakerFeesAlreadyClaimed(stakerAddress) {
        return await this.getCachedOrFetch('stakerFeesAlreadyClaimed', [stakerAddress], async () => {
            const fees = await this.executeContractCall('stakerFeesAlreadyClaimed', [stakerAddress]);
            return fees.toString();
        });
    }

    /**
     * Get staking enabled status
     * @returns {Promise<boolean>} True if staking is enabled
     */
    async stakingEnabled() {
        return await this.getCachedOrFetch('stakingEnabled', [], async () => {
            return await this.executeContractCall('stakingActive');
        });
    }

    /**
     * Get style URI
     * @returns {Promise<string>} Style URI
     */
    async styleUri() {
        return await this.getCachedOrFetch('styleUri', [], async () => {
            return await this.executeContractCall('styleUri');
        });
    }

    /**
     * Get token symbol
     * @returns {Promise<string>} Token symbol
     */
    async symbol() {
        return await this.getCachedOrFetch('symbol', [], async () => {
            return await this.executeContractCall('symbol');
        });
    }

    /**
     * Get tier by password hash
     * @param {string} passwordHash - Password hash
     * @returns {Promise<number>} Tier index
     */
    async tierByPasswordHash(passwordHash) {
        return await this.getCachedOrFetch('tierByPasswordHash', [passwordHash], async () => {
            const tier = await this.executeContractCall('tierByPasswordHash', [passwordHash]);
            return parseInt(tier.toString());
        });
    }

    /**
     * Get tier configuration
     * @param {number} tierIndex - Tier index
     * @returns {Promise<Object>} Tier configuration
     */
    async tierConfig(tierIndex) {
        return await this.getCachedOrFetch('tierConfig', [tierIndex], async () => {
            const config = await this.executeContractCall('tierConfig', [tierIndex]);
            return {
                volumeCap: config.volumeCap?.toString() || config[0]?.toString(),
                unlockTime: parseInt((config.unlockTime || config[1])?.toString()),
                isActive: config.isActive !== undefined ? config.isActive : config[2]
            };
        });
    }

    /**
     * Get tier count
     * @returns {Promise<number>} Number of tiers
     */
    async tierCount() {
        return await this.getCachedOrFetch('tierCount', [], async () => {
            const count = await this.executeContractCall('tierCount');
            return parseInt(count.toString());
        });
    }

    /**
     * Get total bonding supply
     * @returns {Promise<string>} Total bonding supply in wei
     */
    async totalBondingSupply() {
        return await this.getCachedOrFetch('totalBondingSupply', [], async () => {
            const supply = await this.executeContractCall('totalBondingSupply');
            return supply.toString();
        });
    }

    /**
     * Get total fees accumulated from vault
     * @returns {Promise<string>} Total fees in wei
     */
    async totalFeesAccumulatedFromVault() {
        return await this.getCachedOrFetch('totalFeesAccumulatedFromVault', [], async () => {
            const fees = await this.executeContractCall('totalFeesAccumulatedFromVault');
            return fees.toString();
        });
    }

    /**
     * Get total staked amount
     * @returns {Promise<string>} Total staked in wei
     */
    async totalStaked() {
        return await this.getCachedOrFetch('totalStaked', [], async () => {
            const staked = await this.executeContractCall('totalStaked');
            return staked.toString();
        });
    }

    /**
     * Get total supply
     * @returns {Promise<string>} Total supply in wei
     */
    async totalSupply() {
        return await this.getCachedOrFetch('totalSupply', [], async () => {
            const supply = await this.executeContractCall('totalSupply');
            return supply.toString();
        });
    }

    /**
     * Get user purchase volume
     * @param {string} userAddress - User address
     * @returns {Promise<string>} Purchase volume in wei
     */
    async userPurchaseVolume(userAddress) {
        return await this.getCachedOrFetch('userPurchaseVolume', [userAddress], async () => {
            const volume = await this.executeContractCall('userPurchaseVolume', [userAddress]);
            return volume.toString();
        });
    }

    /**
     * Get user tier unlocked status
     * @param {string} userAddress - User address
     * @param {number} tierIndex - Tier index
     * @returns {Promise<boolean>} True if tier is unlocked for user
     */
    async userTierUnlocked(userAddress, tierIndex) {
        return await this.getCachedOrFetch('userTierUnlocked', [userAddress, tierIndex], async () => {
            return await this.executeContractCall('userTierUnlocked', [userAddress, tierIndex]);
        });
    }

    /**
     * Get V4 hook address
     * @returns {Promise<string>} V4 hook contract address
     */
    async v4Hook() {
        return await this.getCachedOrFetch('v4Hook', [], async () => {
            return await this.executeContractCall('v4Hook');
        });
    }

    /**
     * Get V4 pool manager address
     * @returns {Promise<string>} V4 pool manager contract address
     */
    async v4PoolManager() {
        return await this.getCachedOrFetch('v4PoolManager', [], async () => {
            return await this.executeContractCall('v4PoolManager');
        });
    }

    /**
     * Get vault address
     * @returns {Promise<string>} Vault contract address
     */
    async vault() {
        return await this.getCachedOrFetch('vault', [], async () => {
            return await this.executeContractCall('vault');
        });
    }

    /**
     * Get WETH address
     * @returns {Promise<string>} WETH contract address
     */
    async weth() {
        return await this.getCachedOrFetch('weth', [], async () => {
            return await this.executeContractCall('weth');
        });
    }

    /**
     * Get contract owner address
     * @returns {Promise<string>} Owner address
     */
    async owner() {
        return await this.getCachedOrFetch('owner', [], async () => {
            return await this.executeContractCall('owner');
        });
    }

    async transferOwnership(newOwner) {
        const receipt = await this.executeContractCall('transferOwnership', [newOwner], { requiresSigner: true });
        contractCache.invalidateByPattern('owner');
        return receipt;
    }

    async renounceOwnership() {
        const receipt = await this.executeContractCall('renounceOwnership', [], { requiresSigner: true });
        contractCache.invalidateByPattern('owner');
        return receipt;
    }

    // =========================
    // Additional Query Functions
    // =========================

    /**
     * Calculate cost to buy tokens
     * @param {string} amount - Amount to buy in wei
     * @returns {Promise<string>} Cost in ETH (wei)
     */
    /**
     * Get current price per token in ETH
     * Overrides parent which calls non-existent calculateCost on contract
     */
    async getCurrentPrice() {
        if (this.isMock) return 0.1;
        return await this.getCachedOrFetch('getCurrentPrice', [], async () => {
            const [reserveWei, totalBondingWei] = await Promise.all([
                this.executeContractCall('reserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0))
            ]);
            if (totalBondingWei.isZero()) return 0;
            // Average price = reserve / totalBondingSupply
            const priceWei = reserveWei.mul(this.ethers.constants.WeiPerEther).div(totalBondingWei);
            return parseFloat(this.ethers.utils.formatEther(priceWei));
        });
    }

    /**
     * Calculate cost to buy tokens
     * @param {string} amount - Amount to buy in wei
     * @returns {Promise<string>} Cost in ETH (wei)
     */
    async calculateCost(amount) {
        return await this.getCachedOrFetch('calculateCost', [amount], async () => {
            // Approximate: use reserve / totalBondingSupply as average price
            const [reserveWei, totalBondingWei] = await Promise.all([
                this.executeContractCall('reserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0))
            ]);
            if (totalBondingWei.isZero()) return '0';
            const cost = reserveWei.mul(this.ethers.BigNumber.from(amount)).div(totalBondingWei);
            return cost.toString();
        });
    }

    /**
     * Calculate refund from selling tokens
     * @param {string} amount - Amount to sell in wei
     * @returns {Promise<string>} Refund in ETH (wei)
     */
    async calculateRefund(amount) {
        return await this.getCachedOrFetch('calculateRefund', [amount], async () => {
            // Approximate: use reserve / totalBondingSupply as average price
            const [reserveWei, totalBondingWei] = await Promise.all([
                this.executeContractCall('reserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0))
            ]);
            if (totalBondingWei.isZero()) return '0';
            const refund = reserveWei.mul(this.ethers.BigNumber.from(amount)).div(totalBondingWei);
            return refund.toString();
        });
    }

    /**
     * Get project metadata including volume and supply stats
     * Contract returns: (name, symbol, maxSupply, liquidityReserve, totalBondingSupply,
     *                    reserve, bondingOpenTime, bondingActive, liquidityPool,
     *                    factory, v4Hook, weth, styleUri)
     * @returns {Promise<Object>} Project metadata with stats
     */
    async getProjectMetadata() {
        return await this.getCachedOrFetch('getProjectMetadata', [], async () => {
            const [name, symbol, maxSupply, liquidityReserve, totalBondingSupply,
                   reserve, bondingOpenTime, bondingActive, graduated] = await Promise.all([
                this.executeContractCall('name').catch(() => ''),
                this.executeContractCall('symbol').catch(() => ''),
                this.executeContractCall('maxSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('liquidityReserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('totalBondingSupply').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('reserve').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('bondingOpenTime').catch(() => this.ethers.BigNumber.from(0)),
                this.executeContractCall('bondingActive').catch(() => false),
                this.executeContractCall('graduated').catch(() => false)
            ]);
            return {
                name,
                symbol,
                maxSupply,
                liquidityReserve,
                totalBondingSupply,
                reserve,
                bondingOpenTime,
                bondingActive,
                liquidityPool: graduated ? this.contractAddress : '0x0000000000000000000000000000000000000000',
                factory: '',
                v4Hook: '',
                weth: '',
                styleUri: ''
            };
        }, CACHE_TTL.CONTRACT_DATA);
    }

    /**
     * Get project name
     * @returns {Promise<string>} Project name
     */
    async getProjectName() {
        return await this.getCachedOrFetch('getProjectName', [], async () => {
            return await this.executeContractCall('getProjectName');
        });
    }

    /**
     * Get project symbol
     * @returns {Promise<string>} Project symbol
     */
    async getProjectSymbol() {
        return await this.getCachedOrFetch('getProjectSymbol', [], async () => {
            return await this.executeContractCall('getProjectSymbol');
        });
    }

    /**
     * Get skip NFT status for user
     * @param {string} userAddress - User address
     * @returns {Promise<boolean>} True if user is skipping NFT minting
     */
    async getSkipNFT(userAddress) {
        return await this.getCachedOrFetch('getSkipNFT', [userAddress], async () => {
            return await this.executeContractCall('getSkipNFT', [userAddress]);
        });
    }

    // =========================
    // State-Changing Functions
    // =========================

    /**
     * Buy tokens via bonding curve
     * @param {string} amount - Amount of tokens to buy (in wei)
     * @param {string} maxCost - Maximum cost willing to pay in ETH (in wei)
     * @param {boolean} mintNFT - Whether to mint NFT
     * @param {string} passwordHash - Optional password hash for tier access
     * @param {string} message - Optional message
     * @returns {Promise<Object>} Transaction receipt
     */
    async buyBonding(amount, maxCost, mintNFT = false, passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000', message = '') {
        try {
            eventBus.emit('transaction:pending', {
                type: 'buyBonding',
                contractAddress: this.contractAddress
            });

            // Encode message as ABI-encoded tuple matching GlobalMessageRegistry._post:
            // (uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata, string content)
            // messageType 0 = POST, refId 0, actionRef/metadata zeroed
            const messageBytes = message
                ? this.ethers.utils.defaultAbiCoder.encode(
                    ['uint8', 'uint256', 'bytes32', 'bytes32', 'string'],
                    [0, 0, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64), message]
                  )
                : '0x';
            // Deadline: 24h from now (large buffer for local chain timestamp drift)
            const deadline = Math.floor(Date.now() / 1000) + 86400;

            const receipt = await this.executeContractCall(
                'buyBonding',
                [amount, maxCost, mintNFT, passwordHash, messageBytes, deadline],
                {
                    requiresSigner: true,
                    txOptions: { value: maxCost }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'buyBonding',
                receipt,
                amount,
                cost: maxCost
            });

            // Invalidate cache
            contractCache.invalidateByPattern('bonding', 'supply', 'balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'buyBonding',
                error: this.wrapError(error, 'Failed to buy tokens')
            });
            throw error;
        }
    }

    /**
     * Sell tokens via bonding curve
     * @param {string} amount - Amount of tokens to sell (in wei)
     * @param {string} minRefund - Minimum refund expected in ETH (in wei)
     * @param {string} passwordHash - Optional password hash
     * @param {string} message - Optional message
     * @returns {Promise<Object>} Transaction receipt
     */
    async sellBonding(amount, minRefund, passwordHash = '0x0000000000000000000000000000000000000000000000000000000000000000', message = '') {
        try {
            eventBus.emit('transaction:pending', {
                type: 'sellBonding',
                contractAddress: this.contractAddress
            });

            // Encode message as ABI-encoded tuple matching GlobalMessageRegistry._post
            const messageBytes = message
                ? this.ethers.utils.defaultAbiCoder.encode(
                    ['uint8', 'uint256', 'bytes32', 'bytes32', 'string'],
                    [0, 0, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64), message]
                  )
                : '0x';
            // Deadline: 24h from now (large buffer for local chain timestamp drift)
            const deadline = Math.floor(Date.now() / 1000) + 86400;

            const receipt = await this.executeContractCall(
                'sellBonding',
                [amount, minRefund, passwordHash, messageBytes, deadline],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'sellBonding',
                receipt,
                amount
            });

            // Invalidate cache
            contractCache.invalidateByPattern('bonding', 'supply', 'balance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'sellBonding',
                error: this.wrapError(error, 'Failed to sell tokens')
            });
            throw error;
        }
    }

    /**
     * Transfer an NFT to another address via mirror contract
     * @param {string|number} tokenId - NFT token ID
     * @param {string} toAddress - Recipient address
     * @returns {Promise<Object>} Transaction receipt
     */
    async transferNFT(tokenId, toAddress) {
        if (!this.mirrorContract) {
            throw new Error('Mirror contract not available');
        }

        try {
            eventBus.emit('transaction:pending', {
                type: 'transferNFT',
                contractAddress: this.contractAddress
            });

            const signerInstance = this.signer || this.provider.getSigner();
            const mirrorWithSigner = this.mirrorContract.connect(signerInstance);
            const fromAddress = await signerInstance.getAddress();

            const tx = await mirrorWithSigner['safeTransferFrom(address,address,uint256)'](fromAddress, toAddress, tokenId);
            const receipt = await tx.wait();

            eventBus.emit('transaction:success', {
                type: 'transferNFT',
                receipt,
                tokenId,
                toAddress,
                contractAddress: this.contractAddress
            });

            contractCache.invalidateByPattern('balance', 'nft');
            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'transferNFT',
                error: this.wrapError(error, 'NFT transfer failed')
            });
            throw error;
        }
    }

    /**
     * Set skip NFT preference
     * @param {boolean} skipNFT - Whether to skip NFT minting
     * @returns {Promise<Object>} Transaction receipt
     */
    async setSkipNFT(skipNFT) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setSkipNFT',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setSkipNFT',
                [skipNFT],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setSkipNFT',
                receipt,
                skipNFT
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getSkipNFT');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setSkipNFT',
                error: this.wrapError(error, 'Failed to set skip NFT preference')
            });
            throw error;
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
