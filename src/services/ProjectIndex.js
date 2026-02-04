/**
 * ProjectIndex
 *
 * Local IndexedDB-based index for fast search and filtering of projects.
 * Syncs from blockchain events (InstanceRegistered) and stores locally.
 *
 * Key features:
 * - Full sync on first visit (indexes all historical projects)
 * - Incremental sync on subsequent visits (only new blocks)
 * - Fast local search/filter without RPC calls
 * - User-controllable storage settings
 * - Graceful degradation when IndexedDB unavailable
 */

import { eventBus } from '../core/EventBus.js';

const DB_NAME = 'ms2fun-index';
const DB_VERSION = 1;

// Index modes
const INDEX_MODE = {
    FULL: 'full',           // Index all projects (fastest search, more storage)
    MINIMAL: 'minimal',     // Only user's projects
    OFF: 'off'              // No local storage (slower, always fetch from chain)
};

class ProjectIndex {
    constructor() {
        this.db = null;
        this.dbPromise = null;
        this.isSupported = this._checkSupport();
        this.syncInProgress = false;
        this.lastSyncBlock = 0;
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
            console.warn('[ProjectIndex] IndexedDB not supported');
            return null;
        }

        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[ProjectIndex] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Projects store - indexed project data
                if (!db.objectStoreNames.contains('projects')) {
                    const projectStore = db.createObjectStore('projects', {
                        keyPath: 'address'
                    });
                    // Indexes for filtering/sorting
                    projectStore.createIndex('name', 'nameLower');
                    projectStore.createIndex('contractType', 'contractType');
                    projectStore.createIndex('vault', 'vault');
                    projectStore.createIndex('creator', 'creator');
                    projectStore.createIndex('factory', 'factory');
                    projectStore.createIndex('registeredAt', 'registeredAt');
                    projectStore.createIndex('blockNumber', 'blockNumber');
                }

                // Meta store - sync state and settings
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }

                console.log('[ProjectIndex] Database schema created/upgraded');
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

    // =========================
    // Sync Methods
    // =========================

    /**
     * Sync projects from blockchain
     * @param {Object} registry - MasterRegistry contract instance
     * @param {Object} provider - Ethers provider
     * @returns {Promise<Object>} Sync result { added, updated, fromBlock, toBlock }
     */
    async sync(registry, provider) {
        if (!this.isSupported) {
            return { added: 0, updated: 0, fromBlock: 0, toBlock: 0, skipped: true };
        }

        // Check index mode
        const mode = await this.getIndexMode();
        if (mode === INDEX_MODE.OFF) {
            return { added: 0, updated: 0, fromBlock: 0, toBlock: 0, skipped: true };
        }

        if (this.syncInProgress) {
            console.log('[ProjectIndex] Sync already in progress');
            return { added: 0, updated: 0, fromBlock: 0, toBlock: 0, skipped: true };
        }

        this.syncInProgress = true;
        eventBus.emit('index:sync:start');

        try {
            const lastBlock = await this.getLastIndexedBlock();
            const currentBlock = await provider.getBlockNumber();

            let result;
            if (lastBlock === 0) {
                result = await this._fullSync(registry, currentBlock);
            } else if (currentBlock > lastBlock) {
                result = await this._incrementalSync(registry, lastBlock, currentBlock);
            } else {
                result = { added: 0, updated: 0, fromBlock: lastBlock, toBlock: currentBlock };
            }

            this.lastSyncBlock = currentBlock;
            eventBus.emit('index:sync:complete', result);
            return result;
        } catch (error) {
            console.error('[ProjectIndex] Sync failed:', error);
            eventBus.emit('index:sync:error', error);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Full sync - index all historical projects
     * @private
     */
    async _fullSync(registry, toBlock) {
        console.log('[ProjectIndex] Starting full sync to block', toBlock);

        // Query all InstanceRegistered events from genesis
        const filter = registry.filters.InstanceRegistered();
        const events = await registry.queryFilter(filter, 0, toBlock);

        console.log(`[ProjectIndex] Found ${events.length} projects to index`);

        const db = await this._getDB();
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');

        let added = 0;
        for (const event of events) {
            const project = this._parseEvent(event);
            store.put(project);
            added++;

            // Emit progress every 100 projects
            if (added % 100 === 0) {
                eventBus.emit('index:sync:progress', { added, total: events.length });
            }
        }

        await this._waitForTransaction(tx);
        await this.setLastIndexedBlock(toBlock);

        console.log(`[ProjectIndex] Full sync complete: ${added} projects indexed`);
        return { added, updated: 0, fromBlock: 0, toBlock };
    }

    /**
     * Incremental sync - only new blocks since last sync
     * @private
     */
    async _incrementalSync(registry, fromBlock, toBlock) {
        console.log(`[ProjectIndex] Incremental sync from block ${fromBlock + 1} to ${toBlock}`);

        const filter = registry.filters.InstanceRegistered();
        const events = await registry.queryFilter(filter, fromBlock + 1, toBlock);

        if (events.length === 0) {
            await this.setLastIndexedBlock(toBlock);
            return { added: 0, updated: 0, fromBlock, toBlock };
        }

        console.log(`[ProjectIndex] Found ${events.length} new projects`);

        const db = await this._getDB();
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');

        let added = 0;
        for (const event of events) {
            const project = this._parseEvent(event);
            store.put(project);
            added++;
        }

        await this._waitForTransaction(tx);
        await this.setLastIndexedBlock(toBlock);

        console.log(`[ProjectIndex] Incremental sync complete: ${added} projects added`);
        return { added, updated: 0, fromBlock, toBlock };
    }

    /**
     * Parse InstanceRegistered event to project object
     * @private
     */
    _parseEvent(event) {
        const { instance, factory, creator, name } = event.args;
        return {
            address: instance.toLowerCase(),
            name: name || '',
            nameLower: (name || '').toLowerCase(),
            factory: factory?.toLowerCase() || '',
            creator: creator?.toLowerCase() || '',
            vault: '', // Will be populated on hydration
            contractType: '', // Will be populated on hydration
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            registeredAt: 0, // Will be populated on hydration
            indexed: true,
            hydrated: false
        };
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
    // Search & Filter Methods
    // =========================

    /**
     * Search projects by name
     * @param {string} query - Search query
     * @param {number} limit - Max results (default 50)
     * @returns {Promise<Array<string>>} Array of matching project addresses
     */
    async search(query, limit = 50) {
        if (!this.isSupported || !query) {
            return [];
        }

        const db = await this._getDB();
        if (!db) return [];

        const lowerQuery = query.toLowerCase();
        const results = [];

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    const project = cursor.value;
                    if (project.nameLower.includes(lowerQuery)) {
                        results.push(project.address);
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
     * Filter projects by criteria
     * @param {Object} filters - Filter criteria
     * @param {string} filters.contractType - Filter by contract type
     * @param {string} filters.vault - Filter by vault address
     * @param {string} filters.creator - Filter by creator address
     * @param {string} filters.factory - Filter by factory address
     * @param {number} limit - Max results (default 100)
     * @returns {Promise<Array<string>>} Array of matching project addresses
     */
    async filterBy({ contractType, vault, creator, factory } = {}, limit = 100) {
        if (!this.isSupported) {
            return [];
        }

        const db = await this._getDB();
        if (!db) return [];

        // Use index if filtering by single field
        let indexName = null;
        let indexValue = null;

        if (contractType && !vault && !creator && !factory) {
            indexName = 'contractType';
            indexValue = contractType;
        } else if (vault && !contractType && !creator && !factory) {
            indexName = 'vault';
            indexValue = vault.toLowerCase();
        } else if (creator && !contractType && !vault && !factory) {
            indexName = 'creator';
            indexValue = creator.toLowerCase();
        } else if (factory && !contractType && !vault && !creator) {
            indexName = 'factory';
            indexValue = factory.toLowerCase();
        }

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const results = [];

            let request;
            if (indexName && indexValue) {
                // Use index for single-field filter
                const index = store.index(indexName);
                request = index.openCursor(IDBKeyRange.only(indexValue));
            } else {
                // Full scan for multi-field filter
                request = store.openCursor();
            }

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    const project = cursor.value;

                    // Apply filters
                    let matches = true;
                    if (contractType && project.contractType !== contractType) matches = false;
                    if (vault && project.vault !== vault.toLowerCase()) matches = false;
                    if (creator && project.creator !== creator.toLowerCase()) matches = false;
                    if (factory && project.factory !== factory.toLowerCase()) matches = false;

                    if (matches) {
                        results.push(project.address);
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
     * Get all indexed projects
     * @param {number} limit - Max results
     * @param {number} offset - Skip first N results
     * @returns {Promise<Array>} Array of project objects
     */
    async getAllProjects(limit = 100, offset = 0) {
        if (!this.isSupported) {
            return [];
        }

        const db = await this._getDB();
        if (!db) return [];

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const index = store.index('registeredAt');
            const results = [];
            let skipped = 0;

            // Use descending order (most recent first)
            const request = index.openCursor(null, 'prev');

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (skipped < offset) {
                        skipped++;
                        cursor.continue();
                    } else if (results.length < limit) {
                        results.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get project by address
     * @param {string} address - Project address
     * @returns {Promise<Object|null>} Project object or null
     */
    async getProject(address) {
        if (!this.isSupported || !address) {
            return null;
        }

        const db = await this._getDB();
        if (!db) return null;

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const request = store.get(address.toLowerCase());

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update project with additional data (hydration)
     * @param {string} address - Project address
     * @param {Object} data - Additional data to merge
     */
    async updateProject(address, data) {
        if (!this.isSupported || !address) {
            return;
        }

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');

        const existing = await new Promise((resolve) => {
            const request = store.get(address.toLowerCase());
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });

        if (existing) {
            const updated = {
                ...existing,
                ...data,
                address: address.toLowerCase(),
                hydrated: true
            };
            store.put(updated);
        }

        await this._waitForTransaction(tx);
    }

    /**
     * Get total project count
     * @returns {Promise<number>}
     */
    async getProjectCount() {
        if (!this.isSupported) {
            return 0;
        }

        const db = await this._getDB();
        if (!db) return 0;

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // =========================
    // Meta/Settings Methods
    // =========================

    /**
     * Get last indexed block number
     * @returns {Promise<number>}
     */
    async getLastIndexedBlock() {
        if (!this.isSupported) return 0;

        const db = await this._getDB();
        if (!db) return 0;

        return new Promise((resolve) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const request = store.get('lastIndexedBlock');

            request.onsuccess = () => {
                resolve(request.result?.value || 0);
            };
            request.onerror = () => resolve(0);
        });
    }

    /**
     * Set last indexed block number
     * @param {number} block - Block number
     */
    async setLastIndexedBlock(block) {
        if (!this.isSupported) return;

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key: 'lastIndexedBlock', value: block });

        await this._waitForTransaction(tx);
    }

    /**
     * Get current index mode
     * @returns {Promise<string>} One of INDEX_MODE values
     */
    async getIndexMode() {
        if (!this.isSupported) return INDEX_MODE.OFF;

        const db = await this._getDB();
        if (!db) return INDEX_MODE.FULL;

        return new Promise((resolve) => {
            const tx = db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const request = store.get('indexMode');

            request.onsuccess = () => {
                resolve(request.result?.value || INDEX_MODE.FULL);
            };
            request.onerror = () => resolve(INDEX_MODE.FULL);
        });
    }

    /**
     * Set index mode
     * @param {string} mode - One of INDEX_MODE values
     */
    async setIndexMode(mode) {
        if (!this.isSupported) return;

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key: 'indexMode', value: mode });

        await this._waitForTransaction(tx);

        // Clear index if mode is OFF
        if (mode === INDEX_MODE.OFF) {
            await this.clearIndex();
        }

        eventBus.emit('index:mode:changed', mode);
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>} Storage stats
     */
    async getStorageStats() {
        const projectCount = await this.getProjectCount();
        const lastBlock = await this.getLastIndexedBlock();
        const mode = await this.getIndexMode();

        let estimatedSize = null;
        let quota = null;

        // Try to get storage estimate (not available in all browsers)
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
            projectCount,
            lastIndexedBlock: lastBlock,
            indexMode: mode,
            estimatedSize,
            quota,
            isSupported: this.isSupported,
            syncInProgress: this.syncInProgress
        };
    }

    /**
     * Clear all indexed data
     */
    async clearIndex() {
        if (!this.isSupported) return;

        const db = await this._getDB();
        if (!db) return;

        const tx = db.transaction(['projects', 'meta'], 'readwrite');
        tx.objectStore('projects').clear();

        // Reset last indexed block but keep mode
        const metaStore = tx.objectStore('meta');
        metaStore.put({ key: 'lastIndexedBlock', value: 0 });

        await this._waitForTransaction(tx);

        console.log('[ProjectIndex] Index cleared');
        eventBus.emit('index:cleared');
    }

    /**
     * Delete database entirely
     */
    async deleteDatabase() {
        if (!this.isSupported) return;

        // Close existing connection
        if (this.db) {
            this.db.close();
            this.db = null;
            this.dbPromise = null;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => {
                console.log('[ProjectIndex] Database deleted');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Export singleton instance and constants
export const projectIndex = new ProjectIndex();
export { INDEX_MODE };
export default projectIndex;
