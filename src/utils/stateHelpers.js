/**
 * State Management Helpers
 * 
 * Utilities for managing state ownership and synchronization
 * 
 * STATE OWNERSHIP RULES:
 * 
 * 1. UI-ONLY STATE (Component State - this.state):
 *    - Focus state (input focus, dropdown open/closed)
 *    - Hover state
 *    - Temporary UI state (loading spinners, modals)
 *    - Form input values (before submission)
 *    - Scroll position
 *    - Animation state
 * 
 * 2. SHARED/GLOBAL STATE (Store State - tradingStore):
 *    - Wallet connection state (address, network, connected)
 *    - Token balances (ETH, EXEC, NFTs)
 *    - Price data
 *    - Contract data (liquidity pool, supply, etc.)
 *    - Transaction state
 *    - Phase 2 status (isPhase2)
 *    - View preferences (if shared across components)
 * 
 * 3. DERIVED STATE (Selectors):
 *    - Computed values from store state
 *    - Filtered/transformed data
 *    - Aggregated values
 * 
 * MIGRATION GUIDE:
 * 
 * Before (duplicate state):
 *   this.state = { isPhase2: false };
 *   const isPhase2 = this.state.isPhase2;
 * 
 * After (store state):
 *   const isPhase2 = tradingStore.selectIsPhase2();
 *   this.useStore(tradingStore, (state) => tradingStore.selectIsPhase2(), (newValue) => {
 *     // Handle phase 2 change
 *   });
 */

/**
 * Validate that component state and store state are in sync
 * Useful for catching desync issues during development
 * 
 * @param {Object} componentState - Component's local state
 * @param {Object} storeState - Store's state
 * @param {Array<string>} syncKeys - Keys that should be in sync
 * @returns {Object} - Validation result with isSync and differences
 */
export function validateStateSync(componentState, storeState, syncKeys) {
    const differences = [];
    
    for (const key of syncKeys) {
        const componentValue = componentState[key];
        const storeValue = storeState[key];
        
        if (componentValue !== storeValue) {
            differences.push({
                key,
                componentValue,
                storeValue
            });
        }
    }
    
    return {
        isSync: differences.length === 0,
        differences
    };
}

/**
 * Create a state sync validator for a component
 * Logs warnings when state desync is detected
 * 
 * @param {Component} component - Component instance
 * @param {Store} store - Store instance
 * @param {Array<string>} syncKeys - Keys to validate
 * @returns {Function} - Validator function to call after state updates
 */
export function createStateSyncValidator(component, store, syncKeys) {
    return () => {
        if (process.env.NODE_ENV === 'development') {
            const validation = validateStateSync(component.state, store.getState(), syncKeys);
            
            if (!validation.isSync) {
                console.warn('[StateSync] Component state out of sync with store:', validation.differences);
            }
        }
    };
}

/**
 * Helper to determine if state should be in component or store
 * 
 * @param {string} stateKey - Name of the state key
 * @param {string} description - Description of what the state represents
 * @returns {'component'|'store'|'derived'} - Recommended location
 */
export function recommendStateLocation(stateKey, description) {
    const uiOnlyKeywords = ['focus', 'hover', 'open', 'closed', 'loading', 'scroll', 'animation', 'temp', 'pending'];
    const sharedKeywords = ['balance', 'price', 'wallet', 'contract', 'transaction', 'phase', 'network', 'address'];
    
    const lowerKey = stateKey.toLowerCase();
    const lowerDesc = description.toLowerCase();
    
    if (uiOnlyKeywords.some(keyword => lowerKey.includes(keyword) || lowerDesc.includes(keyword))) {
        return 'component';
    }
    
    if (sharedKeywords.some(keyword => lowerKey.includes(keyword) || lowerDesc.includes(keyword))) {
        return 'store';
    }
    
    return 'derived';
}

