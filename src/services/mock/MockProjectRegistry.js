/**
 * Mock Project Registry
 * 
 * Manages project indexing, discovery, and search functionality.
 */

import { saveMockData } from './mockData.js';

/**
 * Mock implementation of project registry
 */
export default class MockProjectRegistry {
    /**
     * @param {object} mockData - Shared mock data structure
     */
    constructor(mockData) {
        this.data = mockData;
        this.indexed = false;
    }

    /**
     * Index all projects from master contract
     * @returns {Promise<void>}
     */
    async indexFromMaster() {
        // Get all instances from master
        const allInstances = Object.values(this.data.instances);

        // Rebuild index
        this.data.projectIndex = {
            byType: {},
            byFactory: {},
            byCreator: {},
            all: []
        };

        for (const instance of allInstances) {
            this._updateIndex(instance);
        }

        this.indexed = true;
        this._save();
    }

    /**
     * Index projects from a specific factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<void>}
     */
    async indexFromFactory(factoryAddress) {
        if (!factoryAddress) {
            return;
        }

        const factory = this.data.factories[factoryAddress];
        if (!factory) {
            return;
        }

        for (const instanceAddress of factory.instances) {
            const instance = this.data.instances[instanceAddress];
            if (instance) {
                this._updateIndex(instance);
            }
        }

        this._save();
    }

    /**
     * Index a single project
     * @param {string} projectId - Project ID (instance address)
     * @param {object} metadata - Project metadata (optional, will use existing if not provided)
     * @returns {Promise<void>}
     */
    async indexProject(projectId, metadata = null) {
        if (!projectId) {
            return;
        }

        const instance = this.data.instances[projectId];
        if (!instance) {
            return;
        }

        // Update metadata if provided
        if (metadata) {
            Object.assign(instance, metadata);
        }

        this._updateIndex(instance);
        this._save();
    }

    /**
     * Search projects by query string
     * @param {string} query - Search query
     * @returns {Promise<object[]>} Array of matching project objects
     */
    async searchProjects(query) {
        if (!query || typeof query !== 'string') {
            return [];
        }

        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const instance of Object.values(this.data.instances)) {
            if (
                instance.name.toLowerCase().includes(lowerQuery) ||
                instance.description.toLowerCase().includes(lowerQuery) ||
                instance.symbol.toLowerCase().includes(lowerQuery)
            ) {
                results.push(instance);
            }
        }

        return results;
    }

    /**
     * Filter projects by contract type
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {Promise<object[]>} Array of project objects
     */
    async filterByType(contractType) {
        if (!contractType) {
            return [];
        }

        const addresses = this.data.projectIndex.byType[contractType] || [];
        return addresses
            .map(addr => this.data.instances[addr])
            .filter(Boolean);
    }

    /**
     * Filter projects by factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<object[]>} Array of project objects
     */
    async filterByFactory(factoryAddress) {
        if (!factoryAddress) {
            return [];
        }

        const addresses = this.data.projectIndex.byFactory[factoryAddress] || [];
        return addresses
            .map(addr => this.data.instances[addr])
            .filter(Boolean);
    }

    /**
     * Filter projects by creator
     * @param {string} creatorAddress - Creator address
     * @returns {Promise<object[]>} Array of project objects
     */
    async filterByCreator(creatorAddress) {
        if (!creatorAddress) {
            return [];
        }

        const addresses = this.data.projectIndex.byCreator[creatorAddress] || [];
        return addresses
            .map(addr => this.data.instances[addr])
            .filter(Boolean);
    }

    /**
     * Sort projects by specified key
     * @param {string} sortKey - Sort key ('date', 'volume', 'name')
     * @param {object[]} projects - Array of project objects to sort
     * @returns {Promise<object[]>} Sorted array of project objects
     */
    async sortBy(sortKey, projects) {
        if (!Array.isArray(projects)) {
            return [];
        }

        const sorted = [...projects];

        switch (sortKey) {
            case 'date':
                sorted.sort((a, b) => b.createdAt - a.createdAt);
                break;
            case 'volume':
                sorted.sort((a, b) => {
                    const volA = parseFloat(a.stats?.volume || '0') || 0;
                    const volB = parseFloat(b.stats?.volume || '0') || 0;
                    return volB - volA;
                });
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            default:
                // Default: by date (newest first)
                sorted.sort((a, b) => b.createdAt - a.createdAt);
        }

        return sorted;
    }

    /**
     * Get a project by instance address
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<object|null>} Project object or null if not found
     */
    async getProject(instanceAddress) {
        if (!instanceAddress) {
            return null;
        }

        return this.data.instances[instanceAddress] || null;
    }

    /**
     * Get project by navigation path
     * @param {string} factoryTitle - Factory title slug
     * @param {string} instanceName - Instance name slug
     * @param {string} [pieceTitle] - Optional piece title slug
     * @returns {Promise<object|null>} Project data or null if not found
     */
    async getProjectByPath(factoryTitle, instanceName, pieceTitle = null) {
        // Find factory by title
        const factory = await this.getFactoryByTitle(factoryTitle);
        if (!factory) {
            return null;
        }

        // Find instance by name in factory
        const instance = Object.values(this.data.instances).find(
            inst => inst.factoryAddress === factory.address && 
                    inst.name === instanceName
        );

        if (!instance) {
            return null;
        }

        // If piece title provided, find the piece
        if (pieceTitle && instance.pieces) {
            const piece = instance.pieces.find(p => p.title === pieceTitle);
            if (!piece) {
                return null;
            }

            return {
                factory,
                instance,
                piece
            };
        }

        return {
            factory,
            instance
        };
    }

    /**
     * Get factory by title slug
     * @param {string} factoryTitle - Factory title slug
     * @returns {Promise<object|null>} Factory data or null if not found
     */
    async getFactoryByTitle(factoryTitle) {
        const factory = Object.values(this.data.factories).find(
            f => f.title === factoryTitle
        );

        if (!factory) {
            return null;
        }

        return factory;
    }

    /**
     * Get all projects
     * @returns {Promise<object[]>} Array of all project objects
     */
    async getAllProjects() {
        return Object.values(this.data.instances);
    }

    /**
     * Check if projects have been indexed
     * @returns {boolean} True if indexed
     */
    isIndexed() {
        return this.indexed;
    }

    /**
     * Update project index with instance
     * @param {object} instance - Instance data
     * @private
     */
    _updateIndex(instance) {
        // Update byType index
        const type = instance.contractType;
        if (!this.data.projectIndex.byType[type]) {
            this.data.projectIndex.byType[type] = [];
        }
        if (!this.data.projectIndex.byType[type].includes(instance.address)) {
            this.data.projectIndex.byType[type].push(instance.address);
        }

        // Update byFactory index
        if (!this.data.projectIndex.byFactory[instance.factoryAddress]) {
            this.data.projectIndex.byFactory[instance.factoryAddress] = [];
        }
        if (!this.data.projectIndex.byFactory[instance.factoryAddress].includes(instance.address)) {
            this.data.projectIndex.byFactory[instance.factoryAddress].push(instance.address);
        }

        // Update byCreator index
        if (!this.data.projectIndex.byCreator[instance.creator]) {
            this.data.projectIndex.byCreator[instance.creator] = [];
        }
        if (!this.data.projectIndex.byCreator[instance.creator].includes(instance.address)) {
            this.data.projectIndex.byCreator[instance.creator].push(instance.address);
        }

        // Update all index
        if (!this.data.projectIndex.all.includes(instance.address)) {
            this.data.projectIndex.all.push(instance.address);
        }
    }

    /**
     * Set owner for an instance
     * @param {string} instanceAddress - Instance contract address
     * @param {string} ownerAddress - Owner address
     * @returns {Promise<void>}
     */
    async setInstanceOwner(instanceAddress, ownerAddress) {
        if (!instanceAddress || !ownerAddress) {
            return;
        }

        const instance = this.data.instances[instanceAddress];
        if (instance) {
            instance.owner = ownerAddress;
            this._save();
        }
    }

    /**
     * Get owner for an instance
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<string|null>} Owner address or null
     */
    async getInstanceOwner(instanceAddress) {
        if (!instanceAddress) {
            return null;
        }

        const instance = this.data.instances[instanceAddress];
        if (instance && instance.owner) {
            return instance.owner;
        }

        // Return default mock owner
        return this.data.mockOwnerAddress || '0xMOCKOWNER000000000000000000000000000000';
    }

    /**
     * Save data to localStorage
     * @private
     */
    _save() {
        saveMockData(this.data);
    }
}

