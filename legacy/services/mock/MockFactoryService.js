/**
 * Mock Factory Service
 * 
 * Simulates factory contract interfaces.
 * Creates and manages project instances.
 */

import { generateMockAddress, saveMockData } from './mockData.js';

/**
 * Mock implementation of factory contract interface
 */
export default class MockFactoryService {
    /**
     * @param {object} mockData - Shared mock data structure
     * @param {MockMasterService} masterService - Master service instance
     */
    constructor(mockData, masterService) {
        this.data = mockData;
        this.masterService = masterService;
    }

    /**
     * Create a new project instance
     * @param {string} factoryAddress - Factory contract address
     * @param {string} name - Project name
     * @param {string} symbol - Project symbol
     * @param {object} parameters - Instance parameters
     * @param {string} [parameters.name] - Instance name (overrides name parameter)
     * @param {string} [parameters.description] - Project description
     * @param {string} [parameters.metadataURI] - Metadata URI
     * @param {string} [parameters.creator] - Creator address
     * @param {string} [parameters.imageURI] - Project image/logo URI
     * @param {string} [parameters.creatorName] - Creator display name
     * @param {boolean} [parameters.creatorVerified] - Creator verification status
     * @param {string} [parameters.websiteURI] - Project website
     * @param {string} [parameters.twitterURI] - Twitter/X link
     * @param {string} [parameters.githubURI] - GitHub link
     * @param {string[]} [parameters.tags] - Project tags
     * @param {string} [parameters.category] - Project category
     * @param {boolean} [parameters.featured] - Featured project flag
     * @param {string} [parameters.status] - Instance status (Active, Paused, Archived, Suspended)
     * @param {boolean} [parameters.verified] - Contract verification status
     * @param {object} [parameters.audit] - Audit information
     * @param {Array} [parameters.pieces] - ERC1155 pieces array (for ERC1155 instances)
     * @returns {Promise<string>} Instance contract address
     * @throws {Error} If factory not found or invalid parameters
     */
    async createInstance(factoryAddress, name, symbol, parameters = {}) {
        if (!factoryAddress || !name || !symbol) {
            throw new Error('Invalid parameters: factoryAddress, name, and symbol are required');
        }

        // Verify factory exists
        const factory = this.data.factories[factoryAddress];
        if (!factory) {
            throw new Error('Factory not found');
        }

        // Generate mock instance address
        const instanceAddress = this._generateMockAddress();

        // Generate name slug if not provided in parameters
        const instanceName = parameters.name || name;
        const nameSlug = this._slugify(instanceName);

        // Determine owner (use provided owner, creator, or default mock owner)
        const owner = parameters.owner || 
                     parameters.creator || 
                     this.data.mockOwnerAddress || 
                     '0xMOCKOWNER000000000000000000000000000000';

        // Create instance entry with all required fields from CONTRACT_REQUIREMENTS.md
        const instance = {
            id: `project-${Date.now()}`,
            address: instanceAddress,
            factoryAddress: factoryAddress,
            contractType: factory.type,
            name: nameSlug,  // URL-safe name
            displayName: instanceName,  // Display name
            title: instanceName,  // Keep for backward compatibility
            symbol: symbol,
            description: parameters.description || '',
            metadataURI: parameters.metadataURI || '',
            imageURI: parameters.imageURI || '',  // Project image/logo
            creator: parameters.creator || '0xCREATOR0000000000000000000000000000000000',
            creatorName: parameters.creatorName || '',  // Creator display name
            creatorVerified: parameters.creatorVerified || false,  // Creator verification status
            owner: owner,  // Set owner for admin functionality
            createdAt: Date.now(),
            status: parameters.status || 'Active',  // Instance status (Active, Paused, Archived, Suspended)
            featured: parameters.featured || false,  // Featured project flag
            tags: parameters.tags || [],  // Project tags
            category: parameters.category || '',  // Project category
            websiteURI: parameters.websiteURI || '',  // Project website
            twitterURI: parameters.twitterURI || '',  // Twitter/X link
            githubURI: parameters.githubURI || '',  // GitHub link
            verified: parameters.verified !== undefined ? parameters.verified : true,  // Contract verification (default true for mock)
            audit: parameters.audit || {  // Audit information
                audited: false,
                auditReportURI: '',
                auditor: null,
                auditDate: null
            },
            parameters: { ...parameters },
            stats: {
                totalSupply: 0,
                holders: 0,
                volume: '0 ETH'
            }
        };

        // Add pieces for ERC1155
        if (factory.type === 'ERC1155' && parameters.pieces && Array.isArray(parameters.pieces)) {
            instance.pieces = parameters.pieces.map((piece, index) => ({
                id: piece.id || `piece-${Date.now()}-${index}`,
                title: this._slugify(piece.title || piece.displayTitle || `piece-${index + 1}`),
                displayTitle: piece.displayTitle || piece.title || `Piece ${index + 1}`,
                editionId: piece.editionId || index + 1,
                price: piece.price || '0 ETH',
                supply: piece.supply || 0,
                minted: piece.minted || 0
            }));
        }

        // Add to instances
        this.data.instances[instanceAddress] = instance;

        // Add to factory
        if (!factory.instances.includes(instanceAddress)) {
            factory.instances.push(instanceAddress);
        }

        // Initialize admin state for the new instance (for admin dashboard)
        if (!this.data.adminStates) {
            this.data.adminStates = {};
        }
        this.data.adminStates[instanceAddress] = {
            metadataLocked: false,
            style: null,
            metadata: null,
            paused: false,
            balance: '0'
        };

        // Register with master
        await this.masterService.registerInstance(
            factoryAddress,
            instanceAddress,
            instance.metadataURI
        );

        // Update project index
        this._updateIndex(instance);

        this._save();

        return instanceAddress;
    }

    /**
     * Get all instances created by a factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<string[]>} Array of instance addresses
     */
    async getInstances(factoryAddress) {
        if (!factoryAddress) {
            return [];
        }

        const factory = this.data.factories[factoryAddress];
        return factory ? [...factory.instances] : [];
    }

    /**
     * Get the number of instances created by a factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<number>} Instance count
     */
    async getInstanceCount(factoryAddress) {
        if (!factoryAddress) {
            return 0;
        }

        const factory = this.data.factories[factoryAddress];
        return factory ? factory.instances.length : 0;
    }

    /**
     * Get instance parameters
     * @param {string} instanceAddress - Instance contract address
     * @returns {Promise<object|null>} Instance parameters or null if not found
     */
    async getInstanceParameters(instanceAddress) {
        if (!instanceAddress) {
            return null;
        }

        const instance = this.data.instances[instanceAddress];
        return instance ? instance.parameters : null;
    }

    /**
     * Get factory contract type
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<string|null>} Contract type or null if not found
     */
    async getFactoryType(factoryAddress) {
        if (!factoryAddress) {
            return null;
        }

        const factory = this.data.factories[factoryAddress];
        return factory ? factory.type : null;
    }

    /**
     * Get master registry address
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<string|null>} Master registry address or null if not found
     */
    async getMasterRegistry(factoryAddress) {
        if (!factoryAddress) {
            return null;
        }

        const factory = this.data.factories[factoryAddress];
        return factory ? factory.masterAddress : null;
    }

    /**
     * Generate a mock Ethereum address
     * @returns {string} Mock address
     * @private
     */
    _generateMockAddress() {
        return generateMockAddress();
    }

    /**
     * Update project index with new instance
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
     * Save data to localStorage
     * @private
     */
    _save() {
        saveMockData(this.data);
    }
}

