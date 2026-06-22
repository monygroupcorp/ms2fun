/**
 * Mock Master Service
 * 
 * Simulates the master contract (IMasterRegistry) interface.
 * Manages factory authorization and instance tracking.
 */

import { saveMockData } from './mockData.js';

/**
 * Mock implementation of the master contract interface
 */
export default class MockMasterService {
    /**
     * @param {object} mockData - Shared mock data structure
     */
    constructor(mockData) {
        this.data = mockData;
        this.masterAddress = '0xMASTER0000000000000000000000000000000000';
    }

    /**
     * Register a factory with the master contract
     * @param {string} factoryAddress - Factory contract address
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @param {string} [title] - Optional factory title (defaults to generated title)
     * @throws {Error} If factory already registered
     */
    async registerFactory(factoryAddress, contractType, title = null) {
        if (!factoryAddress || !contractType) {
            throw new Error('Invalid parameters: factoryAddress and contractType are required');
        }

        if (contractType !== 'ERC404' && contractType !== 'ERC1155') {
            throw new Error(`Invalid contract type: ${contractType}. Must be 'ERC404' or 'ERC1155'`);
        }

        // Check if already registered
        const existing = this.data.masterContract.factories.find(
            f => f.address.toLowerCase() === factoryAddress.toLowerCase()
        );
        if (existing) {
            throw new Error('Factory already registered');
        }

        // Generate title if not provided
        const factoryTitle = title || this._generateFactoryTitle(contractType);
        const titleSlug = this._slugify(factoryTitle);

        // Add factory to master contract
        this.data.masterContract.factories.push({
            address: factoryAddress,
            type: contractType,
            title: titleSlug,
            displayTitle: factoryTitle,
            authorized: true,
            createdAt: Date.now(),
            instanceCount: 0
        });

        // Initialize factory entry
        if (!this.data.factories[factoryAddress]) {
            this.data.factories[factoryAddress] = {
                address: factoryAddress,
                type: contractType,
                title: titleSlug,
                displayTitle: factoryTitle,
                masterAddress: this.masterAddress,
                instances: [],
                createdAt: Date.now()
            };
        }

        this._save();
    }

    /**
     * Check if a factory is authorized
     * @param {string} factoryAddress - Factory contract address
     * @returns {boolean} True if factory is authorized
     */
    async isFactoryAuthorized(factoryAddress) {
        if (!factoryAddress) {
            return false;
        }

        const factory = this.data.masterContract.factories.find(
            f => f.address.toLowerCase() === factoryAddress.toLowerCase()
        );
        return factory ? factory.authorized : false;
    }

    /**
     * Get the contract type for a factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {string|null} Contract type or null if not found
     */
    async getFactoryType(factoryAddress) {
        if (!factoryAddress) {
            return null;
        }

        const factory = this.data.masterContract.factories.find(
            f => f.address.toLowerCase() === factoryAddress.toLowerCase()
        );
        return factory ? factory.type : null;
    }

    /**
     * Revoke factory authorization
     * @param {string} factoryAddress - Factory contract address
     * @throws {Error} If factory not found
     */
    async revokeFactory(factoryAddress) {
        if (!factoryAddress) {
            throw new Error('Invalid parameters: factoryAddress is required');
        }

        const factory = this.data.masterContract.factories.find(
            f => f.address.toLowerCase() === factoryAddress.toLowerCase()
        );
        if (!factory) {
            throw new Error('Factory not found');
        }

        factory.authorized = false;
        this._save();
    }

    /**
     * Get all authorized factory addresses
     * @returns {string[]} Array of authorized factory addresses
     */
    async getAuthorizedFactories() {
        return this.data.masterContract.factories
            .filter(f => f.authorized)
            .map(f => f.address);
    }

    /**
     * Get factories by contract type
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {string[]} Array of factory addresses of the specified type
     */
    async getFactoriesByType(contractType) {
        if (!contractType) {
            return [];
        }

        return this.data.masterContract.factories
            .filter(f => f.type === contractType && f.authorized)
            .map(f => f.address);
    }

    /**
     * Register an instance created by a factory
     * @param {string} factoryAddress - Factory contract address
     * @param {string} instanceAddress - Instance contract address
     * @param {string} metadataURI - Metadata URI for the instance
     * @throws {Error} If factory not authorized or not found
     */
    async registerInstance(factoryAddress, instanceAddress, metadataURI) {
        if (!factoryAddress || !instanceAddress) {
            throw new Error('Invalid parameters: factoryAddress and instanceAddress are required');
        }

        // Verify factory is authorized
        const isAuthorized = await this.isFactoryAuthorized(factoryAddress);
        if (!isAuthorized) {
            throw new Error('Factory not authorized');
        }

        // Verify factory exists
        if (!this.data.factories[factoryAddress]) {
            throw new Error('Factory not found');
        }

        // Add instance to factory
        if (!this.data.factories[factoryAddress].instances.includes(instanceAddress)) {
            this.data.factories[factoryAddress].instances.push(instanceAddress);
        }

        // Update factory instance count
        const factory = this.data.masterContract.factories.find(
            f => f.address.toLowerCase() === factoryAddress.toLowerCase()
        );
        if (factory) {
            factory.instanceCount = this.data.factories[factoryAddress].instances.length;
        }

        this._save();
    }

    /**
     * Get all instances created by a factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {string[]} Array of instance addresses
     */
    async getInstancesByFactory(factoryAddress) {
        if (!factoryAddress) {
            return [];
        }

        const factory = this.data.factories[factoryAddress];
        return factory ? [...factory.instances] : [];
    }

    /**
     * Get all instances across all factories
     * @returns {string[]} Array of all instance addresses
     */
    async getAllInstances() {
        const allInstances = [];
        for (const factory of Object.values(this.data.factories)) {
            allInstances.push(...factory.instances);
        }
        return allInstances;
    }

    /**
     * Get metadata URI for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {string|null} Metadata URI or null if not found
     */
    async getInstanceMetadata(instanceAddress) {
        if (!instanceAddress) {
            return null;
        }

        const instance = this.data.instances[instanceAddress];
        return instance ? instance.metadataURI : null;
    }

    /**
     * Convert text to URL-safe slug
     * @param {string} text - Text to slugify
     * @returns {string} URL-safe slug
     * @private
     */
    _slugify(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Generate factory title from contract type
     * @param {string} contractType - Contract type
     * @returns {string} Generated title
     * @private
     */
    _generateFactoryTitle(contractType) {
        return `${contractType} Factory`;
    }

    /**
     * Save data to localStorage
     * @private
     */
    _save() {
        saveMockData(this.data);
    }
}

