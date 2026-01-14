/**
 * Real Project Registry
 *
 * Manages project indexing, discovery, and search functionality.
 * Queries data from deployed contracts rather than mock storage.
 */

import RealMasterService from './RealMasterService.js';
import RealFactoryService from './RealFactoryService.js';
import ERC404BondingInstanceAdapter from './contracts/ERC404BondingInstanceAdapter.js';
import ERC1155Adapter from './contracts/ERC1155Adapter.js';
import walletService from './WalletService.js';
import { detectNetwork } from '../config/network.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * Real implementation of project registry
 */
export default class RealProjectRegistry {
    constructor() {
        this.masterService = new RealMasterService();
        this.factoryService = new RealFactoryService();
        this.projectCache = new Map();
        this.indexed = false;
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
                { name: 'anvil', chainId: network.chainId }
            );
            return { provider: readOnlyProvider, signer: null };
        }

        throw new Error('No provider available. Please connect a wallet or ensure local Anvil is running.');
    }

    /**
     * Index all projects from master contract
     * @returns {Promise<void>}
     */
    async indexFromMaster() {
        console.log('Indexing projects from MasterRegistry...');

        // Clear cache
        this.projectCache.clear();

        // Get all instances directly from master registry
        const allInstances = await this.masterService.getAllInstances();
        console.log(`Found ${allInstances.length} total instances`);

        // Fetch metadata for each instance
        for (const instanceAddress of allInstances) {
            try {
                // Get instance info from master registry to determine type
                const instanceInfo = await this.masterService.getInstance(instanceAddress);
                if (!instanceInfo) {
                    console.warn(`No info found for instance ${instanceAddress}`);
                    continue;
                }

                // Determine contract type from factory
                const factory = await this.masterService.getFactoryByAddress(instanceInfo.factoryAddress);
                const contractType = factory?.contractType || 'ERC1155';

                const metadata = await this._fetchInstanceMetadata(instanceAddress, contractType);
                if (metadata) {
                    // Add info from MasterRegistry
                    metadata.factoryAddress = instanceInfo.factoryAddress;
                    metadata.creator = instanceInfo.creator;
                    metadata.vault = instanceInfo.vault;
                    metadata.owner = instanceInfo.creator; // Use creator as owner
                    this.projectCache.set(instanceAddress, metadata);
                }
            } catch (error) {
                console.warn(`Error fetching metadata for instance ${instanceAddress}:`, error);
            }
        }

        this.indexed = true;
        console.log(`Indexed ${this.projectCache.size} projects`);
    }

    /**
     * Index projects from a specific factory
     * @param {string} factoryAddress - Factory contract address
     * @param {string} factoryType - Factory type ('ERC404' or 'ERC1155')
     * @returns {Promise<void>}
     */
    async indexFromFactory(factoryAddress, factoryType) {
        console.log(`Indexing instances from factory ${factoryAddress} (${factoryType})`);

        // Get instances from MasterRegistry (factories don't track instances themselves)
        const instances = await this.masterService.getInstancesByFactory(factoryAddress);
        console.log(`Found ${instances.length} instances in factory`);

        for (const instanceAddress of instances) {
            try {
                const metadata = await this._fetchInstanceMetadata(instanceAddress, factoryType);
                if (metadata) {
                    this.projectCache.set(instanceAddress, metadata);
                }
            } catch (error) {
                console.warn(`Error fetching metadata for instance ${instanceAddress}:`, error);
            }
        }
    }

    /**
     * Fetch metadata for a single instance
     * @param {string} instanceAddress - Instance contract address
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {Promise<object|null>} Instance metadata
     */
    async _fetchInstanceMetadata(instanceAddress, contractType) {
        const { provider, signer } = this._getProvider();
        let adapter;

        if (contractType === 'ERC404') {
            adapter = new ERC404BondingInstanceAdapter(instanceAddress, 'ERC404Bonding', provider, signer);
        } else if (contractType === 'ERC1155') {
            adapter = new ERC1155Adapter(instanceAddress, 'ERC1155', provider, signer);
        } else {
            return null;
        }

        await adapter.initialize();

        // Fetch basic metadata
        // Note: name() is available but owner() is not on all adapters
        // We'll get owner from the instance info in MasterRegistry instead
        const name = await adapter.name();

        return {
            address: instanceAddress,
            contractType: contractType,
            name: name,
            displayName: name,
            createdAt: Date.now() // We don't have creation timestamp on-chain
        };
    }

    /**
     * Get project by address
     * @param {string} projectAddress - Project contract address
     * @returns {Promise<object|null>} Project metadata or null
     */
    async getProject(projectAddress) {
        // Check cache first
        if (this.projectCache.has(projectAddress)) {
            return this.projectCache.get(projectAddress);
        }

        // Try to fetch from master registry
        const instance = await this.masterService.getInstance(projectAddress);
        if (!instance) {
            return null;
        }

        // Fetch full metadata
        const metadata = await this._fetchInstanceMetadata(projectAddress, instance.contractType);
        if (metadata) {
            this.projectCache.set(projectAddress, metadata);
        }

        return metadata;
    }

    /**
     * Search projects by query string
     * @param {string} query - Search query
     * @returns {Promise<object[]>} Array of matching project objects
     */
    async searchProjects(query) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        if (!query || query.trim() === '') {
            return Array.from(this.projectCache.values());
        }

        const lowerQuery = query.toLowerCase();
        const results = [];

        for (const project of this.projectCache.values()) {
            if (project.name?.toLowerCase().includes(lowerQuery) ||
                project.displayName?.toLowerCase().includes(lowerQuery) ||
                project.address?.toLowerCase().includes(lowerQuery)) {
                results.push(project);
            }
        }

        return results;
    }

    /**
     * Get projects by type
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {Promise<object[]>} Array of project objects
     */
    async getProjectsByType(contractType) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        return Array.from(this.projectCache.values())
            .filter(p => p.contractType === contractType);
    }

    /**
     * Get projects by factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<object[]>} Array of project objects
     */
    async getProjectsByFactory(factoryAddress) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        return Array.from(this.projectCache.values())
            .filter(p => p.factoryAddress?.toLowerCase() === factoryAddress.toLowerCase());
    }

    /**
     * Get all projects
     * @returns {Promise<object[]>} Array of all project objects
     */
    async getAllProjects() {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        return Array.from(this.projectCache.values());
    }

    /**
     * Get project by factory title and instance name (for URL routing)
     * @param {string} factoryTitle - Factory title slug
     * @param {string} instanceName - Instance name slug
     * @returns {Promise<object|null>} Project data with instance and factory info
     */
    async getProjectByPath(factoryTitle, instanceName) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        // Helper to slugify for comparison
        const slugify = (text) => {
            if (!text) return '';
            return text
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
        };

        // Load contracts config to get factory address by title
        try {
            const configResponse = await fetch('/src/config/contracts.local.json');
            if (!configResponse.ok) {
                console.error('Failed to load contracts config');
                return null;
            }

            const config = await configResponse.json();
            const factory = config.factories?.find(f =>
                slugify(f.title) === slugify(factoryTitle)
            );

            if (!factory) {
                console.error(`Factory not found for title: ${factoryTitle}`);
                return null;
            }

            // Find project with matching factory address and name
            const projects = Array.from(this.projectCache.values());
            const instance = projects.find(p =>
                p.factoryAddress?.toLowerCase() === factory.address.toLowerCase() &&
                slugify(p.name) === slugify(instanceName)
            );

            if (!instance) {
                console.error(`Instance not found: factory=${factoryTitle}, name=${instanceName}`);
                return null;
            }

            return {
                factory: {
                    address: factory.address,
                    title: factory.title,
                    type: factory.type
                },
                instance
            };
        } catch (error) {
            console.error('Error in getProjectByPath:', error);
            return null;
        }
    }

    /**
     * Get project by instance name only (simpler routing without factory)
     * @param {string} instanceName - Instance name slug
     * @returns {Promise<object|null>} Project data with instance info
     */
    async getProjectByName(instanceName) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        // Helper to slugify for comparison
        const slugify = (text) => {
            if (!text) return '';
            return text
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
        };

        // Find project with matching name
        const projects = Array.from(this.projectCache.values());
        const instance = projects.find(p => slugify(p.name) === slugify(instanceName));

        if (!instance) {
            console.error(`Instance not found: name=${instanceName}`);
            return null;
        }

        // Get factory info if available
        let factory = null;
        if (instance.factoryAddress) {
            try {
                const configResponse = await fetch('/src/config/contracts.local.json');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    const factoryConfig = config.factories?.find(f =>
                        f.address.toLowerCase() === instance.factoryAddress.toLowerCase()
                    );
                    if (factoryConfig) {
                        factory = {
                            address: factoryConfig.address,
                            title: factoryConfig.title,
                            type: factoryConfig.type
                        };
                    }
                }
            } catch (error) {
                console.warn('Could not load factory info:', error);
            }
        }

        return {
            factory,
            instance
        };
    }

    /**
     * Clear project cache
     */
    clearCache() {
        this.projectCache.clear();
        this.indexed = false;
    }

    /**
     * Check if registry is indexed
     * @returns {boolean} True if indexed
     */
    isIndexed() {
        return this.indexed;
    }

    /**
     * Index a single project
     * @param {string} projectAddress - Project contract address
     * @param {object} metadata - Optional metadata
     * @returns {Promise<void>}
     */
    async indexProject(projectAddress, metadata = null) {
        try {
            const instanceInfo = await this.masterService.getInstance(projectAddress);
            if (!instanceInfo) {
                console.warn(`No info found for instance ${projectAddress}`);
                return;
            }

            const factory = await this.masterService.getFactoryByAddress(instanceInfo.factoryAddress);
            const contractType = factory?.contractType || 'ERC1155';

            const fetchedMetadata = metadata || await this._fetchInstanceMetadata(projectAddress, contractType);
            if (fetchedMetadata) {
                fetchedMetadata.factoryAddress = instanceInfo.factoryAddress;
                this.projectCache.set(projectAddress, fetchedMetadata);
            }
        } catch (error) {
            console.warn(`Error indexing project ${projectAddress}:`, error);
        }
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
                sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                break;
            case 'volume':
                sorted.sort((a, b) => {
                    const volA = parseFloat(a.stats?.volume || '0') || 0;
                    const volB = parseFloat(b.stats?.volume || '0') || 0;
                    return volB - volA;
                });
                break;
            case 'name':
                sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                break;
            default:
                // Default to date sorting
                sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                break;
        }

        return sorted;
    }

    /**
     * Filter by contract type
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {Promise<object[]>} Filtered projects
     */
    async filterByType(contractType) {
        return this.getProjectsByType(contractType);
    }

    /**
     * Filter by factory
     * @param {string} factoryAddress - Factory contract address
     * @returns {Promise<object[]>} Filtered projects
     */
    async filterByFactory(factoryAddress) {
        return this.getProjectsByFactory(factoryAddress);
    }

    /**
     * Filter by creator
     * @param {string} creatorAddress - Creator address
     * @returns {Promise<object[]>} Filtered projects
     */
    async filterByCreator(creatorAddress) {
        if (!this.indexed) {
            await this.indexFromMaster();
        }

        if (!creatorAddress) {
            return [];
        }

        return Array.from(this.projectCache.values())
            .filter(p => p.creator?.toLowerCase() === creatorAddress.toLowerCase());
    }
}
