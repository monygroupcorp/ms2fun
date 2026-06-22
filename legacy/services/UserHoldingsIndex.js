/**
 * UserHoldingsIndex
 *
 * Lightweight IndexedDB-based index for tracking which instances a user has holdings in.
 * Used by portfolio page to efficiently query only relevant instances.
 *
 * Storage strategy:
 * - Store all instance addresses (~3KB for 1000 instances)
 * - Store which ones user has holdings in (boolean flag per instance)
 * - Periodically re-scan false entries to catch new holdings
 * - User-controllable storage settings
 */

import { eventBus } from '../core/EventBus.js';

const DB_NAME = 'ms2fun-user-holdings';
const DB_VERSION = 2; // Bumped to fix boolean->number migration for IndexedDB index compatibility

// Scan strategies
const SCAN_MODE = {
    FULL: 'full',       // Scan all instances on portfolio load
    SMART: 'smart',     // Only scan holdings=true + periodically scan false
    OFF: 'off'          // No local caching (always fetch fresh)
};

// How often to re-scan instances marked as no-holdings (in ms)
const RESCAN_INTERVAL = 5 * 60 * 1000; // 5 minutes

class UserHoldingsIndex {
    constructor() {
        this.db = null;
        this.dbPromise = null;
        this.isSupported = this._checkSupport();
    }

    /**
     * Check if IndexedDB is supported
     * @private
     */
    _checkSupport() {
        try {
            return typeof indexedDB !== 'undefined' && indexedDB !== null;
        } catch (e) {
            return false;
        }
    }

    /**
     * Initialize the database
     * @returns {Promise<IDBDatabase>}
     */
    async _initDB() {
        if (!this.isSupported) {
            console.warn('[UserHoldingsIndex] IndexedDB not supported');
            return null;
        }

        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[UserHoldingsIndex] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // User holdings store - per-user, per-instance holding status
                // Key: `${userAddress}:${instanceAddress}`
                if (!db.objectStoreNames.contains('holdings')) {
                    const holdingsStore = db.createObjectStore('holdings', {
                        keyPath: 'id'
                    });
                    // Indexes for querying
                    holdingsStore.createIndex('user', 'user');
                    holdingsStore.createIndex('instance', 'instance');
                    holdingsStore.createIndex('hasHoldings', 'hasHoldings');
                    holdingsStore.createIndex('userHasHoldings', ['user', 'hasHoldings']);
                }

                // Meta store - per-user settings and sync state
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }

                console.log('[UserHoldingsIndex] Database schema created/upgraded');
            };
        });

        return this.dbPromise;
    }

    /**
     * Get database instance, initializing if needed
     * @private
     */
    async _getDB() {
        if (this.db) return this.db;
        return this._initDB();
    }

    /**
     * Generate compound key for holdings record
     * @private
     */
    _makeKey(userAddress, instanceAddress) {
        return `${userAddress.toLowerCase()}:${instanceAddress.toLowerCase()}`;
    }

    // =========================
    // Core Holdings Methods
    // =========================

    /**
     * Get instances where user has holdings
     * @param {string} userAddress - User wallet address
     * @returns {Promise<string[]>} Array of instance addresses with holdings
     */
    async getHoldingInstances(userAddress) {
        if (!this.isSupported || !userAddress) {
            return [];
        }

        const db = await this._getDB();
        if (!db) return [];

        const user = userAddress.toLowerCase();

        return new Promise((resolve, reject) => {
            const tx = db.transaction('holdings', 'readonly');
            const store = tx.objectStore('holdings');
            const index = store.index('userHasHoldings');
            const results = [];

            // Query for user + hasHoldings=1 (using number since booleans aren't valid IndexedDB keys)
            const range = IDBKeyRange.only([user, 1]);
            const request = index.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value.instance);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all tracked instances for a user (with holdings status)
     * @param {string} userAddress - User wallet address
     * @returns {Promise<Object>} Map of instance -> { hasHoldings, lastChecked }
     */
    async getAllTrackedInstances(userAddress) {
        if (!this.isSupported || !userAddress) {
            return {};
        }

        const db = await this._getDB();
        if (!db) return {};

        const user = userAddress.toLowerCase();

        return new Promise((resolve, reject) => {
            const tx = db.transaction('holdings', 'readonly');
            const store = tx.objectStore('holdings');
            const index = store.index('user');
            const results = {};

            const request = index.openCursor(IDBKeyRange.only(user));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    results[record.instance] = {
                        hasHoldings: record.hasHoldings === 1, // Convert back to boolean for API
                        lastChecked: record.lastChecked
                    };
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update holdings status for a single instance
     * @param {string} userAddress - User wallet address
     * @param {string} instanceAddress - Instance address
     * @param {boolean} hasHoldings - Whether user has holdings
     */
    async updateHolding(userAddress, instanceAddress, hasHoldings) {
        if (!this.isSupported || !userAddress || !instanceAddress) {
            return;
        }

        const db = await this._getDB();
        if (!db) return;

        const user = userAddress.toLowerCase();
        const instance = instanceAddress.toLowerCase();
        const id = this._makeKey(user, instance);

        const tx = db.transaction('holdings', 'readwrite');
        const store = tx.objectStore('holdings');

        store.put({
            id,
            user,
            instance,
            hasHoldings: hasHoldings ? 1 : 0, // Store as number for IndexedDB index compatibility
            lastChecked: Date.now()
        });

        await this._waitForTransaction(tx);
    }

    /**
     * Batch update holdings for multiple instances
     * @param {string} userAddress - User wallet address
     * @param {Object} holdingsMap - Map of instanceAddress -> hasHoldings
     */
    async updateHoldingsBatch(userAddress, holdingsMap) {
        if (!this.isSupported || !userAddress || !holdingsMap) {
            return;
        }

        const db = await this._getDB();
        if (!db) return;

        const user = userAddress.toLowerCase();
        const now = Date.now();

        const tx = db.transaction('holdings', 'readwrite');
        const store = tx.objectStore('holdings');

        for (const [instanceAddress, hasHoldings] of Object.entries(holdingsMap)) {
            const instance = instanceAddress.toLowerCase();
            const id = this._makeKey(user, instance);

            store.put({
                id,
                user,
                instance,
                hasHoldings: hasHoldings ? 1 : 0, // Store as number for IndexedDB index compatibility
                lastChecked: now
            });
        }

        await this._waitForTransaction(tx);

        eventBus.emit('holdings:updated', { user, count: Object.keys(holdingsMap).length });
    }

    /**
     * Get instances that need re-scanning (marked as no-holdings but stale)
     * @param {string} userAddress - User wallet address
     * @returns {Promise<string[]>} Array of instance addresses to re-scan
     */
    async getStaleInstances(userAddress) {
        if (!this.isSupported || !userAddress) {
            return [];
        }

        const db = await this._getDB();
        if (!db) return [];

        const user = userAddress.toLowerCase();
        const staleThreshold = Date.now() - RESCAN_INTERVAL;

        return new Promise((resolve, reject) => {
            const tx = db.transaction('holdings', 'readonly');
            const store = tx.objectStore('holdings');
            const index = store.index('user');
            const results = [];

            const request = index.openCursor(IDBKeyRange.only(user));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    // Include if no holdings (0) AND stale
                    if (record.hasHoldings === 0 && record.lastChecked < staleThreshold) {
                        results.push(record.instance);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Wait for IndexedDB transaction to complete
     * @private
     */
    _waitForTransaction(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error('Transaction aborted'));
        });
    }

    // =========================
    // Meta/Settings Methods
    // =========================

    /**
     * Get last full scan timestamp for user
     * @param {string} userAddress - User wallet address
     * @returns {Promise<number>} Timestamp or 0 if never scanned
     */
    async getLastFullScan(userAddress) {
        if (!this.isSupported || !userAddress) return 0;

        const db = await this._getDB();
        if (!db) return 0;

        const key = `lastFullScan:${userAddress.toLowerCase()}`;

        return new Promise((resolve) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result?.value || 0);
            };
            request.onerror = () => resolve(0);
        });
    }

    /**
     * Set last full scan timestamp for user
     * @param {string} userAddress - User wallet address
     */
    async setLastFullScan(userAddress) {
        if (!this.isSupported || !userAddress) return;

        const db = await this._getDB();
        if (!db) return;

        const key = `lastFullScan:${userAddress.toLowerCase()}`;

        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key, value: Date.now() });

        await this._waitForTransaction(tx);
    }

    /**
     * Get scan mode setting
     * @returns {Promise<string>} One of SCAN_MODE values
     */
    async getScanMode() {
        if (!this.isSupported) return SCAN_MODE.OFF;

        const db = await this._getDB();
        if (!db) return SCAN_MODE.SMART;

        return new Promise((resolve) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const request = store.get('scanMode');

            request.onsuccess = () => {
                resolve(request.result?.value || SCAN_MODE.SMART);
            };
            request.onerror = () => resolve(SCAN_MODE.SMART);
        });
    }

    /**
     * Set scan mode setting
     * @param {string} mode - One of SCAN_MODE values
     */
    async setScanMode(mode) {
        if (!this.isSupported) return;

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key: 'scanMode', value: mode });

        await this._waitForTransaction(tx);

        // Clear data if mode is OFF
        if (mode === SCAN_MODE.OFF) {
            await this.clearAllData();
        }

        eventBus.emit('holdings:mode:changed', mode);
    }

    /**
     * Get storage statistics
     * @param {string} userAddress - Optional user to filter stats
     * @returns {Promise<Object>} Storage stats
     */
    async getStorageStats(userAddress = null) {
        const scanMode = await this.getScanMode();

        let totalRecords = 0;
        let holdingsCount = 0;
        let lastFullScan = 0;

        if (this.isSupported && userAddress) {
            const db = await this._getDB();
            if (db) {
                const user = userAddress.toLowerCase();

                // Count records
                const tracked = await this.getAllTrackedInstances(user);
                totalRecords = Object.keys(tracked).length;
                holdingsCount = Object.values(tracked).filter(t => t.hasHoldings).length;
                lastFullScan = await this.getLastFullScan(user);
            }
        }

        let estimatedSize = null;
        let quota = null;

        if (navigator.storage?.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                estimatedSize = estimate.usage || null;
                quota = estimate.quota || null;
            } catch (e) {
                // Ignore errors
            }
        }

        return {
            scanMode,
            totalRecords,
            holdingsCount,
            lastFullScan,
            estimatedSize,
            quota,
            isSupported: this.isSupported
        };
    }

    /**
     * Clear all holdings data for a user
     * @param {string} userAddress - User wallet address
     */
    async clearUserData(userAddress) {
        if (!this.isSupported || !userAddress) return;

        const db = await this._getDB();
        if (!db) return;

        const user = userAddress.toLowerCase();

        const tx = db.transaction(['holdings', 'meta'], 'readwrite');
        const holdingsStore = tx.objectStore('holdings');
        const metaStore = tx.objectStore('meta');

        // Delete all holdings for this user
        const index = holdingsStore.index('user');
        const request = index.openCursor(IDBKeyRange.only(user));

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                holdingsStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        // Delete meta for this user
        metaStore.delete(`lastFullScan:${user}`);

        await this._waitForTransaction(tx);

        console.log(`[UserHoldingsIndex] Cleared data for user ${user}`);
        eventBus.emit('holdings:cleared', { user });
    }

    /**
     * Clear all data (all users)
     */
    async clearAllData() {
        if (!this.isSupported) return;

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction(['holdings', 'meta'], 'readwrite');
        tx.objectStore('holdings').clear();

        // Only clear user-specific meta, keep global settings
        const metaStore = tx.objectStore('meta');
        const request = metaStore.openCursor();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.key.startsWith('lastFullScan:')) {
                    metaStore.delete(cursor.key);
                }
                cursor.continue();
            }
        };

        await this._waitForTransaction(tx);

        console.log('[UserHoldingsIndex] All holdings data cleared');
        eventBus.emit('holdings:cleared:all');
    }

    /**
     * Delete database entirely
     */
    async deleteDatabase() {
        if (!this.isSupported) return;

        if (this.db) {
            this.db.close();
            this.db = null;
            this.dbPromise = null;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => {
                console.log('[UserHoldingsIndex] Database deleted');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Export singleton instance and constants
export const userHoldingsIndex = new UserHoldingsIndex();
export { SCAN_MODE, RESCAN_INTERVAL };
export default userHoldingsIndex;
