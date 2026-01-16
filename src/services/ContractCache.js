import { eventBus } from '../core/EventBus.js';

/**
 * ContractCache Service
 * 
 * Provides TTL-based caching for blockchain contract reads to improve performance
 * and reduce redundant RPC calls.
 * 
 * Features:
 * - TTL-based caching with configurable expiration
 * - Automatic invalidation on transactions, account changes, network changes
 * - Cache statistics (hit rate, miss rate)
 * - Cache warming support
 * - Per-method cache configuration
 */
class ContractCache {
    constructor() {
        // Cache storage: Map<key, {value, expiresAt, accessCount}>
        this.cache = new Map();
        
        // Cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            invalidations: 0,
            sets: 0
        };
        
        // Default TTL per method type (in milliseconds)
        this.defaultTTLs = {
            // Price data changes frequently but can be cached briefly
            price: 5000, // 5 seconds
            // Balances should be fresh but can cache briefly
            balance: 3000, // 3 seconds
            // Contract data changes less frequently
            contractData: 10000, // 10 seconds
            // Supply data changes less frequently
            supply: 10000, // 10 seconds
            // NFT metadata rarely changes
            metadata: 60000, // 60 seconds
            // Tier/whitelist data changes infrequently
            tier: 30000, // 30 seconds
            // Default TTL
            default: 5000 // 5 seconds
        };
        
        // Methods that should never be cached
        this.noCacheMethods = new Set([
            'executeContractCall', // Transactions
            'swapExactETHForTokens',
            'swapExactTokensForETH',
            'buy',
            'sell',
            'mint'
        ]);
        
        // Setup event listeners for cache invalidation
        this.setupEventListeners();
        
        // Debug mode
        this.debug = false;
    }

    /**
     * Setup event listeners for automatic cache invalidation
     */
    setupEventListeners() {
        // Invalidate on transaction confirmation
        eventBus.on('transaction:confirmed', () => {
            this.invalidateByPattern('balance', 'price', 'contractData');
            if (this.debug) {
                console.log('[ContractCache] Invalidated cache due to transaction confirmation');
            }
        });

        // Invalidate on account change
        eventBus.on('account:changed', () => {
            this.invalidateByPattern('balance');
            if (this.debug) {
                console.log('[ContractCache] Invalidated cache due to account change');
            }
        });

        // Invalidate on network change
        eventBus.on('network:changed', () => {
            this.clear(); // Clear all cache on network change
            if (this.debug) {
                console.log('[ContractCache] Cleared cache due to network change');
            }
        });

        // Invalidate on contract data update
        eventBus.on('contractData:updated', () => {
            this.invalidateByPattern('contractData', 'price', 'supply');
            if (this.debug) {
                console.log('[ContractCache] Invalidated cache due to contract data update');
            }
        });
    }

    /**
     * Generate cache key from method name, arguments, and contract address
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {string} contractAddress - Contract address (required for per-contract caching)
     * @returns {string} - Cache key
     */
    generateKey(method, args = [], contractAddress = '') {
        // Create a stable key from contract address, method and args
        const argsKey = args.length > 0
            ? JSON.stringify(args.map(arg => {
                // Handle BigNumber and other special types
                if (arg && typeof arg === 'object' && arg.toString) {
                    return arg.toString();
                }
                return arg;
            }))
            : '';
        // Include contract address to prevent cross-contract cache collisions
        const addressKey = contractAddress ? contractAddress.toLowerCase() : 'global';
        return `${addressKey}:${method}:${argsKey}`;
    }

    /**
     * Get cached value if available and not expired
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {string} contractAddress - Contract address for per-contract caching
     * @returns {any|null} - Cached value or null if not found/expired
     */
    get(method, args = [], contractAddress = '') {
        // Don't cache certain methods
        if (this.noCacheMethods.has(method)) {
            return null;
        }

        const key = this.generateKey(method, args, contractAddress);
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return null;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }

        // Update access count
        entry.accessCount++;
        this.stats.hits++;
        
        if (this.debug) {
            console.log(`[ContractCache] Cache HIT for ${method}`, args);
        }

        return entry.value;
    }

    /**
     * Set cached value with TTL
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in milliseconds (optional, uses default if not provided)
     * @param {string} contractAddress - Contract address for per-contract caching
     */
    set(method, args = [], value, ttl = null, contractAddress = '') {
        // Don't cache certain methods
        if (this.noCacheMethods.has(method)) {
            return;
        }

        // Determine TTL based on method type
        if (ttl === null) {
            ttl = this.getTTLForMethod(method);
        }

        const key = this.generateKey(method, args, contractAddress);
        const expiresAt = Date.now() + ttl;

        this.cache.set(key, {
            value,
            expiresAt,
            accessCount: 0,
            method,
            args,
            cachedAt: Date.now()
        });

        this.stats.sets++;

        if (this.debug) {
            console.log(`[ContractCache] Cached ${method}`, args, `TTL: ${ttl}ms`);
        }
    }

    /**
     * Get TTL for a method based on its type
     * @param {string} method - Method name
     * @returns {number} - TTL in milliseconds
     */
    getTTLForMethod(method) {
        const methodLower = method.toLowerCase();

        // Price-related methods
        if (methodLower.includes('price') || methodLower.includes('cost')) {
            return this.defaultTTLs.price;
        }

        // Balance-related methods
        if (methodLower.includes('balance')) {
            return this.defaultTTLs.balance;
        }

        // Supply-related methods
        if (methodLower.includes('supply') || methodLower.includes('total')) {
            return this.defaultTTLs.supply;
        }

        // Metadata-related methods
        if (methodLower.includes('metadata') || methodLower.includes('uri')) {
            return this.defaultTTLs.metadata;
        }

        // Tier/whitelist-related methods
        if (methodLower.includes('tier') || methodLower.includes('merkle') || methodLower.includes('proof')) {
            return this.defaultTTLs.tier;
        }

        // Contract data methods
        if (methodLower.includes('contract') || methodLower.includes('pool') || methodLower.includes('liquidity')) {
            return this.defaultTTLs.contractData;
        }

        return this.defaultTTLs.default;
    }

    /**
     * Invalidate cache entries matching patterns
     * @param {...string} patterns - Patterns to match against method names
     */
    invalidateByPattern(...patterns) {
        let invalidated = 0;

        for (const [key, entry] of this.cache.entries()) {
            const methodLower = entry.method.toLowerCase();
            
            if (patterns.some(pattern => methodLower.includes(pattern.toLowerCase()))) {
                this.cache.delete(key);
                invalidated++;
            }
        }

        this.stats.invalidations += invalidated;

        if (this.debug && invalidated > 0) {
            console.log(`[ContractCache] Invalidated ${invalidated} entries matching patterns:`, patterns);
        }
    }

    /**
     * Invalidate specific cache entry
     * @param {string} method - Method name
     * @param {Array} args - Method arguments
     * @param {string} contractAddress - Contract address for per-contract caching
     */
    invalidate(method, args = [], contractAddress = '') {
        const key = this.generateKey(method, args, contractAddress);
        if (this.cache.delete(key)) {
            this.stats.invalidations++;
            if (this.debug) {
                console.log(`[ContractCache] Invalidated ${method}`, args);
            }
        }
    }

    /**
     * Clear all cache
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.invalidations += size;
        
        if (this.debug) {
            console.log('[ContractCache] Cleared all cache');
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} - Cache statistics
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;

        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            cacheSize: this.cache.size,
            totalRequests: total
        };
    }

    /**
     * Warm cache by pre-fetching common data
     * @param {Function} fetchFn - Function to fetch data
     * @param {Array} methods - Methods to warm
     */
    async warmCache(fetchFn, methods = []) {
        if (this.debug) {
            console.log('[ContractCache] Warming cache for methods:', methods);
        }

        const promises = methods.map(async (method) => {
            try {
                const result = await fetchFn(method);
                // Cache will be set by the wrapped method
                return result;
            } catch (error) {
                console.warn(`[ContractCache] Failed to warm cache for ${method}:`, error);
                return null;
            }
        });

        await Promise.all(promises);
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebug(enabled) {
        this.debug = enabled;
    }

    /**
     * Clean up expired entries (should be called periodically)
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (this.debug && cleaned > 0) {
            console.log(`[ContractCache] Cleaned up ${cleaned} expired entries`);
        }

        return cleaned;
    }
}

// Export singleton instance
export const contractCache = new ContractCache();

// Periodically clean up expired entries (every 30 seconds)
if (typeof window !== 'undefined') {
    setInterval(() => {
        contractCache.cleanup();
    }, 30000);
}

