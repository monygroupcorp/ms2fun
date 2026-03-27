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
import ERC721AuctionInstanceAdapter from './contracts/ERC721AuctionInstanceAdapter.js';
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
                { name: 'anvil', chainId: network.chainId, ensAddress: null }
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

                const [metadata, presentation] = await Promise.all([
                    this._fetchInstanceMetadata(instanceAddress, contractType),
                    this._fetchPresentationFields(instanceAddress)
                ]);
                if (metadata) {
                    // Add info from MasterRegistry
                    metadata.factoryAddress = instanceInfo.factoryAddress;
                    metadata.creator = instanceInfo.creator;
                    metadata.vault = instanceInfo.vault;
                    metadata.owner = instanceInfo.creator;

                    // Parse metadataURI for NFT-standard fields
                    const onChainMeta = this._parseDataUri(instanceInfo.metadataURI);
                    if (onChainMeta) {
                        metadata.image = metadata.image || onChainMeta.image || '';
                        metadata.category = metadata.category || onChainMeta.category || '';
                        metadata.tags = metadata.tags || onChainMeta.tags || [];
                    }

                    // Merge styleUri presentation fields
                    metadata.project_photo = presentation.project_photo || '';
                    metadata.project_banner = presentation.project_banner || '';
                    metadata.description = presentation.description || metadata.description || (onChainMeta?.description) || '';

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
     * Fetch metadata for a single instance including stats
     * @param {string} instanceAddress - Instance contract address
     * @param {string} contractType - Contract type ('ERC404' or 'ERC1155')
     * @returns {Promise<object|null>} Instance metadata with stats
     */
    _parseDataUri(uri) {
        if (!uri) return null;
        try {
            if (uri.startsWith('data:application/json,')) {
                return JSON.parse(decodeURIComponent(uri.replace('data:application/json,', '')));
            }
            if (uri.startsWith('data:application/json;base64,')) {
                return JSON.parse(atob(uri.replace('data:application/json;base64,', '')));
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /**
     * Fetch styleUri from an instance contract and extract presentation fields.
     * Both ERC404 and ERC1155 expose a public `styleUri()` view.
     */
    async _fetchPresentationFields(instanceAddress) {
        const { provider } = this._getProvider();
        if (!provider) return {};
        try {
            const minAbi = ['function styleUri() view returns (string)'];
            const contract = new ethers.Contract(instanceAddress, minAbi, provider);
            const uri = await contract.styleUri();
            const parsed = this._parseDataUri(uri);
            if (!parsed) return {};
            return {
                project_photo: parsed.project_photo || '',
                project_banner: parsed.project_banner || '',
                description: parsed.description || ''
            };
        } catch (e) {
            return {};
        }
    }

    async _fetchInstanceMetadata(instanceAddress, contractType) {
        const { provider, signer } = this._getProvider();
        let adapter;

        if (contractType === 'ERC404') {
            adapter = new ERC404BondingInstanceAdapter(instanceAddress, 'ERC404Bonding', provider, signer);
        } else if (contractType === 'ERC1155') {
            adapter = new ERC1155Adapter(instanceAddress, 'ERC1155', provider, signer);
        } else if (contractType === 'ERC721' || contractType === 'ERC721AUCTION') {
            adapter = new ERC721AuctionInstanceAdapter(instanceAddress, 'ERC721Auction', provider, signer);
        } else {
            return null;
        }

        await adapter.initialize();

        // Fetch stats and name based on contract type
        let name = '';
        let stats = {
            volume: '0 ETH',
            holders: 0,
            totalSupply: 0
        };

        try {
            if (contractType === 'ERC404') {
                // Get project metadata which includes name and reserve (ETH volume)
                const projectMeta = await adapter.getProjectMetadata();
                name = projectMeta.name || '';

                // Handle BigNumber or string for reserve
                const reserveWei = projectMeta.reserve ? projectMeta.reserve.toString() : '0';
                const volumeEth = ethers.utils.formatEther(reserveWei);

                stats = {
                    volume: `${parseFloat(volumeEth).toFixed(4)} ETH`,
                    totalSupply: projectMeta.totalBondingSupply?.toString() || '0',
                    maxSupply: projectMeta.maxSupply?.toString() || '0',
                    bondingActive: projectMeta.bondingActive,
                    holders: 0 // Would need event indexing to calculate
                };
            } else if (contractType === 'ERC1155') {
                // Get name separately for ERC1155
                name = await adapter.name();

                // Get instance stats (volume calculated from editions)
                const instanceStats = await adapter.getInstanceStats();

                stats = {
                    volume: `${parseFloat(instanceStats.volumeEth).toFixed(4)} ETH`,
                    totalSupply: instanceStats.totalMinted,
                    editionCount: instanceStats.editionCount,
                    holders: 0 // Would need event indexing to calculate
                };
            } else if (contractType === 'ERC721' || contractType === 'ERC721AUCTION') {
                name = await adapter.getName();

                const config = await adapter.getConfig();
                stats = {
                    volume: '0 ETH',
                    lines: config.lines,
                    baseDuration: config.baseDuration,
                    holders: 0
                };
            }
        } catch (error) {
            console.error(`[RealProjectRegistry] Error fetching metadata for ${instanceAddress} (${contractType}):`, error);
            // Try to get at least the name as fallback
            if (!name) {
                try {
                    name = await adapter.name();
                } catch (nameError) {
                    console.error(`[RealProjectRegistry] Failed to get name for ${instanceAddress}:`, nameError);
                }
            }
        }

        return {
            address: instanceAddress,
            contractType: contractType,
            name: name,
            displayName: name,
            createdAt: Date.now(), // We don't have creation timestamp on-chain
            stats: stats
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

        // Resolve contractType from factory (instance info doesn't include it)
        const factory = await this.masterService.getFactoryByAddress(instance.factoryAddress);
        const contractType = factory?.contractType || 'ERC1155';

        // Fetch full metadata and styleUri presentation fields in parallel
        const [metadata, presentation] = await Promise.all([
            this._fetchInstanceMetadata(projectAddress, contractType),
            this._fetchPresentationFields(projectAddress)
        ]);
        if (metadata) {
            metadata.factoryAddress = instance.factoryAddress;
            metadata.creator = instance.creator;
            metadata.vault = instance.vault;

            // Parse metadataURI for NFT-standard fields (image, category, tags)
            const onChainMeta = this._parseDataUri(instance.metadataURI);
            if (onChainMeta) {
                metadata.image = metadata.image || onChainMeta.image || '';
                metadata.category = metadata.category || onChainMeta.category || '';
                metadata.tags = metadata.tags || onChainMeta.tags || [];
            }

            // Merge styleUri presentation fields (take priority over metadataURI for description)
            metadata.project_photo = presentation.project_photo || '';
            metadata.project_banner = presentation.project_banner || '';
            metadata.description = presentation.description || metadata.description || (onChainMeta?.description) || '';

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
        // Helper to slugify for comparison
        const slugify = (text) => {
            if (!text) return '';
            return text
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
        };

        // Fast path: resolve address from config file, then fetch just that project
        try {
            const network = detectNetwork();
            const configPath = network.contracts;
            if (configPath) {
                const response = await fetch(configPath);
                if (response.ok) {
                    const config = await response.json();
                    const allInstances = [
                        ...(config.instances?.erc404 || []),
                        ...(config.instances?.erc1155 || []),
                        ...(config.instances?.erc721 || [])
                    ];
                    const configInstance = allInstances.find(inst =>
                        slugify(inst.name) === slugify(instanceName)
                    );
                    if (configInstance) {
                        console.log(`[RealProjectRegistry] Fast-path: resolved "${instanceName}" -> ${configInstance.address}`);
                        const project = await this.getProject(configInstance.address);
                        if (project) {
                            let factory = null;
                            if (project.factoryAddress) {
                                const factoryConfig = config.factories?.find(f =>
                                    f.address.toLowerCase() === project.factoryAddress.toLowerCase()
                                );
                                if (factoryConfig) {
                                    factory = { address: factoryConfig.address, title: factoryConfig.title, type: factoryConfig.type };
                                }
                            }
                            return { factory, instance: project };
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[RealProjectRegistry] Config fast-path failed, falling back to index:', error);
        }

        // Slow path: full index scan
        if (!this.indexed) {
            await this.indexFromMaster();
        }

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
