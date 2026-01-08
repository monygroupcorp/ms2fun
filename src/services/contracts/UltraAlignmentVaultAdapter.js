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
     * @returns {Promise<number>} Total benefactor count
     */
    async getBenefactorCount() {
        return await this.getCachedOrFetch('getBenefactorCount', [], async () => {
            const count = await this.executeContractCall('getBenefactorCount');
            return parseInt(count.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get benefactor by index
     * @param {number} index - Benefactor index
     * @returns {Promise<string>} Benefactor address
     */
    async getBenefactor(index) {
        return await this.getCachedOrFetch('getBenefactor', [index], async () => {
            return await this.executeContractCall('getBenefactor', [index]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Check if address is a benefactor
     * @param {string} address - Address to check
     * @returns {Promise<boolean>} True if address is benefactor
     */
    async isBenefactor(address) {
        return await this.getCachedOrFetch('isBenefactor', [address], async () => {
            return await this.executeContractCall('isBenefactor', [address]);
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
