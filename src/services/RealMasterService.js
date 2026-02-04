/**
 * Real Master Service
 *
 * Implements the master contract interface using MasterRegistryAdapter.
 * Manages factory authorization and instance tracking.
 */

import MasterRegistryAdapter from './contracts/MasterRegistryAdapter.js';
import { getContractAddress } from '../config/contractConfig.js';
import walletService from './WalletService.js';
import { detectNetwork } from '../config/network.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * Real implementation of the master contract interface
 */
export default class RealMasterService {
    constructor() {
        this.masterRegistry = null;
        this.initialized = false;
    }

    /**
     * Get provider (from wallet or create read-only for local mode)
     */
    _getProvider() {
        const { provider } = walletService.getProviderAndSigner();

        // If wallet is connected, use its provider
        if (provider) {
            return { provider, signer: walletService.getProviderAndSigner().signer };
        }

        // For local mode, create a read-only JsonRpcProvider
        const network = detectNetwork();
        if (network.mode === 'local' && network.rpcUrl) {
            // Use StaticJsonRpcProvider for Anvil to skip network auto-detection entirely
            const readOnlyProvider = new ethers.providers.StaticJsonRpcProvider(
                network.rpcUrl,
                { name: 'anvil', chainId: network.chainId, ensAddress: null }
            );
            return { provider: readOnlyProvider, signer: null };
        }

        throw new Error('No provider available. Please connect a wallet or ensure local Anvil is running.');
    }

    /**
     * Initialize the master registry adapter
     */
    async _ensureInitialized() {
        if (this.initialized && this.masterRegistry) {
            return;
        }

        const masterAddress = await getContractAddress('MasterRegistryV1');
        if (!masterAddress) {
            throw new Error('MasterRegistry address not configured');
        }

        const { provider, signer } = this._getProvider();
        // MasterRegistryAdapter constructor: (contractAddress, contractType, ethersProvider, signer)
        this.masterRegistry = new MasterRegistryAdapter(masterAddress, 'MasterRegistry', provider, signer);
        await this.masterRegistry.initialize();
        this.initialized = true;
    }

    /**
     * Get master registry address
     * @returns {Promise<string>} Master registry contract address
     */
    async getMasterAddress() {
        return await getContractAddress('MasterRegistryV1');
    }

    /**
     * Get the underlying MasterRegistryAdapter instance
     * @returns {Promise<MasterRegistryAdapter>} The adapter instance
     */
    async getAdapter() {
        await this._ensureInitialized();
        return this.masterRegistry;
    }

    /**
     * Check if a factory is authorized
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<boolean>} True if factory is authorized
     */
    async isFactoryAuthorized(factoryAddress) {
        await this._ensureInitialized();
        return await this.masterRegistry.isFactoryRegistered(factoryAddress);
    }

    /**
     * Get factory information by ID
     * @param {number} factoryId - Factory ID
     * @returns {Promise<object|null>} Factory info or null if not found
     */
    async getFactory(factoryId) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getFactoryInfo(factoryId);
        } catch (error) {
            console.warn(`Error getting factory ${factoryId}:`, error);
            return null;
        }
    }

    /**
     * Get all registered factories
     * @returns {Promise<object[]>} Array of factory objects
     */
    async getAllFactories() {
        await this._ensureInitialized();
        const totalFactories = await this.masterRegistry.getTotalFactories();

        // Parallelize factory fetches - IDs start at 1
        const factoryPromises = [];
        for (let i = 1; i <= totalFactories; i++) {
            factoryPromises.push(
                this.masterRegistry.getFactoryInfo(i).catch(error => {
                    console.warn(`Error fetching factory ${i}:`, error);
                    return null;
                })
            );
        }

        const results = await Promise.all(factoryPromises);
        return results.filter(f => f !== null);
    }

    /**
     * Get factory by address
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<object|null>} Factory info or null if not found
     */
    async getFactoryByAddress(factoryAddress) {
        await this._ensureInitialized();
        const factories = await this.getAllFactories();
        return factories.find(f => f.factoryAddress.toLowerCase() === factoryAddress.toLowerCase()) || null;
    }

    /**
     * Get all registered vaults
     * @returns {Promise<object[]>} Array of vault objects
     */
    async getAllVaults() {
        await this._ensureInitialized();
        const totalVaults = await this.masterRegistry.getTotalVaults();

        // Parallelize vault fetches - IDs start at 1
        const vaultPromises = [];
        for (let i = 1; i <= totalVaults; i++) {
            vaultPromises.push(
                this.masterRegistry.getVaultInfo(i).catch(error => {
                    console.warn(`Error fetching vault ${i}:`, error);
                    return null;
                })
            );
        }

        const results = await Promise.all(vaultPromises);
        return results.filter(v => v !== null);
    }

    /**
     * Get instance information
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<object|null>} Instance info or null if not found
     */
    async getInstance(instanceAddress) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getInstanceInfo(instanceAddress);
        } catch (error) {
            console.warn(`Error getting instance ${instanceAddress}:`, error);
            return null;
        }
    }

    /**
     * Get governance mode (dictator or governance)
     * @returns {Promise<string>} 'dictator' or 'governance'
     */
    async getGovernanceMode() {
        await this._ensureInitialized();
        try {
            const dictator = await this.masterRegistry.dictator();
            const zeroAddress = '0x0000000000000000000000000000000000000000';
            return dictator !== zeroAddress ? 'dictator' : 'governance';
        } catch (error) {
            console.warn('Error getting governance mode:', error);
            return 'governance';
        }
    }

    /**
     * Get dictator address
     * @returns {Promise<string|null>} Dictator address or null
     */
    async getDictator() {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.dictator();
        } catch (error) {
            console.warn('Error getting dictator:', error);
            return null;
        }
    }

    /**
     * Get all registered instances
     * @returns {Promise<string[]>} Array of instance addresses
     */
    async getAllInstances() {
        await this._ensureInitialized();
        try {
            const totalInstances = await this.masterRegistry.getTotalInstances();

            // Parallelize instance address fetches
            const instancePromises = [];
            for (let i = 0; i < totalInstances; i++) {
                instancePromises.push(
                    this.masterRegistry.allInstances(i).catch(() => null)
                );
            }

            const results = await Promise.all(instancePromises);
            return results.filter(addr => addr !== null);
        } catch (error) {
            console.warn('Error getting all instances:', error);
            return [];
        }
    }

    /**
     * Get all authorized factory addresses
     * @returns {Promise<string[]>} Array of factory addresses
     */
    async getAuthorizedFactories() {
        const factories = await this.getAllFactories();
        return factories.map(f => f.factoryAddress);
    }

    /**
     * Get factory type by address
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<string|null>} Factory type ('ERC404' or 'ERC1155')
     */
    async getFactoryType(factoryAddress) {
        const factory = await this.getFactoryByAddress(factoryAddress);
        return factory?.contractType || null;
    }

    /**
     * Get GlobalMessageRegistry address
     * @returns {Promise<string>} GlobalMessageRegistry contract address
     */
    async getGlobalMessageRegistry() {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getGlobalMessageRegistry();
        } catch (error) {
            console.warn('Error getting GlobalMessageRegistry address:', error);
            return '0x0000000000000000000000000000000000000000';
        }
    }

    /**
     * Get top vaults sorted by TVL
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<object[]>} Array of vault objects sorted by TVL
     */
    async getVaultsByTVL(limit = 3) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getVaultsByTVL(limit);
        } catch (error) {
            console.warn('Error getting vaults by TVL:', error);
            // Fallback: get all vaults and sort manually
            const vaults = await this.getAllVaults();
            return vaults
                .sort((a, b) => parseFloat(b.tvl) - parseFloat(a.tvl))
                .slice(0, limit);
        }
    }

    /**
     * Get top vaults sorted by popularity (instance count)
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<object[]>} Array of vault objects sorted by instance count
     */
    async getVaultsByPopularity(limit = 3) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getVaultsByPopularity(limit);
        } catch (error) {
            console.warn('Error getting vaults by popularity:', error);
            // Fallback: get all vaults and sort manually
            const vaults = await this.getAllVaults();
            return vaults
                .sort((a, b) => b.instanceCount - a.instanceCount)
                .slice(0, limit);
        }
    }

    /**
     * Get vault info by address
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<object|null>} Vault info or null if not found
     */
    async getVaultInfo(vaultAddress) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getVaultInfo(vaultAddress);
        } catch (error) {
            console.warn(`Error getting vault info for ${vaultAddress}:`, error);
            return null;
        }
    }

    /**
     * Get total number of registered vaults
     * @returns {Promise<number>} Total vault count
     */
    async getTotalVaults() {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getTotalVaults();
        } catch (error) {
            console.warn('Error getting total vaults:', error);
            // Fallback: get all vaults and count
            const vaults = await this.getAllVaults();
            return vaults.length;
        }
    }

    /**
     * Get instances using a specific vault
     * @param {string} vaultAddress - Vault contract address
     * @returns {Promise<object[]>} Array of instance addresses/objects
     */
    async getInstancesByVault(vaultAddress) {
        await this._ensureInitialized();
        try {
            return await this.masterRegistry.getInstancesByVault(vaultAddress);
        } catch (error) {
            console.warn(`Error getting instances for vault ${vaultAddress}:`, error);
            return [];
        }
    }
}
