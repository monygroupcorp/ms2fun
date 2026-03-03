/**
 * DataAdapter - Provides data based on detected environment mode
 *
 * Returns appropriate data structure for:
 * - LOCAL_BLOCKCHAIN: Real data from local Anvil contracts
 * - PLACEHOLDER_MOCK: Hardcoded placeholder data
 * - PRODUCTION_DEPLOYED: Real data from deployed contracts
 * - COMING_SOON: Minimal content for pre-launch state
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { ActivityIndexer } from './ActivityIndexer.js';
import QueryAggregatorAdapter from './contracts/QueryAggregatorAdapter.js';
import { projectIndex } from './ProjectIndex.js';
import { debug } from '../utils/debug.js';

// HARDCODED: CULT EXECS is always the featured project
const CULT_EXECS_FEATURED = {
    address: '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2',
    name: 'CULT EXECUTIVES',
    symbol: 'EXEC',
    type: 'ERC404',
    description: 'The flagship ERC404 project. Bonding curve trading with automatic NFT minting.',
    isFeatured: true,
    isHardcoded: true
};

export class DataAdapter {
    constructor(mode, config, provider = null) {
        this.mode = mode;
        this.config = config;
        this.provider = provider;
    }

    /**
     * Get critical data (featured + projects) - fast, priority load
     * @returns {Promise<object>}
     */
    async getCriticalData() {
        switch (this.mode) {
            case 'LOCAL_BLOCKCHAIN':
            case 'PRODUCTION_DEPLOYED':
                return this.getBlockchainCriticalData();

            case 'PLACEHOLDER_MOCK':
                return this.getPlaceholderCriticalData();

            case 'COMING_SOON':
                return this.getComingSoonData();

            default:
                debug.error('[DataAdapter] Unknown mode:', this.mode);
                return this.getPlaceholderCriticalData();
        }
    }

    /**
     * Get activity data - lazy, async load
     * @param {number} limit - Maximum number of items to return (0 = all)
     * @returns {Promise<Array>}
     */
    async getActivity(limit = 0) {
        if (this.mode === 'COMING_SOON') {
            return [];
        }

        // Index activity in background (pass provider for network flexibility)
        const indexer = new ActivityIndexer(this.config, this.provider);
        const allActivity = await indexer.indexRecentActivity();

        // Return limited or all activity
        return limit > 0 ? allActivity.slice(0, limit) : allActivity;
    }

    /**
     * Get home page data based on current mode (DEPRECATED - use getCriticalData + getActivity)
     * @returns {Promise<object>}
     */
    async getHomePageData() {
        const criticalData = await this.getCriticalData();
        const activity = await this.getActivity();
        return { ...criticalData, activity };
    }

    /**
     * Get critical data from blockchain (featured + projects, no activity)
     * Uses QueryAggregator for optimized single-call data fetching
     * @returns {Promise<object>}
     */
    async getBlockchainCriticalData() {
        console.log('[DataAdapter] getBlockchainCriticalData called, config:', !!this.config, 'provider:', !!this.provider);

        if (!this.config) {
            debug.error('[DataAdapter] No config available for blockchain mode');
            return this.getPlaceholderCriticalData();
        }

        try {
            const { contracts, vaults } = this.config;
            console.log('[DataAdapter] contracts:', {
                QueryAggregator: contracts?.QueryAggregator,
                MasterRegistryV1: contracts?.MasterRegistryV1,
                hasProvider: !!this.provider
            });

            // Use QueryAggregator for optimized data fetching
            if (contracts?.QueryAggregator && contracts?.MasterRegistryV1 && this.provider) {
                console.log('[DataAdapter] ✓ Starting index pipeline...');
                try {
                    const t0 = performance.now();
                    console.log('[DataAdapter] Creating QueryAggregatorAdapter...');
                    const aggregator = new QueryAggregatorAdapter(
                        contracts.QueryAggregator,
                        'QueryAggregator',
                        this.provider
                    );
                    console.log('[DataAdapter] Initializing aggregator...');
                    await aggregator.initialize();
                    console.log('[DataAdapter] ✓ Aggregator initialized');

                    // Index pipeline: Sync ProjectIndex → Get instance addresses → Batch query via QueryAggregator
                    console.log('[DataAdapter] Creating MasterRegistry contract...');

                    const MasterRegistry = new ethers.Contract(
                        contracts.MasterRegistryV1,
                        ['event InstanceRegistered(address indexed instance, address indexed factory, address indexed creator, string name)'],
                        this.provider
                    );
                    console.log('[DataAdapter] ✓ MasterRegistry contract created:', MasterRegistry.address);

                    // Sync project index (indexes InstanceRegistered events)
                    console.log('[DataAdapter] Syncing ProjectIndex...');
                    const syncResult = await projectIndex.sync(MasterRegistry, this.provider);
                    console.log(`[DataAdapter] ✓ ProjectIndex synced: ${syncResult.added} new, ${syncResult.updated} updated`);

                    // Sync lifecycle states (StateChanged events + instanceType)
                    const stateUpdates = await projectIndex.syncLifecycleStates(this.provider);
                    console.log(`[DataAdapter] ✓ Lifecycle states synced: ${stateUpdates} updates`);

                    // Get all instance addresses from index
                    const indexedProjects = await projectIndex.getAllProjects(20, 0); // Get first 20
                    const instanceAddresses = indexedProjects.map(p => p.address);
                    debug.log(`[DataAdapter] ✓ ProjectIndex has ${instanceAddresses.length} instances`);

                    // Create lookup map for indexed data (instanceType, currentState)
                    const indexedDataMap = new Map();
                    indexedProjects.forEach(p => {
                        indexedDataMap.set(p.address.toLowerCase(), {
                            instanceType: p.instanceType,
                            currentState: p.currentState
                        });
                    });

                    // Batch query via QueryAggregator to hydrate with full on-chain data
                    let projects = [];
                    let totalFeatured = 0;

                    if (instanceAddresses.length > 0) {
                        const t1 = performance.now();
                        const projectCards = await aggregator.getProjectCardsBatch(instanceAddresses);
                        const t2 = performance.now();

                        // Merge QueryAggregator data with indexed lifecycle data
                        projects = projectCards.map(card => {
                            const indexed = indexedDataMap.get(card.instance.toLowerCase());
                            return {
                                ...card,
                                instanceType: indexed?.instanceType || null,
                                currentState: indexed?.currentState || null
                            };
                        });

                        // Count how many are featured
                        totalFeatured = projects.filter(p => p.featuredRank > 0).length;

                        debug.log(`[DataAdapter] ✓ QueryAggregator hydrated ${projects.length} projects (${(t2 - t1).toFixed(0)}ms), ${totalFeatured} featured`);
                    }

                    // Extract featured project (rank === 1)
                    let featured = null;
                    const featuredCard = projects.find(p => p.featuredRank === 1);

                    if (featuredCard) {
                        featured = {
                            address: featuredCard.instance,
                            name: featuredCard.name || 'Featured Project',
                            symbol: '', // Not in ProjectCard
                            type: featuredCard.contractType,
                            description: '', // Not available in ProjectCard yet
                            creator: featuredCard.creator,
                            isFeatured: true
                        };
                        debug.log(`[DataAdapter] ✓ Featured project: "${featured.name}" (${featured.type})`);
                    } else if (projects.length > 0) {
                        // Use first project if no featured
                        const firstCard = projects[0];
                        featured = {
                            address: firstCard.instance,
                            name: firstCard.name || 'Project',
                            symbol: '',
                            type: firstCard.contractType,
                            description: '',
                            creator: firstCard.creator,
                            isFeatured: false
                        };
                        debug.log(`[DataAdapter] ✓ No featured project, using first: "${featured.name}"`);
                    } else {
                        // Fall back to hardcoded CULT EXECS if no projects at all
                        featured = CULT_EXECS_FEATURED;
                        debug.log(`[DataAdapter] ⚠ No projects found, using fallback: "${featured.name}"`);
                    }

                    // Convert ProjectCard format to internal format (match existing structure)
                    const allProjects = projects.map(card => ({
                        address: card.instance,
                        name: card.name,
                        symbol: '', // Not in ProjectCard
                        type: card.contractType, // String type (deprecated)
                        instanceType: card.instanceType, // bytes32 type (from IInstanceLifecycle)
                        currentState: card.currentState, // bytes32 state (from StateChanged events)
                        description: '', // Not available yet
                        creator: card.creator,
                        factory: card.factory,
                        vault: card.vault,
                        currentPrice: card.currentPrice,
                        totalSupply: card.totalSupply,
                        maxSupply: card.maxSupply,
                        isActive: card.isActive,
                        featuredRank: card.featuredRank,
                        featuredExpires: card.featuredExpires
                    }));

                    // Format vault data (from config for now - QueryAggregator doesn't have vault list yet)
                    const vaultData = (vaults || []).map(v => ({
                        address: v.address,
                        name: v.name || 'Alignment Vault',
                        tvl: v.tvl || '0.00',
                        type: 'vault'
                    }));

                    return {
                        featured,
                        projects: allProjects,
                        vaults: vaultData,
                        contracts: {
                            masterRegistry: contracts?.MasterRegistryV1,
                            queryAggregator: contracts?.QueryAggregator,
                            erc404Factory: contracts?.ERC404Factory,
                            erc1155Factory: contracts?.ERC1155Factory,
                            featuredQueueManager: contracts?.FeaturedQueueManager,
                            globalMessageRegistry: contracts?.GlobalMessageRegistry
                        }
                    };
                } catch (error) {
                    console.error('[DataAdapter] Error in index pipeline:', error);
                    console.error('[DataAdapter] Error stack:', error.stack);
                    // Fall back to placeholder on error
                    return this.getPlaceholderCriticalData();
                }
            } else {
                debug.warn('[DataAdapter] QueryAggregator not available, using placeholder data');
                return this.getPlaceholderCriticalData();
            }
        } catch (error) {
            debug.error('[DataAdapter] Error loading blockchain data:', error);
            return this.getPlaceholderCriticalData();
        }
    }

    /**
     * Get placeholder critical data (no activity)
     * @returns {object}
     */
    getPlaceholderCriticalData() {
        return {
            // Featured is ALWAYS CULT EXECS (hardcoded rule)
            featured: CULT_EXECS_FEATURED,
            projects: [
                {
                    address: '0x1111111111111111111111111111111111111111',
                    name: 'Demo Project Alpha',
                    symbol: 'ALPHA',
                    type: 'ERC404',
                    creator: '0x1234567890123456789012345678901234567890',
                    bondingCurve: {
                        currentPrice: '0.015',
                        totalSupply: '500'
                    }
                },
                {
                    address: '0x2222222222222222222222222222222222222222',
                    name: 'Demo Project Beta',
                    symbol: 'BETA',
                    type: 'ERC1155',
                    creator: '0x1234567890123456789012345678901234567890'
                },
                {
                    address: '0x3333333333333333333333333333333333333333',
                    name: 'Demo Project Gamma',
                    symbol: 'GAMMA',
                    type: 'ERC404',
                    creator: '0x1234567890123456789012345678901234567890',
                    bondingCurve: {
                        currentPrice: '0.042',
                        totalSupply: '2000'
                    }
                }
            ],
            vaults: [
                {
                    address: '0x4444444444444444444444444444444444444444',
                    name: 'Alignment Vault Alpha',
                    tvl: '125.50',
                    type: 'vault'
                },
                {
                    address: '0x5555555555555555555555555555555555555555',
                    name: 'Alignment Vault Beta',
                    tvl: '87.25',
                    type: 'vault'
                }
            ],
            contracts: null
        };
    }

    /**
     * Get placeholder data (DEPRECATED - use getPlaceholderCriticalData + getActivity)
     * @returns {object}
     */
    getPlaceholderData() {
        return {
            ...this.getPlaceholderCriticalData(),
            activity: this.getMockActivity()
        };
    }

    /**
     * Get minimal content for coming soon state
     * @returns {object}
     */
    getComingSoonData() {
        return {
            featured: null,
            projects: [],
            vaults: [],
            activity: [],
            message: 'MS2 is launching soon. Stay tuned!',
            contracts: null
        };
    }

    /**
     * Get mock activity data
     * TODO: Replace with micro-web3 event indexing
     * @returns {Array}
     */
    getMockActivity() {
        return [
            {
                type: 'mint',
                project: 'Art Collection Alpha',
                user: '0x1234...5678',
                amount: '5',
                timestamp: Date.now() - 300000 // 5 min ago
            },
            {
                type: 'trade',
                project: 'Demo Project Beta',
                user: '0x9876...4321',
                amount: '2.5 ETH',
                timestamp: Date.now() - 900000 // 15 min ago
            },
            {
                type: 'message',
                project: 'Demo Project Gamma',
                user: '0xabcd...ef01',
                content: 'Great project!',
                timestamp: Date.now() - 1800000 // 30 min ago
            }
        ];
    }

    /**
     * Index recent activity using micro-web3
     * TODO: Implement when ready to use micro-web3
     * @returns {Promise<Array>}
     */
    async indexRecentActivity() {
        // Future implementation:
        // - Query GlobalMessageRegistry for recent messages
        // - Index ERC404/ERC1155 transfer events
        // - Index bonding curve trade events
        // - Return formatted activity items
        return this.getMockActivity();
    }
}

export default DataAdapter;
