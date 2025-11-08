class Store {
    constructor(initialState = {}, validators = {}) {
        this.state = initialState;
        this.validators = validators;
        this.subscribers = new Set();
        this.debug = false;
        
        // Batching support
        this._batching = false;
        this._batchedUpdates = {};
        this._updateQueue = [];
        this._updateTimer = null;
        
        // Transaction support
        this._transactionStack = [];
        this._transactionState = null;
        
        // Selector cache management
        this._selectorCache = new Map();
        this._selectorInvalidationPaths = new Map(); // Track which selectors depend on which paths
    }

    // Enable/disable debug logging
    setDebug(enabled) {
        this.debug = enabled;
        this.log('Debug logging ' + (enabled ? 'enabled' : 'disabled'));
    }

    // Subscribe to state changes
    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Subscriber must be a function');
        }
        this.subscribers.add(callback);
        this.log(`New subscriber added. Total subscribers: ${this.subscribers.size}`);
        return () => this.unsubscribe(callback);
    }

    // Unsubscribe from state changes
    unsubscribe(callback) {
        this.subscribers.delete(callback);
        this.log(`Subscriber removed. Total subscribers: ${this.subscribers.size}`);
    }

    // Get current state
    getState() {
        return { ...this.state };
    }

    // Update state
    setState(updates, options = {}) {
        // If in a transaction, queue the update
        if (this._transactionStack.length > 0) {
            const transaction = this._transactionStack[this._transactionStack.length - 1];
            transaction.updates = { ...transaction.updates, ...updates };
            return;
        }

        // If batching, accumulate updates
        if (this._batching) {
            this._batchedUpdates = { ...this._batchedUpdates, ...updates };
            return;
        }

        // If immediate update requested, skip batching
        if (options.immediate) {
            this._applyStateUpdate(updates);
            return;
        }

        // Queue update for debouncing
        this._queueUpdate(updates);
    }

    /**
     * Apply state update immediately (internal method)
     * @private
     */
    _applyStateUpdate(updates) {
        // Create new state object
        const newState = { ...this.state, ...updates };

        // Validate state changes
        for (const [key, value] of Object.entries(updates)) {
            if (this.validators[key]) {
                const isValid = this.validators[key](value, newState);
                if (!isValid) {
                    this.log(`Validation failed for key: ${key}`, 'error');
                    throw new Error(`Invalid value for ${key}`);
                }
            }
        }

        // Update state atomically
        this.state = newState;
        this.log('State updated:', updates);

        // Invalidate selector cache for affected paths
        this._invalidateSelectorCache(updates);

        // Notify subscribers
        this.notifySubscribers();
    }

    /**
     * Queue update for debounced batching
     * @private
     */
    _queueUpdate(updates) {
        // Merge with existing queued updates
        this._updateQueue.push(updates);

        // Clear existing timer
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
        }

        // Schedule batch update (debounce: 16ms for ~60fps)
        this._updateTimer = setTimeout(() => {
            this._flushUpdateQueue();
        }, 16);
    }

    /**
     * Flush queued updates in a single batch
     * @private
     */
    _flushUpdateQueue() {
        if (this._updateQueue.length === 0) {
            return;
        }

        // Merge all queued updates
        const mergedUpdates = {};
        for (const update of this._updateQueue) {
            Object.assign(mergedUpdates, update);
        }

        // Clear queue
        this._updateQueue = [];
        this._updateTimer = null;

        // Apply merged update
        this._applyStateUpdate(mergedUpdates);
    }

    // Private method to notify subscribers
    notifySubscribers() {
        const state = this.getState();
        this.subscribers.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                this.log(`Error in subscriber: ${error.message}`, 'error');
            }
        });
    }

    /**
     * Batch multiple state updates into a single update
     * All setState calls within the callback will be batched together
     * 
     * @param {Function} callback - Function containing setState calls to batch
     * @returns {any} - Return value of callback
     * 
     * @example
     * store.batchUpdates(() => {
     *   store.setState({ price: 100 });
     *   store.setState({ balance: 50 });
     *   store.setState({ count: 10 });
     * }); // Single update notification
     */
    batchUpdates(callback) {
        const wasBatching = this._batching;
        this._batching = true;
        this._batchedUpdates = {};

        try {
            const result = callback();

            // If nested batch, don't flush yet
            if (!wasBatching && Object.keys(this._batchedUpdates).length > 0) {
                this._applyStateUpdate(this._batchedUpdates);
            }

            return result;
        } catch (error) {
            // On error, clear batched updates
            this._batchedUpdates = {};
            throw error;
        } finally {
            this._batching = wasBatching;
            if (!wasBatching) {
                this._batchedUpdates = {};
            }
        }
    }

    /**
     * Execute state updates in a transaction with rollback support
     * If an error occurs, state is rolled back to before the transaction
     * 
     * @param {Function} callback - Function containing setState calls
     * @returns {any} - Return value of callback
     * @throws {Error} - If callback throws, state is rolled back
     * 
     * @example
     * try {
     *   store.transaction(() => {
     *     store.setState({ price: 100 });
     *     store.setState({ balance: 50 });
     *     if (someCondition) throw new Error('Rollback!');
     *   });
     * } catch (error) {
     *   // State rolled back to before transaction
     * }
     */
    transaction(callback) {
        // Save current state for rollback
        const previousState = { ...this.state };
        const transaction = {
            updates: {},
            previousState
        };

        this._transactionStack.push(transaction);

        try {
            const result = callback();

            // Apply all transaction updates at once
            if (Object.keys(transaction.updates).length > 0) {
                this._applyStateUpdate(transaction.updates);
            }

            this._transactionStack.pop();
            return result;
        } catch (error) {
            // Rollback state
            this.state = previousState;
            this._transactionStack.pop();
            
            this.log(`Transaction rolled back due to error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Synchronous state update (bypasses batching and debouncing)
     * Use sparingly for critical updates that must happen immediately
     * 
     * @param {Object} updates - State updates to apply
     */
    setStateSync(updates) {
        this.setState(updates, { immediate: true });
    }

    /**
     * Register a selector for cache invalidation
     * @param {Function} selector - Selector function
     * @param {Array<string>} paths - State paths this selector depends on (e.g., ['contractData.freeSupply'])
     */
    registerSelector(selector, paths = []) {
        if (!this._selectorCache.has(selector)) {
            this._selectorCache.set(selector, { paths, reset: selector.reset || (() => {}) });
        }
        this._selectorInvalidationPaths.set(selector, paths);
    }

    /**
     * Invalidate selector cache for affected state paths
     * @private
     */
    _invalidateSelectorCache(updates) {
        const updatedPaths = this._getUpdatedPaths(updates);
        
        // Reset all selectors that depend on updated paths
        for (const [selector, info] of this._selectorCache.entries()) {
            const selectorPaths = this._selectorInvalidationPaths.get(selector) || info.paths || [];
            
            // Check if any selector path matches updated paths
            const shouldInvalidate = selectorPaths.some(selectorPath => {
                return updatedPaths.some(updatedPath => {
                    // Check if paths match (exact or parent/child)
                    return updatedPath === selectorPath || 
                           updatedPath.startsWith(selectorPath + '.') ||
                           selectorPath.startsWith(updatedPath + '.');
                });
            });
            
            if (shouldInvalidate && info.reset) {
                info.reset();
            }
        }
    }

    /**
     * Get all state paths that were updated
     * @private
     */
    _getUpdatedPaths(updates, prefix = '') {
        const paths = [];
        for (const key in updates) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            const value = updates[key];
            
            if (value && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object) {
                // Recursively get paths for nested objects
                paths.push(...this._getUpdatedPaths(value, fullPath));
            } else {
                paths.push(fullPath);
            }
        }
        return paths;
    }

    /**
     * Clear all selector caches
     */
    clearSelectorCache() {
        for (const [selector, info] of this._selectorCache.entries()) {
            if (info.reset) {
                info.reset();
            }
        }
    }

    /**
     * Reset store to initial state and clear caches
     */
    reset(initialState = {}) {
        this.state = initialState;
        this.clearSelectorCache();
        this._batchedUpdates = {};
        this._updateQueue = [];
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
            this._updateTimer = null;
        }
        this._transactionStack = [];
        this.notifySubscribers();
    }

    // Private method for debug logging
    log(message, level = 'info') {
        if (!this.debug) return;
        const timestamp = new Date().toISOString();
        console[level](`[Store ${timestamp}]`, message);
    }
}

// Example usage:
const exampleUsage = () => {
    // Create validators
    const validators = {
        age: (value) => typeof value === 'number' && value >= 0,
        email: (value) => typeof value === 'string' && value.includes('@')
    };

    // Initialize store with validators
    const store = new Store({ name: 'John', age: 25 }, validators);
    
    // Enable debug logging
    store.setDebug(true);

    // Subscribe to changes
    const unsubscribe = store.subscribe((state) => {
        console.log('State changed:', state);
    });

    // Update state
    store.setState({ age: 26 }); // Valid update
    try {
        store.setState({ age: -1 }); // Will throw validation error
    } catch (error) {
        console.error('Validation error:', error.message);
    }

    // Unsubscribe
    unsubscribe();
};

export default Store; 