/**
 * ERC1155Factory Adapter
 *
 * Wraps ERC1155Factory contract functionality.
 * Handles instance creation, edition management, and factory configuration.
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

// Cache TTL configuration
const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (factory info, configurations)
    DYNAMIC: 5 * 60 * 1000,       // 5 minutes (instance counts)
};

class ERC1155FactoryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC1155Factory', ethersProvider, signer);
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
            const abi = await loadABI('ERC1155Factory');

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
            throw this.wrapError(error, 'ERC1155FactoryAdapter initialization failed');
        }
    }

    // =========================
    // Instance Creation
    // =========================

    /**
     * Create ERC1155 instance
     * @param {Object} params - Instance parameters
     * @param {string} params.name - Project name
     * @param {string} params.metadataURI - Metadata URI
     * @param {string} params.creator - Creator address
     * @param {string} params.vault - Vault address
     * @param {string} params.styleUri - Style URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async createInstance(params) {
        try {
            const {
                name,
                metadataURI,
                creator,
                vault,
                styleUri = ''
            } = params;

            eventBus.emit('transaction:pending', {
                type: 'createInstance',
                contractAddress: this.contractAddress,
                factoryType: 'ERC1155'
            });

            const receipt = await this.executeContractCall(
                'createInstance',
                [name, metadataURI, creator, vault, styleUri],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'createInstance',
                receipt,
                contractAddress: this.contractAddress,
                factoryType: 'ERC1155'
            });

            // Invalidate cache
            contractCache.invalidateByPattern('instance', 'factory');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'createInstance',
                error: this.wrapError(error, 'Instance creation failed')
            });
            throw error;
        }
    }

    /**
     * Get total instance count
     * @returns {Promise<number>} Total number of instances created
     */
    async getInstanceCount() {
        return await this.getCachedOrFetch('getInstanceCount', [], async () => {
            const count = await this.executeContractCall('getInstanceCount');
            return parseInt(count.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instance by index
     * @param {number} index - Instance index
     * @returns {Promise<string>} Instance contract address
     */
    async getInstance(index) {
        return await this.getCachedOrFetch('getInstance', [index], async () => {
            return await this.executeContractCall('getInstance', [index]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get all instances (paginated)
     * @param {number} startIndex - Start index
     * @param {number} endIndex - End index
     * @returns {Promise<Array<string>>} Array of instance addresses
     */
    async getInstances(startIndex, endIndex) {
        const total = await this.getInstanceCount();
        const actualEnd = Math.min(endIndex, total);

        const instances = [];
        for (let i = startIndex; i < actualEnd; i++) {
            const instance = await this.getInstance(i);
            instances.push(instance);
        }

        return instances;
    }

    // =========================
    // Edition Management
    // =========================

    /**
     * Add edition to instance (via factory)
     * @param {string} instanceAddress - Instance contract address
     * @param {Object} params - Edition parameters
     * @param {string} params.pieceTitle - Piece title
     * @param {string} params.basePrice - Base price in wei
     * @param {string} params.supply - Maximum supply (0 for unlimited)
     * @param {string} params.metadataURI - Edition metadata URI
     * @param {number} params.pricingModel - Pricing model (0=fixed, 1=linear, 2=exponential)
     * @param {string} params.priceIncreaseRate - Price increase rate (if dynamic pricing)
     * @returns {Promise<Object>} Transaction receipt
     */
    async addEdition(instanceAddress, params) {
        try {
            const {
                pieceTitle,
                basePrice,
                supply,
                metadataURI,
                pricingModel,
                priceIncreaseRate
            } = params;

            eventBus.emit('transaction:pending', {
                type: 'addEdition',
                contractAddress: this.contractAddress,
                instanceAddress
            });

            const receipt = await this.executeContractCall(
                'addEdition',
                [instanceAddress, pieceTitle, basePrice, supply, metadataURI, pricingModel, priceIncreaseRate],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'addEdition',
                receipt,
                contractAddress: this.contractAddress,
                instanceAddress
            });

            // Invalidate cache
            contractCache.invalidateByPattern('edition', 'instance');

            return receipt;
        } catch (error) {
            eventBus.emit('transaction:error', {
                type: 'addEdition',
                error: this.wrapError(error, 'Edition creation failed')
            });
            throw error;
        }
    }

    // =========================
    // Configuration
    // =========================

    /**
     * Get vault address for instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<string>} Vault contract address
     */
    async getVaultForInstance(instanceAddress) {
        return await this.getCachedOrFetch('getVaultForInstance', [instanceAddress], async () => {
            return await this.executeContractCall('getVaultForInstance', [instanceAddress]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Set default vault (owner only)
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setDefaultVault(vaultAddress) {
        try {
            const receipt = await this.executeContractCall(
                'setDefaultVault',
                [vaultAddress],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('vault', 'default');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set default vault');
        }
    }

    /**
     * Get default vault address
     * @returns {Promise<string>} Default vault contract address
     */
    async getDefaultVault() {
        return await this.getCachedOrFetch('getDefaultVault', [], async () => {
            return await this.executeContractCall('getDefaultVault');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Set tithe percentage (owner only)
     * @param {number} percentage - Tithe percentage (0-100)
     * @returns {Promise<Object>} Transaction receipt
     */
    async setTithePercentage(percentage) {
        try {
            const receipt = await this.executeContractCall(
                'setTithePercentage',
                [percentage],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('tithe');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set tithe percentage');
        }
    }

    /**
     * Get tithe percentage
     * @returns {Promise<number>} Tithe percentage
     */
    async getTithePercentage() {
        return await this.getCachedOrFetch('getTithePercentage', [], async () => {
            const percentage = await this.executeContractCall('getTithePercentage');
            return parseInt(percentage.toString());
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Factory Information
    // =========================

    /**
     * Get factory information
     * @returns {Promise<Object>} Factory details
     */
    async getFactoryInfo() {
        return await this.getCachedOrFetch('getFactoryInfo', [], async () => {
            const [instanceCount, defaultVault, tithePercentage] = await Promise.all([
                this.getInstanceCount(),
                this.getDefaultVault(),
                this.getTithePercentage()
            ]);

            return {
                factoryAddress: this.contractAddress,
                factoryType: 'ERC1155',
                instanceCount,
                defaultVault,
                tithePercentage
            };
        }, CACHE_TTL.DYNAMIC);
    }

    /**
     * Get instances created by a specific creator
     * @param {string} creatorAddress - Creator address
     * @returns {Promise<Array<string>>} Array of instance addresses
     */
    async getInstancesByCreator(creatorAddress) {
        return await this.getCachedOrFetch('getInstancesByCreator', [creatorAddress], async () => {
            const instances = await this.executeContractCall('getInstancesByCreator', [creatorAddress]);
            return instances.map(i => i.toString());
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Public State Variables
    // =========================

    /**
     * Get default vault (state variable)
     * @returns {Promise<string>} Default vault contract address
     */
    async defaultVault() {
        return await this.getCachedOrFetch('defaultVault', [], async () => {
            return await this.executeContractCall('defaultVault');
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get instance by index (state variable array accessor)
     * @param {number} index - Instance index
     * @returns {Promise<string>} Instance contract address
     */
    async instances(index) {
        return await this.getCachedOrFetch('instances', [index], async () => {
            return await this.executeContractCall('instances', [index]);
        }, CACHE_TTL.STATIC);
    }

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async masterRegistry() {
        return await this.getCachedOrFetch('masterRegistry', [], async () => {
            return await this.executeContractCall('masterRegistry');
        }, CACHE_TTL.STATIC);
    }

    // =========================
    // Contract Metadata
    // =========================

    /**
     * Get contract metadata
     * @returns {Promise<Object>} Contract metadata
     */
    async getMetadata() {
        const info = await this.getFactoryInfo();
        return {
            contractAddress: this.contractAddress,
            contractType: this.contractType,
            ...info
        };
    }

    /**
     * Get balance (not applicable for factory)
     * @returns {Promise<string>} Always returns '0'
     */
    async getBalance(address) {
        return '0';
    }

    /**
     * Get price (not applicable for factory)
     * @returns {Promise<number>} Always returns 0
     */
    async getPrice() {
        return 0;
    }
}

export default ERC1155FactoryAdapter;
