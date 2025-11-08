/**
 * Selector Utilities
 * 
 * Provides memoization and caching for selectors to prevent unnecessary recalculations.
 * Selectors are functions that derive state from the store, and memoization ensures
 * they only recalculate when their dependencies change.
 */

/**
 * Shallow equality check for dependency comparison
 * @private
 */
function shallowEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        if (a[key] !== b[key]) return false;
    }

    return true;
}

/**
 * Create a memoized selector
 * 
 * The selector will only recalculate when dependencies change.
 * Dependencies are compared using shallow equality.
 * 
 * @param {Array<Function>} dependencies - Array of selector functions that provide dependencies
 * @param {Function} computeFn - Function that computes the result from dependencies
 * @param {Object} options - Options for the selector
 * @param {boolean} options.debug - Enable performance logging
 * @param {string} options.name - Name for debugging
 * @returns {Function} - Memoized selector function
 * 
 * @example
 * const selectPrice = createSelector(
 *   [() => store.selectPrice()],
 *   (price) => price.current * 1.1, // 10% markup
 *   { name: 'selectPriceWithMarkup' }
 * );
 * 
 * @example
 * // Nested selector
 * const selectTotalValue = createSelector(
 *   [() => store.selectPrice(), () => store.selectBalance()],
 *   (price, balance) => price.current * balance.exec,
 *   { name: 'selectTotalValue' }
 * );
 */
export function createSelector(dependencies, computeFn, options = {}) {
    const { debug = false, name = 'selector' } = options;
    
    let lastDependencies = null;
    let lastResult = null;
    let callCount = 0;
    let computeCount = 0;

    const selector = (...args) => {
        callCount++;

        // Get current dependency values
        const currentDependencies = dependencies.map(dep => dep(...args));

        // Check if dependencies changed
        const dependenciesChanged = lastDependencies === null || 
            !shallowEqual(currentDependencies, lastDependencies);

        if (dependenciesChanged) {
            const startTime = debug ? performance.now() : 0;
            
            // Recompute result
            lastResult = computeFn(...currentDependencies, ...args);
            lastDependencies = currentDependencies;
            computeCount++;

            if (debug) {
                const duration = performance.now() - startTime;
                console.log(`[Selector:${name}] Recomputed in ${duration.toFixed(2)}ms`, {
                    callCount,
                    computeCount,
                    cacheHitRate: `${((callCount - computeCount) / callCount * 100).toFixed(2)}%`
                });
            }
        } else if (debug && callCount % 100 === 0) {
            // Log cache stats periodically
            console.log(`[Selector:${name}] Cache stats:`, {
                callCount,
                computeCount,
                cacheHitRate: `${((callCount - computeCount) / callCount * 100).toFixed(2)}%`
            });
        }

        return lastResult;
    };

    // Add debug methods
    selector.getStats = () => ({
        name,
        callCount,
        computeCount,
        cacheHitRate: callCount > 0 ? ((callCount - computeCount) / callCount * 100).toFixed(2) + '%' : '0%',
        lastDependencies,
        lastResult
    });

    selector.reset = () => {
        lastDependencies = null;
        lastResult = null;
        callCount = 0;
        computeCount = 0;
    };

    return selector;
}

/**
 * Create a selector that combines multiple selectors
 * 
 * @param {Array<Function>} selectors - Array of selector functions
 * @param {Function} combineFn - Function to combine results
 * @param {Object} options - Options for the selector
 * @returns {Function} - Combined selector function
 * 
 * @example
 * const selectCombined = combineSelectors(
 *   [selectPrice, selectBalance],
 *   (price, balance) => ({ price, balance, total: price * balance })
 * );
 */
export function combineSelectors(selectors, combineFn, options = {}) {
    return createSelector(
        selectors,
        combineFn,
        options
    );
}

/**
 * Create a selector with custom equality function
 * 
 * @param {Array<Function>} dependencies - Array of selector functions
 * @param {Function} computeFn - Function that computes the result
 * @param {Function} equalityFn - Custom equality function (a, b) => boolean
 * @param {Object} options - Options for the selector
 * @returns {Function} - Memoized selector with custom equality
 */
export function createSelectorWithEquality(dependencies, computeFn, equalityFn, options = {}) {
    const { debug = false, name = 'selector' } = options;
    
    let lastDependencies = null;
    let lastResult = null;
    let callCount = 0;
    let computeCount = 0;

    const selector = (...args) => {
        callCount++;

        // Get current dependency values
        const currentDependencies = dependencies.map(dep => dep(...args));

        // Check if dependencies changed using custom equality
        const dependenciesChanged = lastDependencies === null || 
            !equalityFn(currentDependencies, lastDependencies);

        if (dependenciesChanged) {
            const startTime = debug ? performance.now() : 0;
            
            // Recompute result
            lastResult = computeFn(...currentDependencies, ...args);
            lastDependencies = currentDependencies;
            computeCount++;

            if (debug) {
                const duration = performance.now() - startTime;
                console.log(`[Selector:${name}] Recomputed in ${duration.toFixed(2)}ms`);
            }
        }

        return lastResult;
    };

    selector.getStats = () => ({
        name,
        callCount,
        computeCount,
        cacheHitRate: callCount > 0 ? ((callCount - computeCount) / callCount * 100).toFixed(2) + '%' : '0%'
    });

    selector.reset = () => {
        lastDependencies = null;
        lastResult = null;
        callCount = 0;
        computeCount = 0;
    };

    return selector;
}

/**
 * Clear all selector caches (useful for testing or reset)
 * Note: This only works if selectors are registered
 */
const selectorRegistry = new WeakMap();

export function registerSelector(selector, name) {
    selectorRegistry.set(selector, { name, selector });
}

export function clearAllSelectors() {
    // Note: WeakMap doesn't support iteration, so this is a placeholder
    // In practice, you'd maintain a separate registry for clearing
    console.warn('clearAllSelectors: Selector clearing not fully implemented. Use selector.reset() instead.');
}

