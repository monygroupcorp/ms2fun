/**
 * UltraAlignmentVault Adapter
 *
 * Wraps UltraAlignmentVault contract functionality.
 * Handles fee claims, benefactor queries, vault information, and conversion operations.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (vault info)
    DYNAMIC: 5 * 60 * 1000,       // 5 minutes (benefactor data, fees)
};

class UltraAlignmentVaultAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'UltraAlignmentVault', ethersProvider, signer);
        this.ethers = ethers;
    }

    /**
     * Initialize the adapter - load contract ABI and create contract instance
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

            // Load contract ABI
            const abi = await loadABI('UltraAlignmentVault');

            // Initialize main contract
            this.contract = new ethers.Contract(
                this.contractAddress,
                abi,
                this.signer || this.provider
            );

            this.initialized = true;
            eventBus.emit('contract:adapter:initialized', {
                contractAddress: this.contractAddress,
                contractType: this.contractType
            });

            return true;
        } catch (error) {
            throw this.wrapError(error, 'UltraAlignmentVaultAdapter initialization failed');
        }
    }

    // =========================
    // Fee Management
    // =========================

    /**
     * Claim fees for benefactor
     * @returns {Promise<Object>} Transaction receipt
     */
    async claimFees() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'claimFees',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'claimFees',
                [],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'claimFees',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('claimable', 'benefactor', 'fees');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'claimFees',
                error: this.wrapError(error, 'Failed to claim fees')
            });
            throw error;
        }
    }

    /**
     * Calculate claimable amount for benefactor
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Claimable amount in ETH
     */
    async calculateClaimableAmount(benefactorAddress) {
        return await this.getCachedOrFetch('calculateClaimableAmount', [benefactorAddress], async () => {
            const amount = await this.executeContractCall('calculateClaimableAmount', [benefactorAddress]);
            return ethers.utils.formatEther(amount);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get total fees collected by vault
     * @returns {Promise<string>} Total fees in ETH
     */
    async getTotalFeesCollected() {
        return await this.getCachedOrFetch('getTotalFeesCollected', [], async () => {
            const fees = await this.executeContractCall('accumulatedFees');
            return ethers.utils.formatEther(fees);
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Benefactor Queries
    // =========================

    /**
     * Get benefactor contribution amount
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Contribution amount in ETH
     */
    async getBenefactorContribution(benefactorAddress) {
        return await this.getCachedOrFetch('getBenefactorContribution', [benefactorAddress], async () => {
            const contribution = await this.executeContractCall('getBenefactorContribution', [benefactorAddress]);
            return ethers.utils.formatEther(contribution);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get benefactor shares
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Number of shares
     */
    async getBenefactorShares(benefactorAddress) {
        return await this.getCachedOrFetch('getBenefactorShares', [benefactorAddress], async () => {
            const shares = await this.executeContractCall('getBenefactorShares', [benefactorAddress]);
            return shares.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get total number of benefactors
     * Note: Contract doesn't have a getBenefactorCount function, returns 0
     * @returns {Promise<number>} Total benefactor count (0 - not supported)
     */
    async getBenefactorCount() {
        // Contract doesn't expose benefactor enumeration
        // Return 0 to indicate unknown count
        return 0;
    }

    /**
     * Get benefactor by index
     * Note: Contract doesn't support benefactor enumeration
     * @param {number} index - Benefactor index
     * @returns {Promise<string|null>} null - not supported
     */
    async getBenefactor(index) {
        // Contract doesn't expose benefactor enumeration
        return null;
    }

    /**
     * Check if address is a benefactor
     * Uses benefactorShares mapping to determine benefactor status
     * @param {string} address - Address to check
     * @returns {Promise<boolean>} True if address is benefactor
     */
    async isBenefactor(address) {
        return await this.getCachedOrFetch('isBenefactor', [address], async () => {
            // Check if benefactor has shares (> 0 means they are a benefactor)
            const shares = await this.executeContractCall('benefactorShares', [address]);
            return shares.gt(0);
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Vault Information
    // =========================

    /**
     * Get vault type
     * @returns {Promise<string>} Vault type identifier
     */
    async vaultType() {
        return await this.getCachedOrFetch('vaultType', [], async () => {
            return await this.executeContractCall('vaultType');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault description
     * @returns {Promise<string>} Vault description
     */
    async description() {
        return await this.getCachedOrFetch('description', [], async () => {
            return await this.executeContractCall('description');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get accumulated fees in vault
     * @returns {Promise<string>} Accumulated fees in ETH
     */
    async accumulatedFees() {
        return await this.getCachedOrFetch('accumulatedFees', [], async () => {
            const fees = await this.executeContractCall('accumulatedFees');
            return ethers.utils.formatEther(fees);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get total shares in vault
     * @returns {Promise<string>} Total shares
     */
    async totalShares() {
        return await this.getCachedOrFetch('totalShares', [], async () => {
            const shares = await this.executeContractCall('totalShares');
            return shares.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get comprehensive vault information
     * @returns {Promise<Object>} Vault info object
     */
    async getVaultInfo() {
        return await this.getCachedOrFetch('getVaultInfo', [], async () => {
            const [vaultTypeStr, desc, fees, shares, benefactorCount] = await Promise.all([
                this.vaultType(),
                this.description(),
                this.accumulatedFees(),
                this.totalShares(),
                this.getBenefactorCount()
            ]);

            return {
                vaultAddress: this.contractAddress,
                vaultType: vaultTypeStr,
                description: desc,
                accumulatedFees: fees,
                totalShares: shares,
                benefactorCount
            };
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Conversion Operations
    // =========================

    /**
     * Trigger conversion and add liquidity (permissionless, incentivized)
     * @param {string} minOutTarget - Minimum output target (slippage protection)
     * @returns {Promise<Object>} Transaction receipt
     */
    async convertAndAddLiquidity(minOutTarget) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'convertAndAddLiquidity',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'convertAndAddLiquidity',
                [minOutTarget],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'convertAndAddLiquidity',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('fees', 'conversion');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'convertAndAddLiquidity',
                error: this.wrapError(error, 'Conversion failed')
            });
            throw error;
        }
    }

    /**
     * Get conversion rate estimate
     * @returns {Promise<Object>} Conversion rate information
     */
    async getConversionRate() {
        return await this.getCachedOrFetch('getConversionRate', [], async () => {
            const rate = await this.executeContractCall('getConversionRate');
            return {
                rate: ethers.utils.formatEther(rate.rate || rate[0]),
                timestamp: parseInt((rate.timestamp || rate[1]).toString()),
                isStale: rate.isStale !== undefined ? rate.isStale : rate[2]
            };
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Benefactor Details
    // =========================

    /**
     * Get detailed benefactor information
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<Object>} Benefactor details
     */
    async getBenefactorDetails(benefactorAddress) {
        return await this.getCachedOrFetch('getBenefactorDetails', [benefactorAddress], async () => {
            const [contribution, shares, claimable, isBenef] = await Promise.all([
                this.getBenefactorContribution(benefactorAddress),
                this.getBenefactorShares(benefactorAddress),
                this.calculateClaimableAmount(benefactorAddress),
                this.isBenefactor(benefactorAddress)
            ]);

            return {
                address: benefactorAddress,
                contribution,
                shares,
                claimableAmount: claimable,
                isBenefactor: isBenef,
                sharePercentage: parseFloat(shares) / parseFloat(await this.totalShares()) * 100
            };
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Public Constants & State Variables
    // =========================

    /**
     * Get conversion base gas constant
     * @returns {Promise<number>} Base gas for conversion operations
     */
    async CONVERSION_BASE_GAS() {
        return await this.getCachedOrFetch('CONVERSION_BASE_GAS', [], async () => {
            const gas = await this.executeContractCall('CONVERSION_BASE_GAS');
            return parseInt(gas.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get gas per benefactor constant
     * @returns {Promise<number>} Gas per benefactor
     */
    async GAS_PER_BENEFACTOR() {
        return await this.getCachedOrFetch('GAS_PER_BENEFACTOR', [], async () => {
            const gas = await this.executeContractCall('GAS_PER_BENEFACTOR');
            return parseInt(gas.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get accumulated dust shares
     * @returns {Promise<string>} Accumulated dust shares
     */
    async accumulatedDustShares() {
        return await this.getCachedOrFetch('accumulatedDustShares', [], async () => {
            const shares = await this.executeContractCall('accumulatedDustShares');
            return shares.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get alignment token address
     * @returns {Promise<string>} Alignment token contract address
     */
    async alignmentToken() {
        return await this.getCachedOrFetch('alignmentToken', [], async () => {
            return await this.executeContractCall('alignmentToken');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get alignment token decimals
     * @returns {Promise<number>} Number of decimals
     */
    async alignmentTokenDecimals() {
        return await this.getCachedOrFetch('alignmentTokenDecimals', [], async () => {
            const decimals = await this.executeContractCall('alignmentTokenDecimals');
            return parseInt(decimals.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get benefactor shares for address
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Benefactor shares
     */
    async benefactorShares(benefactorAddress) {
        return await this.getCachedOrFetch('benefactorShares', [benefactorAddress], async () => {
            const shares = await this.executeContractCall('benefactorShares', [benefactorAddress]);
            return shares.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get benefactor total ETH contributed
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Total ETH contributed in wei
     */
    async benefactorTotalETH(benefactorAddress) {
        return await this.getCachedOrFetch('benefactorTotalETH', [benefactorAddress], async () => {
            const total = await this.executeContractCall('benefactorTotalETH', [benefactorAddress]);
            return ethers.utils.formatEther(total);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get conversion participant at index
     * @param {number} index - Participant index
     * @returns {Promise<string>} Participant address
     */
    async conversionParticipants(index) {
        return await this.getCachedOrFetch('conversionParticipants', [index], async () => {
            return await this.executeContractCall('conversionParticipants', [index]);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get dust distribution threshold
     * @returns {Promise<string>} Dust distribution threshold
     */
    async dustDistributionThreshold() {
        return await this.getCachedOrFetch('dustDistributionThreshold', [], async () => {
            const threshold = await this.executeContractCall('dustDistributionThreshold');
            return threshold.toString();
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get unclaimed fees for benefactor
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Unclaimed fees in ETH
     */
    async getUnclaimedFees(benefactorAddress) {
        return await this.getCachedOrFetch('getUnclaimedFees', [benefactorAddress], async () => {
            const fees = await this.executeContractCall('getUnclaimedFees', [benefactorAddress]);
            return ethers.utils.formatEther(fees);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get last claim timestamp for benefactor
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<number>} Last claim timestamp
     */
    async lastClaimTimestamp(benefactorAddress) {
        return await this.getCachedOrFetch('lastClaimTimestamp', [benefactorAddress], async () => {
            const timestamp = await this.executeContractCall('lastClaimTimestamp', [benefactorAddress]);
            return parseInt(timestamp.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get last conversion participant index
     * @returns {Promise<number>} Last participant index processed
     */
    async lastConversionParticipantIndex() {
        return await this.getCachedOrFetch('lastConversionParticipantIndex', [], async () => {
            const index = await this.executeContractCall('lastConversionParticipantIndex');
            return parseInt(index.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get last tick lower for liquidity position
     * @returns {Promise<number>} Last tick lower
     */
    async lastTickLower() {
        return await this.getCachedOrFetch('lastTickLower', [], async () => {
            const tick = await this.executeContractCall('lastTickLower');
            return parseInt(tick.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get last tick upper for liquidity position
     * @returns {Promise<number>} Last tick upper
     */
    async lastTickUpper() {
        return await this.getCachedOrFetch('lastTickUpper', [], async () => {
            const tick = await this.executeContractCall('lastTickUpper');
            return parseInt(tick.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get last vault fee collection time
     * @returns {Promise<number>} Last collection timestamp
     */
    async lastVaultFeeCollectionTime() {
        return await this.getCachedOrFetch('lastVaultFeeCollectionTime', [], async () => {
            const time = await this.executeContractCall('lastVaultFeeCollectionTime');
            return parseInt(time.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get max price deviation in basis points
     * @returns {Promise<number>} Max price deviation bps
     */
    async maxPriceDeviationBps() {
        return await this.getCachedOrFetch('maxPriceDeviationBps', [], async () => {
            const bps = await this.executeContractCall('maxPriceDeviationBps');
            return parseInt(bps.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get pending ETH for benefactor
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Pending ETH in wei
     */
    async pendingETH(benefactorAddress) {
        return await this.getCachedOrFetch('pendingETH', [benefactorAddress], async () => {
            const pending = await this.executeContractCall('pendingETH', [benefactorAddress]);
            return ethers.utils.formatEther(pending);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get pool manager address
     * @returns {Promise<string>} Pool manager contract address
     */
    async poolManager() {
        return await this.getCachedOrFetch('poolManager', [], async () => {
            return await this.executeContractCall('poolManager');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get share value at last claim for benefactor
     * @param {string} benefactorAddress - Benefactor address
     * @returns {Promise<string>} Share value
     */
    async shareValueAtLastClaim(benefactorAddress) {
        return await this.getCachedOrFetch('shareValueAtLastClaim', [benefactorAddress], async () => {
            const value = await this.executeContractCall('shareValueAtLastClaim', [benefactorAddress]);
            return value.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get standard conversion reward
     * @returns {Promise<string>} Standard conversion reward in ETH
     */
    async standardConversionReward() {
        return await this.getCachedOrFetch('standardConversionReward', [], async () => {
            const reward = await this.executeContractCall('standardConversionReward');
            return ethers.utils.formatEther(reward);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get total LP units
     * @returns {Promise<string>} Total LP units
     */
    async totalLPUnits() {
        return await this.getCachedOrFetch('totalLPUnits', [], async () => {
            const units = await this.executeContractCall('totalLPUnits');
            return units.toString();
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get total pending ETH
     * @returns {Promise<string>} Total pending ETH in wei
     */
    async totalPendingETH() {
        return await this.getCachedOrFetch('totalPendingETH', [], async () => {
            const pending = await this.executeContractCall('totalPendingETH');
            return ethers.utils.formatEther(pending);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get V2 factory address
     * @returns {Promise<string>} V2 factory contract address
     */
    async v2Factory() {
        return await this.getCachedOrFetch('v2Factory', [], async () => {
            return await this.executeContractCall('v2Factory');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get V2 router address
     * @returns {Promise<string>} V2 router contract address
     */
    async v2Router() {
        return await this.getCachedOrFetch('v2Router', [], async () => {
            return await this.executeContractCall('v2Router');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get V3 factory address
     * @returns {Promise<string>} V3 factory contract address
     */
    async v3Factory() {
        return await this.getCachedOrFetch('v3Factory', [], async () => {
            return await this.executeContractCall('v3Factory');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get V3 preferred fee tier
     * @returns {Promise<number>} V3 preferred fee tier
     */
    async v3PreferredFee() {
        return await this.getCachedOrFetch('v3PreferredFee', [], async () => {
            const fee = await this.executeContractCall('v3PreferredFee');
            return parseInt(fee.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get V3 router address
     * @returns {Promise<string>} V3 router contract address
     */
    async v3Router() {
        return await this.getCachedOrFetch('v3Router', [], async () => {
            return await this.executeContractCall('v3Router');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get V4 pool key
     * @returns {Promise<Object>} V4 pool key
     */
    async v4PoolKey() {
        return await this.getCachedOrFetch('v4PoolKey', [], async () => {
            const key = await this.executeContractCall('v4PoolKey');
            return {
                currency0: key.currency0 || key[0],
                currency1: key.currency1 || key[1],
                fee: parseInt((key.fee || key[2]).toString()),
                tickSpacing: parseInt((key.tickSpacing || key[3]).toString()),
                hooks: key.hooks || key[4]
            };
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault fee collection interval
     * @returns {Promise<number>} Fee collection interval in seconds
     */
    async vaultFeeCollectionInterval() {
        return await this.getCachedOrFetch('vaultFeeCollectionInterval', [], async () => {
            const interval = await this.executeContractCall('vaultFeeCollectionInterval');
            return parseInt(interval.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get WETH address
     * @returns {Promise<string>} WETH contract address
     */
    async weth() {
        return await this.getCachedOrFetch('weth', [], async () => {
            return await this.executeContractCall('weth');
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Additional View Functions
    // =========================

    /**
     * Validate current pool key
     * @param {Object} poolKey - Pool key to validate
     * @returns {Promise<boolean>} True if pool key is valid
     */
    async validateCurrentPoolKey(poolKey) {
        return await this.executeContractCall('validateCurrentPoolKey', [poolKey]);
    }

    // =========================
    // State-Changing Functions
    // =========================

    /**
     * Deposit fees to vault (called by instances)
     * @returns {Promise<Object>} Transaction receipt
     */
    async depositFees() {
        try {
            eventBus.emit('transaction:pending', {
                type: 'depositFees',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'depositFees',
                [],
                {
                    requiresSigner: true,
                    txOptions: { value: 0 } // May need to send ETH
                }
            );

            eventBus.emit('transaction:success', {
                type: 'depositFees',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('fees', 'accumulated');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'depositFees',
                error: this.wrapError(error, 'Failed to deposit fees')
            });
            throw error;
        }
    }

    /**
     * Record accumulated fees (admin or automated)
     * @param {string} amount - Amount of fees to record in ETH
     * @returns {Promise<Object>} Transaction receipt
     */
    async recordAccumulatedFees(amount) {
        try {
            const amountWei = ethers.utils.parseEther(amount);

            eventBus.emit('transaction:pending', {
                type: 'recordAccumulatedFees',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'recordAccumulatedFees',
                [amountWei],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'recordAccumulatedFees',
                receipt,
                amount,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('fees', 'accumulated');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'recordAccumulatedFees',
                error: this.wrapError(error, 'Failed to record accumulated fees')
            });
            throw error;
        }
    }

    /**
     * Set alignment token (admin only)
     * @param {string} tokenAddress - Alignment token contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setAlignmentToken(tokenAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setAlignmentToken',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setAlignmentToken',
                [tokenAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setAlignmentToken',
                receipt,
                tokenAddress,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('alignmentToken');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setAlignmentToken',
                error: this.wrapError(error, 'Failed to set alignment token')
            });
            throw error;
        }
    }

    /**
     * Set dust distribution threshold (admin only)
     * @param {string} threshold - Dust distribution threshold
     * @returns {Promise<Object>} Transaction receipt
     */
    async setDustDistributionThreshold(threshold) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setDustDistributionThreshold',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setDustDistributionThreshold',
                [threshold],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setDustDistributionThreshold',
                receipt,
                threshold,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('dustDistributionThreshold');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setDustDistributionThreshold',
                error: this.wrapError(error, 'Failed to set dust distribution threshold')
            });
            throw error;
        }
    }

    /**
     * Set max price deviation in basis points (admin only)
     * @param {number} bps - Max price deviation in basis points
     * @returns {Promise<Object>} Transaction receipt
     */
    async setMaxPriceDeviationBps(bps) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setMaxPriceDeviationBps',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setMaxPriceDeviationBps',
                [bps],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setMaxPriceDeviationBps',
                receipt,
                bps,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('maxPriceDeviationBps');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setMaxPriceDeviationBps',
                error: this.wrapError(error, 'Failed to set max price deviation')
            });
            throw error;
        }
    }

    /**
     * Set standard conversion reward (admin only)
     * @param {string} reward - Standard conversion reward in ETH
     * @returns {Promise<Object>} Transaction receipt
     */
    async setStandardConversionReward(reward) {
        try {
            const rewardWei = ethers.utils.parseEther(reward);

            eventBus.emit('transaction:pending', {
                type: 'setStandardConversionReward',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setStandardConversionReward',
                [rewardWei],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setStandardConversionReward',
                receipt,
                reward,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('standardConversionReward');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setStandardConversionReward',
                error: this.wrapError(error, 'Failed to set standard conversion reward')
            });
            throw error;
        }
    }

    /**
     * Set V4 pool key (admin only)
     * @param {Object} poolKey - V4 pool key
     * @returns {Promise<Object>} Transaction receipt
     */
    async setV4PoolKey(poolKey) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'setV4PoolKey',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'setV4PoolKey',
                [poolKey],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'setV4PoolKey',
                receipt,
                contractAddress: this.contractAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('v4PoolKey');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'setV4PoolKey',
                error: this.wrapError(error, 'Failed to set V4 pool key')
            });
            throw error;
        }
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        const info = await this.getVaultInfo();
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            ...info
        };
    }

    /**
     * Get balance (not applicable for vault)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for vault)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default UltraAlignmentVaultAdapter;
