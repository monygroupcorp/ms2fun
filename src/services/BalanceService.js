import { eventBus } from '../core/EventBus.js';
import { tradingStore } from '../store/tradingStore.js';

/**
 * BalanceService
 * 
 * Centralizes all balance fetching (ETH, token, NFT).
 * Provides caching and unified balance API.
 * Handles balance updates and subscriptions.
 * 
 * @class BalanceService
 */
class BalanceService {
    constructor() {
        this._blockchainService = null;
        this._cache = new Map();
        this._cacheExpirationTime = 30000; // 30 seconds
        this._subscribers = new Set();
    }

    /**
     * Initialize the service with blockchain service
     * @param {Object} blockchainService - BlockchainService instance
     */
    initialize(blockchainService) {
        if (!blockchainService) {
            throw new Error('BlockchainService is required');
        }
        this._blockchainService = blockchainService;
    }

    /**
     * Get cached balance or null if expired
     * @private
     * @param {string} key - Cache key
     * @returns {any|null} - Cached value or null
     */
    _getCache(key) {
        const cached = this._cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > this._cacheExpirationTime) {
            this._cache.delete(key);
            return null;
        }
        
        return cached.value;
    }

    /**
     * Set cache value
     * @private
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     */
    _setCache(key, value) {
        this._cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Get ETH balance for an address
     * @param {string} address - Wallet address
     * @returns {Promise<string>} - ETH balance
     */
    async getEthBalance(address) {
        if (!this._blockchainService) {
            throw new Error('BalanceService not initialized');
        }

        const cacheKey = `eth:${address}`;
        const cached = this._getCache(cacheKey);
        if (cached !== null) {
            return cached;
        }

        const balance = await this._blockchainService.getEthBalance(address);
        this._setCache(cacheKey, balance);
        return balance;
    }

    /**
     * Get token (EXEC) balance for an address
     * @param {string} address - Wallet address
     * @returns {Promise<string>} - Token balance
     */
    async getTokenBalance(address) {
        if (!this._blockchainService) {
            throw new Error('BalanceService not initialized');
        }

        const cacheKey = `token:${address}`;
        const cached = this._getCache(cacheKey);
        if (cached !== null) {
            return cached;
        }

        const balance = await this._blockchainService.getTokenBalance(address);
        this._setCache(cacheKey, balance);
        return balance;
    }

    /**
     * Get NFT balance for an address
     * @param {string} address - Wallet address
     * @returns {Promise<number>} - NFT balance
     */
    async getNFTBalance(address) {
        if (!this._blockchainService) {
            throw new Error('BalanceService not initialized');
        }

        const cacheKey = `nft:${address}`;
        const cached = this._getCache(cacheKey);
        if (cached !== null) {
            return cached;
        }

        const balance = await this._blockchainService.getNFTBalance(address);
        this._setCache(cacheKey, balance);
        return balance;
    }

    /**
     * Get all balances for an address
     * @param {string} address - Wallet address
     * @returns {Promise<Object>} - Object with eth, exec, nfts balances
     */
    async getAllBalances(address) {
        const [eth, exec, nfts] = await Promise.all([
            this.getEthBalance(address),
            this.getTokenBalance(address),
            this.getNFTBalance(address)
        ]);

        const balances = {
            eth,
            exec,
            nfts,
            lastUpdated: Date.now()
        };

        // Update store
        tradingStore.updateBalances(balances);

        // Emit event
        eventBus.emit('balances:updated', balances);

        return balances;
    }

    /**
     * Clear cache for an address
     * @param {string} address - Wallet address
     */
    clearCache(address) {
        if (address) {
            this._cache.delete(`eth:${address}`);
            this._cache.delete(`token:${address}`);
            this._cache.delete(`nft:${address}`);
        } else {
            this._cache.clear();
        }
    }
}

// Export singleton instance
export const balanceService = new BalanceService();
export default balanceService;

