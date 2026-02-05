/**
 * QueryService
 *
 * Central service for all data fetching with caching and deduplication.
 * Uses QueryAggregator contract when available, falls back to individual adapters.
 *
 * Key features:
 * - TTL-based caching with automatic expiration
 * - In-flight request deduplication (same request → same Promise)
 * - Transaction-based cache invalidation
 * - Fallback mode when QueryAggregator is unavailable
 */

import { eventBus } from '../core/EventBus.js';
import QueryAggregatorAdapter from './contracts/QueryAggregatorAdapter.js';
import walletService from './WalletService.js';
import { isPreLaunch } from '../config/contractConfig.js';

// Cache TTL configuration
const TTL = {
    homePageData: 10 * 1000,      // 10s - changes frequently
    projectCard: 30 * 1000,        // 30s - semi-static
    portfolioData: 5 * 1000,       // 5s - user-specific
    vaultLeaderboard: 60 * 1000,   // 60s - slow changing
};

class QueryService {
    constructor() {
        this.cache = new Map();           // key → { data, expiresAt }
        this.inFlight = new Map();        // key → Promise
        this.aggregator = null;
        this.aggregatorAvailable = null;  // null = unknown, true/false = tested
        this.preLaunchMode = false;       // true when on mainnet but contracts not deployed
        this.initPromise = null;

        // Set up event listeners for cache invalidation
        this._setupEventListeners();
    }

    /**
     * Initialize the service and QueryAggregator adapter
     * @returns {Promise<boolean>} True if QueryAggregator is available
     */
    async initialize() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async _doInitialize() {
        try {
            // Check if ServiceFactory is in mock mode
            const { default: serviceFactory } = await import('./ServiceFactory.js');
            await serviceFactory.ensureInitialized();

            if (serviceFactory.isUsingMock()) {
                console.log('[QueryService] Mock mode detected - using mock data');
                this.preLaunchMode = true; // Reuse pre-launch behavior for mock
                this.aggregatorAvailable = false;
                return false;
            }

            // Check for pre-launch mode (mainnet but contracts not deployed)
            const preLaunch = await isPreLaunch();
            if (preLaunch) {
                console.log('[QueryService] Pre-launch mode detected - contracts not deployed yet');
                this.preLaunchMode = true;
                this.aggregatorAvailable = false;
                return false;
            }

            // Get QueryAggregator address from contracts.local.json or network config
            const address = await this._getQueryAggregatorAddress();

            if (!address || address === '0x0000000000000000000000000000000000000000') {
                console.log('[QueryService] QueryAggregator not deployed, using fallback mode');
                this.aggregatorAvailable = false;
                return false;
            }

            // Get provider
            const { provider, signer } = await this._getProviderAndSigner();

            if (!provider) {
                console.warn('[QueryService] No provider available, using fallback mode');
                this.aggregatorAvailable = false;
                return false;
            }

            // Create and initialize adapter
            this.aggregator = new QueryAggregatorAdapter(
                address,
                'QueryAggregator',
                provider,
                signer
            );

            await this.aggregator.initialize();
            this.aggregatorAvailable = true;
            console.log('[QueryService] QueryAggregator initialized at', address);
            return true;
        } catch (error) {
            console.warn('[QueryService] Failed to initialize QueryAggregator, using fallback:', error.message);
            this.aggregatorAvailable = false;
            return false;
        }
    }

    /**
     * Get QueryAggregator address from config
     * @private
     */
    async _getQueryAggregatorAddress() {
        try {
            // First try contracts.local.json
            const response = await fetch('/contracts.local.json');
            if (response.ok) {
                const config = await response.json();
                if (config.QueryAggregator) {
                    return config.QueryAggregator;
                }
            }
        } catch (e) {
            // Fall through to network config
        }

        try {
            // Try network config
            const { getContractAddress } = await import('../config/contractConfig.js');
            return await getContractAddress('QueryAggregator');
        } catch (e) {
            return null;
        }
    }

    /**
     * Get provider and signer
     * @private
     */
    async _getProviderAndSigner() {
        // Try wallet first
        const walletProviderAndSigner = walletService.getProviderAndSigner();
        if (walletProviderAndSigner.provider) {
            return walletProviderAndSigner;
        }

        // Fall back to read-only provider for local mode
        const { detectNetwork } = await import('../config/network.js');
        const network = detectNetwork();

        if (network.mode === 'local' && network.rpcUrl) {
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const provider = new ethers.providers.StaticJsonRpcProvider(
                network.rpcUrl,
                { name: 'anvil', chainId: network.chainId, ensAddress: null }
            );
            return { provider, signer: null };
        }

        return { provider: null, signer: null };
    }

    /**
     * Set up event listeners for cache invalidation
     * @private
     */
    _setupEventListeners() {
        // Invalidate on user transactions
        eventBus.on('transaction:confirmed', ({ contractAddress }) => {
            this.invalidateUserData();
            if (contractAddress) {
                this.invalidateProject(contractAddress);
            }
        });

        // Invalidate on wallet changes
        eventBus.on('wallet:connected', () => {
            this.invalidateUserData();
        });

        eventBus.on('wallet:disconnected', () => {
            this.invalidateUserData();
        });

        // Invalidate on contract reload (dev mode)
        eventBus.on('contracts:reloaded', () => {
            this.clearAll();
            this.initPromise = null;
            this.aggregator = null;
            this.aggregatorAvailable = null;
            this.preLaunchMode = false; // Re-check on next init
        });
    }

    // =========================
    // Main Query Methods
    // =========================

    /**
     * Get home page data (featured projects, top vaults, recent activity)
     * @param {number} offset - Starting position in featured queue
     * @param {number} limit - Number of projects to return
     * @returns {Promise<Object>} Home page data
     */
    async getHomePageData(offset = 0, limit = 20) {
        await this.initialize();

        // Pre-launch mode: return empty data gracefully
        if (this.preLaunchMode) {
            console.log('[QueryService] Pre-launch mode: returning empty home page data');
            return {
                projects: [],
                totalFeatured: 0,
                topVaults: [],
                recentActivity: []
            };
        }

        const key = `home:${offset}:${limit}`;

        if (this.aggregatorAvailable) {
            try {
                return await this._cachedQuery(key, 'homePageData', () =>
                    this.aggregator.getHomePageData(offset, limit)
                );
            } catch (error) {
                console.warn('[QueryService] QueryAggregator.getHomePageData failed, using fallback:', error.message);
                // Fall through to fallback
            }
        }

        // Fallback: use individual services
        return this._cachedQuery(key, 'homePageData', () =>
            this._fallbackGetHomePageData(offset, limit)
        );
    }

    /**
     * Get project cards for multiple addresses
     * @param {Array<string>} addresses - Instance addresses
     * @returns {Promise<Array>} Array of ProjectCard objects
     */
    async getProjectCardsBatch(addresses) {
        if (!addresses || addresses.length === 0) {
            return [];
        }

        await this.initialize();

        // Pre-launch mode: return empty array
        if (this.preLaunchMode) {
            return [];
        }

        // Check cache for each, only fetch missing
        const results = [];
        const missing = [];
        const missingIndices = [];

        for (let i = 0; i < addresses.length; i++) {
            const addr = addresses[i].toLowerCase();
            const cached = this._getFromCache(`project:${addr}`);
            if (cached !== null) {
                results[i] = cached;
            } else {
                missing.push(addresses[i]);
                missingIndices.push(i);
            }
        }

        if (missing.length > 0) {
            let cards;

            if (this.aggregatorAvailable) {
                cards = await this.aggregator.getProjectCardsBatch(missing);
            } else {
                cards = await this._fallbackGetProjectCardsBatch(missing);
            }

            // Cache and place in results
            cards.forEach((card, idx) => {
                const addr = missing[idx].toLowerCase();
                this._setCache(`project:${addr}`, card, 'projectCard');
                results[missingIndices[idx]] = card;
            });
        }

        return results;
    }

    /**
     * Get single project card
     * @param {string} address - Instance address
     * @returns {Promise<Object|null>} ProjectCard or null
     */
    async getProjectCard(address) {
        const cards = await this.getProjectCardsBatch([address]);
        return cards[0] || null;
    }

    /**
     * Get portfolio data for a user
     * @param {string} userAddress - User address
     * @param {Array<string>} instances - Instance addresses to check (optional)
     * @returns {Promise<Object>} Portfolio data
     */
    async getPortfolioData(userAddress, instances = []) {
        if (!userAddress) {
            throw new Error('User address is required');
        }

        await this.initialize();

        // Pre-launch mode: return empty portfolio
        if (this.preLaunchMode) {
            return {
                erc404Holdings: [],
                erc1155Holdings: [],
                vaultPositions: [],
                totalClaimable: '0'
            };
        }

        const key = `portfolio:${userAddress.toLowerCase()}:${instances.length}`;

        if (this.aggregatorAvailable && instances.length > 0) {
            return this._cachedQuery(key, 'portfolioData', () =>
                this.aggregator.getPortfolioData(userAddress, instances)
            );
        }

        // Fallback: use individual services
        return this._cachedQuery(key, 'portfolioData', () =>
            this._fallbackGetPortfolioData(userAddress, instances)
        );
    }

    /**
     * Get vault leaderboard
     * @param {number} sortBy - 0 = by TVL, 1 = by popularity
     * @param {number} limit - Number of vaults to return
     * @returns {Promise<Array>} Array of VaultSummary objects
     */
    async getVaultLeaderboard(sortBy = 0, limit = 10) {
        await this.initialize();

        // Pre-launch mode: return empty array
        if (this.preLaunchMode) {
            return [];
        }

        const key = `vaults:${sortBy}:${limit}`;

        if (this.aggregatorAvailable) {
            try {
                return await this._cachedQuery(key, 'vaultLeaderboard', () =>
                    this.aggregator.getVaultLeaderboard(sortBy, limit)
                );
            } catch (error) {
                console.warn('[QueryService] QueryAggregator.getVaultLeaderboard failed, using fallback:', error.message);
                // Fall through to fallback
            }
        }

        // Fallback: use MasterRegistry
        return this._cachedQuery(key, 'vaultLeaderboard', () =>
            this._fallbackGetVaultLeaderboard(sortBy, limit)
        );
    }

    // =========================
    // Fallback Methods
    // =========================

    /**
     * Fallback: Get home page data using individual services
     * @private
     */
    async _fallbackGetHomePageData(offset, limit) {
        const serviceFactory = (await import('./ServiceFactory.js')).default;
        const masterService = serviceFactory.getMasterService();

        // Get all instances (fallback doesn't have featured queue access)
        // In fallback mode, we just show the most recent instances
        let allInstances = [];
        let totalFeatured = 0;
        try {
            allInstances = await masterService.getAllInstances();
            totalFeatured = allInstances.length;
        } catch (e) {
            console.warn('[QueryService] Failed to get instances:', e.message);
        }

        // Apply offset and limit
        const featuredAddresses = allInstances
            .slice(offset, offset + limit)
            .map(inst => inst.instanceAddress || inst.address || inst);

        // Get project cards for featured (this will use individual adapter calls)
        const projects = await this._fallbackGetProjectCardsBatch(featuredAddresses);

        // Get top vaults
        const topVaults = await this._fallbackGetVaultLeaderboard(0, 3);

        // Get recent activity
        let recentActivity = [];
        try {
            const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
            recentActivity = await messageAdapter.getRecentMessages(5);
        } catch (e) {
            console.warn('[QueryService] Failed to get recent messages:', e.message);
        }

        return {
            projects,
            totalFeatured,
            topVaults,
            recentActivity
        };
    }

    /**
     * Fallback: Get project cards using individual adapter calls
     * @private
     */
    async _fallbackGetProjectCardsBatch(addresses) {
        const serviceFactory = (await import('./ServiceFactory.js')).default;
        const masterService = serviceFactory.getMasterService();

        const cards = await Promise.all(addresses.map(async (address) => {
            try {
                // Get instance info from registry
                const instanceInfo = await masterService.getInstance(address);

                if (!instanceInfo) {
                    throw new Error('Instance not found');
                }

                // Get factory info
                let factoryInfo = { contractType: 'Unknown', title: 'Unknown' };
                if (instanceInfo.factory) {
                    try {
                        factoryInfo = await masterService.getFactoryByAddress(instanceInfo.factory);
                    } catch (e) {
                        // Ignore factory info errors
                    }
                }

                // Get vault info
                let vaultInfo = { name: 'Unknown' };
                if (instanceInfo.vault) {
                    try {
                        vaultInfo = await masterService.getVaultInfo(instanceInfo.vault);
                    } catch (e) {
                        // Ignore vault info errors
                    }
                }

                // Get dynamic data from instance (getCardData)
                let cardData = { currentPrice: '0', totalSupply: '0', maxSupply: null, isActive: false };
                try {
                    const projectService = serviceFactory.getProjectService();
                    const adapter = await projectService.getAdapterForInstance(address, factoryInfo.contractType);
                    if (adapter && typeof adapter.getCardData === 'function') {
                        cardData = await adapter.getCardData();
                    }
                } catch (e) {
                    // Ignore card data errors - use defaults
                }

                // Get featured status
                let featuredPosition = 0;
                let featuredExpires = 0;
                try {
                    const rentalInfo = await masterService.getRentalInfo(address);
                    if (rentalInfo && !rentalInfo.isExpired) {
                        featuredPosition = rentalInfo.position;
                        featuredExpires = rentalInfo.expiresAt;
                    }
                } catch (e) {
                    // Ignore featured status errors
                }

                return {
                    instance: address,
                    name: instanceInfo.name || 'Unknown',
                    metadataURI: instanceInfo.metadataURI || '',
                    creator: instanceInfo.creator || '0x0000000000000000000000000000000000000000',
                    registeredAt: instanceInfo.registeredAt || 0,
                    factory: instanceInfo.factory || '0x0000000000000000000000000000000000000000',
                    contractType: factoryInfo.contractType || 'Unknown',
                    factoryTitle: factoryInfo.title || 'Unknown',
                    vault: instanceInfo.vault || '0x0000000000000000000000000000000000000000',
                    vaultName: vaultInfo.name || 'Unknown',
                    currentPrice: cardData.currentPrice || '0',
                    totalSupply: cardData.totalSupply || '0',
                    maxSupply: cardData.maxSupply,
                    isActive: cardData.isActive || false,
                    extraData: '0x',
                    featuredPosition,
                    featuredExpires
                };
            } catch (error) {
                console.warn(`[QueryService] Failed to get project card for ${address}:`, error.message);
                return {
                    instance: address,
                    name: 'Error',
                    metadataURI: '',
                    creator: '0x0000000000000000000000000000000000000000',
                    registeredAt: 0,
                    factory: '0x0000000000000000000000000000000000000000',
                    contractType: 'Unknown',
                    factoryTitle: 'Unknown',
                    vault: '0x0000000000000000000000000000000000000000',
                    vaultName: 'Unknown',
                    currentPrice: '0',
                    totalSupply: '0',
                    maxSupply: null,
                    isActive: false,
                    extraData: '0x',
                    featuredPosition: 0,
                    featuredExpires: 0
                };
            }
        }));

        return cards;
    }

    /**
     * Fallback: Get portfolio data using individual services
     * @private
     */
    async _fallbackGetPortfolioData(userAddress, instances = []) {
        const serviceFactory = (await import('./ServiceFactory.js')).default;
        const projectService = serviceFactory.getProjectService();
        const masterService = serviceFactory.getMasterService();

        const erc404Holdings = [];
        const erc1155Holdings = [];
        const vaultPositions = [];
        let totalClaimable = BigInt(0);

        console.log(`[QueryService] _fallbackGetPortfolioData called for ${userAddress} with ${instances.length} instances`);

        // If no instances provided, return empty (caller should provide instances)
        if (instances.length === 0) {
            console.log('[QueryService] No instances provided, returning empty');
            return {
                erc404Holdings: [],
                erc1155Holdings: [],
                vaultPositions: [],
                totalClaimable: '0'
            };
        }

        // Query each instance for user holdings
        for (const address of instances) {
            try {
                // Get instance info to determine type
                let contractType = null;
                try {
                    const instanceInfo = await masterService.getInstanceInfo(address);
                    if (instanceInfo && instanceInfo.factoryAddress) {
                        const factoryInfo = await masterService.getFactoryInfo(instanceInfo.factoryAddress);
                        contractType = factoryInfo?.contractType || null;
                    }
                } catch (e) {
                    // Try to detect type directly
                }

                const adapter = await projectService.getAdapterForInstance(address, contractType);
                if (!adapter) {
                    console.warn(`[QueryService] No adapter for ${address}`);
                    continue;
                }

                // Query balance based on contract type
                const adapterType = adapter.constructor.name;
                console.log(`[QueryService] Querying ${address} with adapter ${adapterType}, contractType=${contractType}`);

                if (adapterType.includes('ERC404') || adapterType.includes('Bonding')) {
                    // ERC404 holdings
                    try {
                        const tokenBalance = await adapter.getTokenBalance(userAddress);
                        const nftBalance = await adapter.getNFTBalance?.(userAddress) || 0;
                        const stakedBalance = await adapter.getStakedBalance?.(userAddress) || '0';
                        const claimable = await adapter.getClaimableRewards?.(userAddress) || '0';

                        console.log(`[QueryService] ERC404 ${address}: tokenBalance=${tokenBalance}, nftBalance=${nftBalance}`);
                        if (tokenBalance !== '0' || nftBalance > 0 || stakedBalance !== '0') {
                            console.log(`[QueryService] Found ERC404 holdings for ${address}`);
                            const metadata = await adapter.getMetadata?.() || {};
                            erc404Holdings.push({
                                instance: address,
                                name: metadata.name || 'Unknown',
                                symbol: metadata.symbol || '???',
                                tokenBalance,
                                nftBalance: Number(nftBalance),
                                stakedBalance,
                                claimable
                            });

                            if (claimable && claimable !== '0') {
                                totalClaimable += BigInt(claimable);
                            }
                        }
                    } catch (e) {
                        console.warn(`[QueryService] Failed to get ERC404 holdings for ${address}:`, e.message);
                    }
                } else if (adapterType.includes('ERC1155')) {
                    // ERC1155 holdings
                    try {
                        const editions = await adapter.getEditions?.() || [];
                        const balances = [];

                        for (const edition of editions) {
                            const balance = await adapter.getBalanceForEdition(userAddress, edition.id);
                            balances.push(Number(balance));
                        }

                        const hasAny = balances.some(b => b > 0);
                        console.log(`[QueryService] ERC1155 ${address}: editions=${editions.length}, balances=${JSON.stringify(balances)}`);
                        if (hasAny) {
                            console.log(`[QueryService] Found ERC1155 holdings for ${address}`);
                            const metadata = await adapter.getMetadata?.() || {};
                            erc1155Holdings.push({
                                instance: address,
                                name: metadata.name || 'Unknown',
                                editions,
                                balances
                            });
                        }
                    } catch (e) {
                        console.warn(`[QueryService] Failed to get ERC1155 holdings for ${address}:`, e.message);
                    }
                }
            } catch (e) {
                console.warn(`[QueryService] Failed to query instance ${address}:`, e.message);
            }
        }

        console.log(`[QueryService] Portfolio result: ${erc404Holdings.length} ERC404, ${erc1155Holdings.length} ERC1155`);
        return {
            erc404Holdings,
            erc1155Holdings,
            vaultPositions,
            totalClaimable: totalClaimable.toString()
        };
    }

    /**
     * Fallback: Get vault leaderboard using MasterRegistry
     * @private
     */
    async _fallbackGetVaultLeaderboard(sortBy, limit) {
        const serviceFactory = (await import('./ServiceFactory.js')).default;
        const masterService = serviceFactory.getMasterService();

        try {
            let rawVaults;
            if (sortBy === 0) {
                // Sort by TVL - returns array of vault objects
                rawVaults = await masterService.getVaultsByTVL(limit);
            } else {
                // Sort by popularity - returns array of vault objects
                rawVaults = await masterService.getVaultsByPopularity(limit);
            }

            // Transform to standard VaultSummary format
            const vaults = (rawVaults || []).map(v => ({
                vault: v.vaultAddress || v.address || v.vault,
                name: v.name || 'Unknown',
                tvl: v.tvl || '0',
                instanceCount: v.instanceCount || 0
            }));

            return vaults;
        } catch (error) {
            console.warn('[QueryService] Failed to get vault leaderboard:', error.message);
            return [];
        }
    }

    // =========================
    // Caching Methods
    // =========================

    /**
     * Execute a query with caching and deduplication
     * @private
     */
    async _cachedQuery(key, ttlKey, fetchFn) {
        // 1. Check cache
        const cached = this._getFromCache(key);
        if (cached !== null) {
            return cached;
        }

        // 2. Check in-flight (deduplication)
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }

        // 3. Execute query
        const promise = fetchFn().then(data => {
            this._setCache(key, data, ttlKey);
            this.inFlight.delete(key);
            return data;
        }).catch(err => {
            this.inFlight.delete(key);
            throw err;
        });

        this.inFlight.set(key, promise);
        return promise;
    }

    /**
     * Get value from cache if not expired
     * @private
     */
    _getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        return null;
    }

    /**
     * Set value in cache with TTL
     * @private
     */
    _setCache(key, data, ttlKey) {
        const ttl = TTL[ttlKey] || 30000;
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + ttl
        });
    }

    /**
     * Check if key is cached and not expired
     * @private
     */
    _isCached(key) {
        const cached = this.cache.get(key);
        return cached && cached.expiresAt > Date.now();
    }

    // =========================
    // Cache Invalidation
    // =========================

    /**
     * Invalidate all user-specific data
     */
    invalidateUserData() {
        for (const key of this.cache.keys()) {
            if (key.startsWith('portfolio:') || key.startsWith('home:')) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Invalidate specific project cache
     * @param {string} address - Instance address
     */
    invalidateProject(address) {
        const key = `project:${address.toLowerCase()}`;
        this.cache.delete(key);

        // Also invalidate home page since it contains projects
        for (const k of this.cache.keys()) {
            if (k.startsWith('home:')) {
                this.cache.delete(k);
            }
        }
    }

    /**
     * Clear all cached data
     */
    clearAll() {
        this.cache.clear();
        this.inFlight.clear();
    }

    // =========================
    // Status Methods
    // =========================

    /**
     * Check if QueryAggregator is available
     * @returns {Promise<boolean>}
     */
    async isAggregatorAvailable() {
        await this.initialize();
        return this.aggregatorAvailable;
    }

    /**
     * Check if in pre-launch mode (mainnet but contracts not deployed)
     * @returns {Promise<boolean>}
     */
    async isInPreLaunchMode() {
        await this.initialize();
        return this.preLaunchMode;
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        let validCount = 0;
        let expiredCount = 0;
        const now = Date.now();

        for (const [key, value] of this.cache.entries()) {
            if (value.expiresAt > now) {
                validCount++;
            } else {
                expiredCount++;
            }
        }

        return {
            totalEntries: this.cache.size,
            validEntries: validCount,
            expiredEntries: expiredCount,
            inFlightRequests: this.inFlight.size,
            aggregatorAvailable: this.aggregatorAvailable,
            preLaunchMode: this.preLaunchMode
        };
    }
}

// Export singleton instance
export const queryService = new QueryService();
export default queryService;
