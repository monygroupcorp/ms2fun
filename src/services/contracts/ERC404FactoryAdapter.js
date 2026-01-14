/**
 * ERC404Factory Adapter
 *
 * Wraps ERC404Factory contract functionality.
 * Handles instance creation and factory configuration.
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

class ERC404FactoryAdapter extends ContractAdapter {
    constructor(contractAddress, contractType, ethersProvider, signer) {
        super(contractAddress, contractType || 'ERC404Factory', ethersProvider, signer);
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
            const abi = await loadABI('ERC404Factory');

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
            throw this.wrapError(error, 'ERC404FactoryAdapter initialization failed');
        }
    }

    // =========================
    // Instance Creation
    // =========================

    /**
     * Create ERC404 bonding instance
     * @param {Object} params - Instance parameters
     * @param {string} params.name - Token name
     * @param {string} params.symbol - Token symbol
     * @param {string} params.metadataURI - Metadata URI
     * @param {string} params.maxSupply - Maximum supply
     * @param {number} params.liquidityReservePercent - Liquidity reserve percentage
     * @param {Object} params.curveParams - Bonding curve parameters
     * @param {Object} params.tierConfig - Tier configuration
     * @param {string} params.creator - Creator address
     * @param {string} params.vault - Vault address
     * @param {string} params.styleUri - Style URI
     * @returns {Promise<Object>} Transaction receipt
     */
    async createInstance(params) {
        try {
            const {
                name,
                symbol,
                metadataURI,
                maxSupply,
                liquidityReservePercent,
                curveParams,
                tierConfig,
                creator,
                vault,
                styleUri = ''
            } = params;

            eventBus.emit('transaction:pending', {
                type: 'createInstance',
                contractAddress: this.contractAddress,
                factoryType: 'ERC404'
            });

            const receipt = await this.executeContractCall(
                'createInstance',
                [name, symbol, metadataURI, maxSupply, liquidityReservePercent, curveParams, tierConfig, creator, vault, styleUri],
                { requiresSigner: true }
            );

            eventBus.emit('transaction:success', {
                type: 'createInstance',
                receipt,
                contractAddress: this.contractAddress,
                factoryType: 'ERC404'
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
    // Configuration
    // =========================

    /**
     * Get hook address for instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<string>} Hook contract address
     */
    async getHookForInstance(instanceAddress) {
        return await this.getCachedOrFetch('getHookForInstance', [instanceAddress], async () => {
            return await this.executeContractCall('getHookForInstance', [instanceAddress]);
        }, CACHE_TTL.STATIC);
    }

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
     * Set default hook (owner only)
     * @param {string} hookAddress - Hook contract address
     * @returns {Promise<Object>} Transaction receipt
     */
    async setDefaultHook(hookAddress) {
        try {
            const receipt = await this.executeContractCall(
                'setDefaultHook',
                [hookAddress],
                { requiresSigner: true }
            );

            contractCache.invalidateByPattern('hook', 'default');
            return receipt;
        } catch (error) {
            throw this.wrapError(error, 'Failed to set default hook');
        }
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
     * Get default hook address
     * @returns {Promise<string>} Default hook contract address
     */
    async getDefaultHook() {
        return await this.getCachedOrFetch('getDefaultHook', [], async () => {
            return await this.executeContractCall('getDefaultHook');
        }, CACHE_TTL.STATIC);
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

    // =========================
    // Factory Information
    // =========================

    /**
     * Get factory information
     * @returns {Promise<Object>} Factory details
     */
    async getFactoryInfo() {
        return await this.getCachedOrFetch('getFactoryInfo', [], async () => {
            const [instanceCount, defaultHook, defaultVault] = await Promise.all([
                this.getInstanceCount(),
                this.getDefaultHook(),
                this.getDefaultVault()
            ]);

            return {
                factoryAddress: this.contractAddress,
                factoryType: 'ERC404',
                instanceCount,
                defaultHook,
                defaultVault
            };
        }, CACHE_TTL.DYNAMIC);
    }

    // =========================
    // Public State Variables
    // =========================

    /**
     * Get default hook (state variable)
     * @returns {Promise<string>} Default hook contract address
     */
    async defaultHook() {
        return await this.getCachedOrFetch('defaultHook', [], async () => {
            return await this.executeContractCall('defaultHook');
        }, CACHE_TTL.STATIC);
    }

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

    /**
     * Get exec token address
     * @returns {Promise<string>} Exec token contract address
     */
    async exec() {
        return await this.getCachedOrFetch('exec', [], async () => {
            return await this.executeContractCall('exec');
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

export default ERC404FactoryAdapter;
