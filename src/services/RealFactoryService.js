/**
 * Real Factory Service
 *
 * Implements factory contract interfaces using factory adapters.
 * Creates and manages project instances.
 */

import ERC404FactoryAdapter from './contracts/ERC404FactoryAdapter.js';
import ERC1155FactoryAdapter from './contracts/ERC1155FactoryAdapter.js';
import walletService from './WalletService.js';
import { detectNetwork } from '../config/network.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * Real implementation of factory contract interface
 */
export default class RealFactoryService {
    constructor() {
        this.factoryCache = new Map();
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
     * Get or create factory adapter
     * @param {string} factoryAddress - Factory contract address
     * @param {string} factoryType - Factory type ('ERC404' or 'ERC1155')
     * @returns {Promise<object>} Factory adapter instance
     */
    async _getFactoryAdapter(factoryAddress, factoryType) {
        if (this.factoryCache.has(factoryAddress)) {
            return this.factoryCache.get(factoryAddress);
        }

        const { provider, signer } = this._getProvider();
        let adapter;

        if (factoryType === 'ERC404') {
            adapter = new ERC404FactoryAdapter(factoryAddress, 'ERC404Factory', provider, signer);
        } else if (factoryType === 'ERC1155') {
            adapter = new ERC1155FactoryAdapter(factoryAddress, 'ERC1155Factory', provider, signer);
        } else {
            throw new Error(`Unknown factory type: ${factoryType}`);
        }

        await adapter.initialize();
        this.factoryCache.set(factoryAddress, adapter);
        return adapter;
    }

    /**
     * Get factory information
     * @param {string} factoryAddress - Factory contract address
     * @param {string} factoryType - Factory type ('ERC404' or 'ERC1155')
     * @returns {Promise<object>} Factory information
     */
    async getFactory(factoryAddress, factoryType) {
        const adapter = await this._getFactoryAdapter(factoryAddress, factoryType);

        return {
            address: factoryAddress,
            type: factoryType,
            masterRegistry: await adapter.masterRegistry(),
            instanceCount: await adapter.getInstanceCount()
        };
    }

    /**
     * Get instances created by a factory
     * @param {string} factoryAddress - Factory contract address
     * @param {string} factoryType - Factory type ('ERC404' or 'ERC1155')
     * @param {number} limit - Maximum number of instances to fetch (default: 50)
     * @returns {Promise<string[]>} Array of instance addresses
     */
    async getInstances(factoryAddress, factoryType, limit = 50) {
        const adapter = await this._getFactoryAdapter(factoryAddress, factoryType);
        const instanceCount = await adapter.getInstanceCount();
        const maxIndex = Math.min(instanceCount, limit);
        const instances = [];

        // Fetch instance addresses
        for (let i = 0; i < maxIndex; i++) {
            try {
                const instanceAddress = await adapter.instances(i);
                if (instanceAddress) {
                    instances.push(instanceAddress);
                }
            } catch (error) {
                console.warn(`Error fetching instance at index ${i}:`, error);
            }
        }

        return instances;
    }

    /**
     * Create a new instance
     * Note: This requires a connected wallet with transaction permissions
     * @param {string} factoryAddress - Factory contract address
     * @param {string} factoryType - Factory type ('ERC404' or 'ERC1155')
     * @param {object} params - Instance creation parameters
     * @returns {Promise<string>} New instance address
     */
    async createInstance(factoryAddress, factoryType, params) {
        const adapter = await this._getFactoryAdapter(factoryAddress, factoryType);

        // Creation parameters depend on factory type
        // For now, throw error as we need proper parameter handling
        throw new Error('Instance creation not yet implemented in real service');
    }

    /**
     * Clear factory cache
     */
    clearCache() {
        this.factoryCache.clear();
    }
}
