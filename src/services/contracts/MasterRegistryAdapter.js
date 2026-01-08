/**
 * MasterRegistry Adapter
 *
 * Wraps MasterRegistryV1 contract functionality.
 * Handles factory discovery, vault rankings, featured instances, and rental operations.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (factory list, contract info)
    DYNAMIC: 5 * 60 * 1000,       // 5 minutes (vault rankings, instance stats)
    REALTIME: 30 * 1000,          // 30 seconds (featured instances)
};

class MasterRegistryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'MasterRegistry', ethersProvider, signer);
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
            const abi = await loadABI('MasterRegistryV1');

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
            throw this.wrapError(error, 'MasterRegistryAdapter initialization failed');
        }
    }

    // =========================
    // Factory Discovery Methods
    // =========================

    /**
     * Get total number of registered factories
     * @returns {Promise<number>} Total factory count
     */
    async getTotalFactories() {
        return await this.getCachedOrFetch('getTotalFactories', [], async () => {
            const result = await this.executeContractCall('getTotalFactories');
            return parseInt(result.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get factory information by ID
     * @param {number} factoryId - Factory ID
     * @returns {Promise<Object>} Factory information
     */
    async getFactoryInfo(factoryId) {
        return await this.getCachedOrFetch('getFactoryInfo', [factoryId], async () => {
            const info = await this.executeContractCall('getFactoryInfo', [factoryId]);
            return this._parseFactoryInfo(info);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get factory information by address
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<Object>} Factory information
     */
    async getFactoryInfoByAddress(factoryAddress) {
        return await this.getCachedOrFetch('getFactoryInfoByAddress', [factoryAddress], async () => {
            const info = await this.executeContractCall('getFactoryInfoByAddress', [factoryAddress]);
            return this._parseFactoryInfo(info);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get all factories (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of factory information
     */
    async getFactories(startIndex, endIndex) {
        const total = await this.getTotalFactories();
        const actualEnd = Math.min(endIndex, total);

        const factories = [];
        for (let i = startIndex; i < actualEnd; i++) {
            const factory = await this.getFactoryInfo(i);
            factories.push(factory);
        }

        return factories;
    }

    /**
     * Get factory application details
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<Object>} Application details
     */
    async getFactoryApplication(factoryAddress) {
        return await this.getCachedOrFetch('getFactoryApplication', [factoryAddress], async () => {
            const app = await this.executeContractCall('getFactoryApplication', [factoryAddress]);
            return this._parseApplicationInfo(app);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Parse factory info from contract response
     * @private
     */
    _parseFactoryInfo(info) {
        return {
            factoryAddress: info.factoryAddress || info[0],
            contractType: info.contractType || info[1],
            title: info.title || info[2],
            displayTitle: info.displayTitle || info[3],
            metadataURI: info.metadataURI || info[4],
            features: info.features || info[5] || [],
            isActive: info.isActive !== undefined ? info.isActive : info[6],
            registeredAt: info.registeredAt ? parseInt(info.registeredAt.toString()) : parseInt((info[7] || 0).toString())
        };
    }

    /**
     * Parse application info from contract response
     * @private
     */
    _parseApplicationInfo(app) {
        return {
            applicant: app.applicant || app[0],
            contractAddress: app.contractAddress || app[1],
            contractType: app.contractType || app[2],
            title: app.title || app[3],
            displayTitle: app.displayTitle || app[4],
            metadataURI: app.metadataURI || app[5],
            features: app.features || app[6] || [],
            status: app.status !== undefined ? app.status : app[7],
            submittedAt: app.submittedAt ? parseInt(app.submittedAt.toString()) : parseInt((app[8] || 0).toString()),
            approvalVotes: app.approvalVotes ? parseInt(app.approvalVotes.toString()) : parseInt((app[9] || 0).toString()),
            rejectionVotes: app.rejectionVotes ? parseInt(app.rejectionVotes.toString()) : parseInt((app[10] || 0).toString())
        };
    }

    // =========================
    // Vault Discovery Methods
    // =========================

    /**
     * Get total number of registered vaults
     * @returns {Promise<number>} Total vault count
     */
    async getTotalVaults() {
        return await this.getCachedOrFetch('getTotalVaults', [], async () => {
            const result = await this.executeContractCall('getTotalVaults');
            return parseInt(result.toString());
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get vault information
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Object>} Vault information
     */
    async getVaultInfo(vaultAddress) {
        return await this.getCachedOrFetch('getVaultInfo', [vaultAddress], async () => {
            const info = await this.executeContractCall('getVaultInfo', [vaultAddress]);
            return this._parseVaultInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get all vaults (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of vault addresses
     */
    async getVaults(startIndex, endIndex) {
        const vaults = await this.executeContractCall('getVaults', [startIndex, endIndex]);
        return vaults.map(v => v.toString());
    }

    /**
     * Get top vaults by TVL
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<Array>} Array of vault addresses sorted by TVL
     */
    async getVaultsByTVL(limit) {
        return await this.getCachedOrFetch('getVaultsByTVL', [limit], async () => {
            const vaults = await this.executeContractCall('getVaultsByTVL', [limit]);
            return vaults.map(v => v.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get top vaults by popularity (instance count)
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<Array>} Array of vault addresses sorted by popularity
     */
    async getVaultsByPopularity(limit) {
        return await this.getCachedOrFetch('getVaultsByPopularity', [limit], async () => {
            const vaults = await this.executeContractCall('getVaultsByPopularity', [limit]);
            return vaults.map(v => v.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instances using a specific vault
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Array>} Array of instance addresses using this vault
     */
    async getInstancesByVault(vaultAddress) {
        return await this.getCachedOrFetch('getInstancesByVault', [vaultAddress], async () => {
            const instances = await this.executeContractCall('getInstancesByVault', [vaultAddress]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Check if vault is registered
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<boolean>} True if vault is registered
     */
    async isVaultRegistered(vaultAddress) {
        return await this.getCachedOrFetch('isVaultRegistered', [vaultAddress], async () => {
            return await this.executeContractCall('isVaultRegistered', [vaultAddress]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Parse vault info from contract response
     * @private
     */
    _parseVaultInfo(info) {
        return {
            vaultAddress: info.vaultAddress || info[0],
            vaultType: info.vaultType || info[1],
            name: info.name || info[2],
            metadataURI: info.metadataURI || info[3],
            isActive: info.isActive !== undefined ? info.isActive : info[4],
            registeredAt: info.registeredAt ? parseInt(info.registeredAt.toString()) : parseInt((info[5] || 0).toString()),
            instanceCount: info.instanceCount ? parseInt(info.instanceCount.toString()) : parseInt((info[6] || 0).toString()),
            tvl: info.tvl ? ethers.utils.formatEther(info.tvl) : '0'
        };
    }

    // =========================
    // Featured Instance Methods
    // =========================

    /**
     * Get featured instances (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array>} Array of featured instance addresses
     */
    async getFeaturedInstances(startIndex, endIndex) {
        return await this.getCachedOrFetch('getFeaturedInstances', [startIndex, endIndex], async () => {
            const instances = await this.executeContractCall('getFeaturedInstances', [startIndex, endIndex]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Get instance information
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<Object>} Instance information
     */
    async getInstanceInfo(instanceAddress) {
        return await this.getCachedOrFetch('getInstanceInfo', [instanceAddress], async () => {
            const info = await this.executeContractCall('getInstanceInfo', [instanceAddress]);
            return this._parseInstanceInfo(info);
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instances created by a specific address
     * @param {string} creatorAddress - Creator address
     * @returns {Promise<Array>} Array of instance addresses
     */
    async getCreatorInstances(creatorAddress) {
        return await this.getCachedOrFetch('getCreatorInstances', [creatorAddress], async () => {
            const instances = await this.executeContractCall('getCreatorInstances', [creatorAddress]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Parse instance info from contract response
     * @private
     */
    _parseInstanceInfo(info) {
        return {
            instanceAddress: info.instanceAddress || info[0],
            factoryAddress: info.factoryAddress || info[1],
            creator: info.creator || info[2],
            vault: info.vault || info[3],
            createdAt: info.createdAt ? parseInt(info.createdAt.toString()) : parseInt((info[4] || 0).toString())
        };
    }

    // =========================
    // Featured Position Rental
    // =========================

    /**
     * Get rental price for a position
     * @param {number} position - Position in featured queue (0-based)
     * @returns {Promise<string>} Rental price in ETH
     */
    async getPositionRentalPrice(position) {
        return await this.getCachedOrFetch('getPositionRentalPrice', [position], async () => {
            const price = await this.executeContractCall('getPositionRentalPrice', [position]);
            return ethers.utils.formatEther(price);
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Calculate rental cost
     * @param {number} position - Position in featured queue
     * @param {number} duration - Rental duration in seconds
     * @returns {Promise<string>} Total rental cost in ETH
     */
    async calculateRentalCost(position, duration) {
        const cost = await this.executeContractCall('calculateRentalCost', [position, duration]);
        return ethers.utils.formatEther(cost);
    }

    /**
     * Get rental information for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<Object>} Rental information
     */
    async getRentalInfo(instanceAddress) {
        return await this.getCachedOrFetch('getRentalInfo', [instanceAddress], async () => {
            const info = await this.executeContractCall('getRentalInfo', [instanceAddress]);
            return this._parseRentalInfo(info);
        }, CACHE_TTL.REALTIME);
    }

    /**
     * Rent a featured position
     * @param {string} instanceAddress - Instance to feature
     * @param {number} desiredPosition - Desired position (0-based)
     * @param {number} duration - Rental duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async rentFeaturedPosition(instanceAddress, desiredPosition, duration) {
        try {
            // Calculate required payment
            const cost = await this.calculateRentalCost(desiredPosition, duration);
            const costWei = ethers.utils.parseEther(cost);

            eventBus.emit('transaction:pending', {
                type: 'rentFeaturedPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'rentFeaturedPosition',
                [instanceAddress, desiredPosition, duration],
                {
                    requiresSigner: true,
                    txOptions: { value: costWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'rentFeaturedPosition',
                receipt,
                instanceAddress,
                position: desiredPosition
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'rentFeaturedPosition',
                error: this.wrapError(error, 'Failed to rent featured position')
            });
            throw error;
        }
    }

    /**
     * Renew existing position rental
     * @param {string} instanceAddress - Instance address
     * @param {number} additionalDuration - Additional duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async renewPosition(instanceAddress, additionalDuration) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'renewPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'renewPosition',
                [instanceAddress, additionalDuration],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'renewPosition',
                receipt,
                instanceAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'renewPosition',
                error: this.wrapError(error, 'Failed to renew position')
            });
            throw error;
        }
    }

    /**
     * Bump position (move to better position with additional payment)
     * @param {string} instanceAddress - Instance address
     * @param {number} targetPosition - Target position (0-based)
     * @param {number} additionalDuration - Additional duration in seconds
     * @returns {Promise<Object>} Transaction receipt
     */
    async bumpPosition(instanceAddress, targetPosition, additionalDuration) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'bumpPosition',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'bumpPosition',
                [instanceAddress, targetPosition, additionalDuration],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'bumpPosition',
                receipt,
                instanceAddress,
                targetPosition
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'bumpPosition',
                error: this.wrapError(error, 'Failed to bump position')
            });
            throw error;
        }
    }

    /**
     * Deposit ETH for auto-renewal
     * @param {string} instanceAddress - Instance address
     * @param {string} amount - Amount in ETH
     * @returns {Promise<Object>} Transaction receipt
     */
    async depositForAutoRenewal(instanceAddress, amount) {
        try {
            const amountWei = ethers.utils.parseEther(amount);

            eventBus.emit('transaction:pending', {
                type: 'depositForAutoRenewal',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'depositForAutoRenewal',
                [instanceAddress],
                {
                    requiresSigner: true,
                    txOptions: { value: amountWei }
                }
            );

            eventBus.emit('transaction:success', {
                type: 'depositForAutoRenewal',
                receipt,
                instanceAddress,
                amount
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'depositForAutoRenewal',
                error: this.wrapError(error, 'Failed to deposit for auto-renewal')
            });
            throw error;
        }
    }

    /**
     * Withdraw auto-renewal deposit
     * @param {string} instanceAddress - Instance address
     * @returns {Promise<Object>} Transaction receipt
     */
    async withdrawRenewalDeposit(instanceAddress) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'withdrawRenewalDeposit',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'withdrawRenewalDeposit',
                [instanceAddress],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'withdrawRenewalDeposit',
                receipt,
                instanceAddress
            });

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'withdrawRenewalDeposit',
                error: this.wrapError(error, 'Failed to withdraw renewal deposit')
            });
            throw error;
        }
    }

    /**
     * Parse rental info from contract response
     * @private
     */
    _parseRentalInfo(info) {
        return {
            position: info.position !== undefined ? parseInt(info.position.toString()) : parseInt((info[0] || 0).toString()),
            expiresAt: info.expiresAt ? parseInt(info.expiresAt.toString()) : parseInt((info[1] || 0).toString()),
            autoRenewalDeposit: info.autoRenewalDeposit ? ethers.utils.formatEther(info.autoRenewalDeposit) : '0',
            isActive: info.isActive !== undefined ? info.isActive : info[3]
        };
    }

    // =========================
    // Cleanup Operations
    // =========================

    /**
     * Cleanup expired rentals (permissionless, incentivized)
     * @param {number} maxCleanup - Maximum number of rentals to cleanup
     * @returns {Promise<Object>} Transaction receipt
     */
    async cleanupExpiredRentals(maxCleanup) {
        try {
            eventBus.emit('transaction:pending', {
                type: 'cleanupExpiredRentals',
                contractAddress: this.contractAddress
            });

            const receipt = await this.executeContractCall(
                'cleanupExpiredRentals',
                [maxCleanup],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'cleanupExpiredRentals',
                receipt,
                maxCleanup
            });

            // Invalidate cache
            contractCache.invalidateByPattern('getFeaturedInstances', 'getRentalInfo');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'cleanupExpiredRentals',
                error: this.wrapError(error, 'Failed to cleanup expired rentals')
            });
            throw error;
        }
    }

    /**
     * Get queue utilization
     * @returns {Promise<Object>} Queue utilization metrics
     */
    async getQueueUtilization() {
        return await this.getCachedOrFetch('getQueueUtilization', [], async () => {
            const util = await this.executeContractCall('getQueueUtilization');
            return {
                totalSlots: parseInt(util.totalSlots?.toString() || util[0]?.toString() || '0'),
                occupiedSlots: parseInt(util.occupiedSlots?.toString() || util[1]?.toString() || '0'),
                utilizationPercent: parseFloat(util.utilizationPercent?.toString() || util[2]?.toString() || '0') / 100
            };
        }, CACHE_TTL.REALTIME);
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            totalFactories: await this.getTotalFactories(),
            totalVaults: await this.getTotalVaults()
        };
    }

    /**
     * Get balance (not applicable for registry)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for registry)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default MasterRegistryAdapter;
