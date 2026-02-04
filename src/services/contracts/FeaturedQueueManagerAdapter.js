/**
 * FeaturedQueueManager Adapter
 *
 * Provides interface to the FeaturedQueueManager contract for:
 * - Competitive position rental
 * - Queue management
 * - Auto-renewal deposits
 * - Cleanup incentives
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';

export class FeaturedQueueManagerAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'FeaturedQueueManager', ethersProvider, signer);
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
            const abi = await loadABI('FeaturedQueueManager');

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
            throw this.wrapError(error, 'FeaturedQueueManagerAdapter initialization failed');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════

    /**
     * Format wei to ETH string
     */
    formatEther(value) {
        if (!value) return '0';
        try {
            return ethers.utils.formatEther(value);
        } catch {
            return '0';
        }
    }

    /**
     * Parse ETH string to wei
     */
    parseEther(value) {
        if (!value) return ethers.BigNumber.from(0);
        try {
            return ethers.utils.parseEther(value.toString());
        } catch {
            return ethers.BigNumber.from(0);
        }
    }

    /**
     * Wrap error with context
     */
    wrapError(error, context) {
        const wrappedError = new Error(`${context}: ${error.message}`);
        wrappedError.originalError = error;
        wrappedError.code = error.code;
        wrappedError.contractAddress = this.contractAddress;
        return wrappedError;
    }

    // ═══════════════════════════════════════════════════════════
    // READ METHODS - Configuration
    // ═══════════════════════════════════════════════════════════

    /**
     * Get minimum rental duration
     * @returns {Promise<number>} Minimum duration in seconds
     */
    async minRentalDuration() {
        return this.getCachedOrFetch('minRentalDuration', [], async () => {
            const result = await this.executeContractCall('minRentalDuration');
            return Number(result);
        }, 300000); // 5 min cache
    }

    /**
     * Get maximum rental duration
     * @returns {Promise<number>} Maximum duration in seconds
     */
    async maxRentalDuration() {
        return this.getCachedOrFetch('maxRentalDuration', [], async () => {
            const result = await this.executeContractCall('maxRentalDuration');
            return Number(result);
        }, 300000);
    }

    /**
     * Get base rental price
     * @returns {Promise<string>} Base price in ETH
     */
    async baseRentalPrice() {
        return this.getCachedOrFetch('baseRentalPrice', [], async () => {
            const result = await this.executeContractCall('baseRentalPrice');
            return this.formatEther(result);
        }, 300000);
    }

    /**
     * Get maximum queue size
     * @returns {Promise<number>} Max queue size
     */
    async maxQueueSize() {
        return this.getCachedOrFetch('maxQueueSize', [], async () => {
            const result = await this.executeContractCall('maxQueueSize');
            return Number(result);
        }, 300000);
    }

    /**
     * Get visible threshold (frontend shows top N)
     * @returns {Promise<number>} Visible threshold
     */
    async visibleThreshold() {
        return this.getCachedOrFetch('visibleThreshold', [], async () => {
            const result = await this.executeContractCall('visibleThreshold');
            return Number(result);
        }, 300000);
    }

    /**
     * Get current queue length
     * @returns {Promise<number>} Queue length
     */
    async queueLength() {
        return this.getCachedOrFetch('queueLength', [], async () => {
            const result = await this.executeContractCall('queueLength');
            return Number(result);
        }, 30000); // 30 sec cache - changes frequently
    }

    // ═══════════════════════════════════════════════════════════
    // READ METHODS - Pricing
    // ═══════════════════════════════════════════════════════════

    /**
     * Get rental price for a specific position
     * @param {number} position - 1-indexed position
     * @returns {Promise<string>} Price in ETH
     */
    async getPositionRentalPrice(position) {
        return this.getCachedOrFetch('getPositionRentalPrice', [position], async () => {
            const result = await this.executeContractCall('getPositionRentalPrice', [position]);
            return this.formatEther(result);
        }, 60000); // 1 min cache
    }

    /**
     * Calculate total rental cost
     * @param {number} position - 1-indexed position
     * @param {number} duration - Duration in seconds
     * @returns {Promise<string>} Total cost in ETH
     */
    async calculateRentalCost(position, duration) {
        const result = await this.executeContractCall('calculateRentalCost', [position, duration]);
        return this.formatEther(result);
    }

    /**
     * Get queue utilization metrics
     * @returns {Promise<object>} Utilization info
     */
    async getQueueUtilization() {
        return this.getCachedOrFetch('getQueueUtilization', [], async () => {
            const result = await this.executeContractCall('getQueueUtilization');
            return {
                currentUtilization: Number(result.currentUtilization || result[0] || 0),
                adjustedBasePrice: this.formatEther(result.adjustedBasePrice || result[1] || 0),
                length: Number(result.length || result[2] || 0),
                maxSize: Number(result.maxSize || result[3] || 100)
            };
        }, 60000);
    }

    // ═══════════════════════════════════════════════════════════
    // READ METHODS - Queue & Rental Info
    // ═══════════════════════════════════════════════════════════

    /**
     * Get featured instances in queue order
     * @param {number} startIndex - Start index (0-based)
     * @param {number} endIndex - End index (exclusive)
     * @returns {Promise<{instances: string[], total: number}>}
     */
    async getFeaturedInstances(startIndex, endIndex) {
        const result = await this.executeContractCall('getFeaturedInstances', [startIndex, endIndex]);
        return {
            instances: result.instances || result[0] || [],
            total: Number(result.total || result[1] || 0)
        };
    }

    /**
     * Get rental info for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<object>} Rental info
     */
    async getRentalInfo(instanceAddress) {
        const result = await this.executeContractCall('getRentalInfo', [instanceAddress]);

        const rental = result.rental || result[0];
        return {
            rental: {
                instance: rental.instance,
                renter: rental.renter,
                rentPaid: this.formatEther(rental.rentPaid),
                rentedAt: Number(rental.rentedAt),
                expiresAt: Number(rental.expiresAt),
                originalPosition: Number(rental.originalPosition),
                active: rental.active
            },
            position: Number(result.position || result[1] || 0),
            renewalDeposit: this.formatEther(result.renewalDeposit || result[2] || 0),
            isExpired: result.isExpired || result[3] || false
        };
    }

    /**
     * Get instance position in queue
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<number>} Position (0 if not in queue)
     */
    async instancePosition(instanceAddress) {
        const result = await this.executeContractCall('instancePosition', [instanceAddress]);
        return Number(result);
    }

    /**
     * Get renewal deposit for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<string>} Deposit amount in ETH
     */
    async renewalDeposits(instanceAddress) {
        const result = await this.executeContractCall('renewalDeposits', [instanceAddress]);
        return this.formatEther(result);
    }

    // ═══════════════════════════════════════════════════════════
    // WRITE METHODS - Rental Operations
    // ═══════════════════════════════════════════════════════════

    /**
     * Rent a featured position
     * @param {string} instanceAddress - Instance to feature
     * @param {number} desiredPosition - Target position (1-indexed)
     * @param {number} duration - Duration in seconds
     * @param {string} value - Payment amount in ETH
     * @returns {Promise<object>} Transaction receipt
     */
    async rentFeaturedPosition(instanceAddress, desiredPosition, duration, value) {
        return this.executeContractCall(
            'rentFeaturedPosition',
            [instanceAddress, desiredPosition, duration],
            { requiresSigner: true, txOptions: { value: this.parseEther(value) } }
        );
    }

    /**
     * Renew current position
     * @param {string} instanceAddress - Instance address
     * @param {number} additionalDuration - Additional duration in seconds
     * @param {string} value - Payment amount in ETH
     * @returns {Promise<object>} Transaction receipt
     */
    async renewPosition(instanceAddress, additionalDuration, value) {
        return this.executeContractCall(
            'renewPosition',
            [instanceAddress, additionalDuration],
            { requiresSigner: true, txOptions: { value: this.parseEther(value) } }
        );
    }

    /**
     * Bump to a better position
     * @param {string} instanceAddress - Instance address
     * @param {number} targetPosition - Target position (must be < current)
     * @param {number} additionalDuration - Additional duration (optional, 0 for none)
     * @param {string} value - Payment amount in ETH
     * @returns {Promise<object>} Transaction receipt
     */
    async bumpPosition(instanceAddress, targetPosition, additionalDuration, value) {
        return this.executeContractCall(
            'bumpPosition',
            [instanceAddress, targetPosition, additionalDuration],
            { requiresSigner: true, txOptions: { value: this.parseEther(value) } }
        );
    }

    /**
     * Deposit funds for auto-renewal
     * @param {string} instanceAddress - Instance address
     * @param {string} value - Deposit amount in ETH
     * @returns {Promise<object>} Transaction receipt
     */
    async depositForAutoRenewal(instanceAddress, value) {
        return this.executeContractCall(
            'depositForAutoRenewal',
            [instanceAddress],
            { requiresSigner: true, txOptions: { value: this.parseEther(value) } }
        );
    }

    /**
     * Withdraw auto-renewal deposit
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<object>} Transaction receipt
     */
    async withdrawRenewalDeposit(instanceAddress) {
        return this.executeContractCall('withdrawRenewalDeposit', [instanceAddress], { requiresSigner: true });
    }

    /**
     * Clean up expired rentals (earns reward)
     * @param {number} maxCleanup - Max entries to clean (1-50)
     * @returns {Promise<object>} Transaction receipt
     */
    async cleanupExpiredRentals(maxCleanup = 10) {
        return this.executeContractCall('cleanupExpiredRentals', [maxCleanup], { requiresSigner: true });
    }
}

export default FeaturedQueueManagerAdapter;
