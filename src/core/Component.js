import { eventBus } from './EventBus.js';
import { DOMUpdater } from '../utils/DOMUpdater.js';
import { getUpdateScheduler } from '../utils/UpdateScheduler.js';

export class Component {
    constructor(rootElement) {
        this.element = rootElement;
        this.state = {};
        this.mounted = false;
        this.boundEvents = new Map();
        // Cleanup registry for tracking all cleanup functions
        this._cleanupRegistry = new Set();
        // Child components registry for automatic cleanup
        this._children = new Map();
        // Event subscriptions registry for automatic cleanup
        this._subscriptions = new Set();
        // DOM updater for granular updates
        this._domUpdater = new DOMUpdater();
        // Element reference cache
        this._refs = new Map();
        // Context storage
        this._context = new Map();
        // Parent component reference for context traversal
        this._parent = null;
    }

    /**
     * Initialize state with default values
     * @param {Object} initialState 
     */
    setState(newState) {
        const oldState = {...this.state};
        this.state = { ...this.state, ...newState };
        
        // Only update if we should based on state changes
        if (this.shouldUpdate(oldState, this.state)) {
            this.update();
            this.onStateUpdate(oldState, this.state);
        }
    }

    /**
     * Determines if the component should update based on state changes
     * Override in child classes for custom comparison logic
     * @param {Object} oldState - Previous state
     * @param {Object} newState - New state 
     * @returns {boolean} - Whether component should update
     */
    shouldUpdate(oldState, newState) {
        // Default shallow comparison of top-level state properties
        // Check if any properties have changed
        if (!oldState || !newState) return true;
        
        // Check if object references are the same
        if (oldState === newState) return false;
        
        // Do a shallow comparison of properties
        const oldKeys = Object.keys(oldState);
        const newKeys = Object.keys(newState);
        
        // If they have different number of keys, they changed
        if (oldKeys.length !== newKeys.length) return true;
        
        // Check if any key's value has changed
        return oldKeys.some(key => oldState[key] !== newState[key]);
    }
    
    /**
     * Lifecycle hook called after state is updated but before rendering
     * Override in child classes to handle state updates
     * @param {Object} oldState 
     * @param {Object} newState 
     */
    onStateUpdate(oldState, newState) {
        // Default implementation does nothing
    }

    /**
     * Mount component to DOM
     * @param {HTMLElement} container 
     */
    mount(element) {
        try {
            this.element = element;
            this.mounted = true;
            
            // Apply styles if they exist
            if (this.constructor.styles) {
                const styleElement = document.createElement('style');
                styleElement.textContent = this.constructor.styles;
                document.head.appendChild(styleElement);
                this.styleElement = styleElement;
                
                // Register cleanup for style element
                this.registerCleanup(() => {
                    if (this.styleElement && this.styleElement.parentNode) {
                        this.styleElement.remove();
                    }
                });
            }

            this.update();
            if (this.onMount) {
                this.onMount();
            }
        } catch (error) {
            this._handleError(error, { phase: 'mount' });
        }
    }

    /**
     * Remove component from DOM
     */
    unmount() {
        if (!this.mounted) return;

        // Unmount all child components first
        this._unmountChildren();
        
        // Execute all registered cleanup functions
        this._executeCleanup();
        
        // Unbind all events
        this.unbindEvents();
        
        // Clear all refs
        this.invalidateRefs();
        
        // Remove element if it exists
        if (this.element && this.element.parentNode) {
            this.element.remove();
        }
        this.element = null;
        
        // Call lifecycle method
        this.mounted = false;
        if (this.onUnmount) {
            this.onUnmount();
        }
    }

    /**
     * Bind DOM events based on this.events()
     */
    bindEvents() {
        // First unbind any existing events
        this.unbindEvents();
        
        const events = this.events();
        if (!events) return;

        for (const [eventSelector, handler] of Object.entries(events)) {
            const [eventName, selector] = eventSelector.split(' ');
            const boundHandler = handler.bind(this);
            
            if (selector) {
                // Delegated event
                const eventHandler = (e) => {
                    if (e.target.matches(selector)) {
                        boundHandler(e);
                    }
                };
                this.element.addEventListener(eventName, eventHandler);
                this.boundEvents.set(eventSelector, eventHandler);
            } else {
                // Direct event
                this.element.addEventListener(eventName, boundHandler);
                this.boundEvents.set(eventSelector, boundHandler);
            }
        }
        
        // Note: Event listeners are cleaned up via unbindEvents() in unmount()
        // The cleanup registry is for other resources (timers, intervals, async operations, etc.)
    }

    /**
     * Unbind all DOM events
     */
    unbindEvents() {
        for (const [eventSelector, handler] of this.boundEvents.entries()) {
            const [eventName] = eventSelector.split(' ');
            this.element.removeEventListener(eventName, handler);
        }
        this.boundEvents.clear();
    }

    /**
     * Update component after state change
     */
    update() {
        if (!this.element) return;
        
        try {
            // Get new content
            const newContent = this.render();
            
            // Always update on first render or when content changes
            // First render is detected by checking if innerHTML is empty
            if (!this.element.innerHTML || this.element.innerHTML !== newContent) {
                // Try granular update first (preserves focus/scroll)
                const granularSuccess = this._domUpdater.updateGranular(this.element, newContent);
                
                if (!granularSuccess) {
                    // Fall back to full replacement for complex structural changes
                    // Note: This will destroy child components, so they need to be re-mounted
                    this.element.innerHTML = newContent;
                }
                
                // Invalidate refs cache after DOM update
                this.invalidateRefs();
                
                // Re-attach event listeners after DOM update
                if (this.setupDOMEventListeners) {
                    this.setupDOMEventListeners();
                }
                
                // Bind events if events() method exists
                if (this.events && typeof this.events === 'function') {
                    this.bindEvents();
                }
            }
        } catch (error) {
            this._handleError(error, { phase: 'update' });
        }
    }

    /**
     * Schedule a component update with optional priority
     * 
     * This method allows components to opt-in to requestAnimationFrame batching
     * for better performance when multiple components update simultaneously.
     * 
     * @param {Object} options - Update options
     * @param {boolean} options.immediate - If true, update immediately (bypass batching).
     *                                      Use for critical updates (user input, errors).
     *                                      Default: false (batched)
     * 
     * @example
     *   // Batched update (default) - good for price updates, balance updates
     *   this.scheduleUpdate();
     *   
     *   // Immediate update - good for user input, error displays
     *   this.scheduleUpdate({ immediate: true });
     */
    scheduleUpdate(options = {}) {
        if (options.immediate) {
            // Critical update - execute immediately
            this.update();
        } else {
            // Non-critical update - queue for batching
            const scheduler = getUpdateScheduler();
            scheduler.queue(this);
        }
    }

    // Lifecycle methods (to be overridden by child classes)
    onMount() {}
    onUnmount() {}
    onUpdate(oldState) {}
    
    /**
     * Error handler lifecycle hook
     * Override in child classes to handle errors
     * @param {Error} error - The error that occurred
     * @param {Object} errorInfo - Additional error information
     */
    onError(error, errorInfo) {
        // Default implementation does nothing
        // Child classes can override to handle errors
    }

    // Methods to be implemented by child classes
    render() {
        try {
            return this.template ? this.template() : '';
        } catch (error) {
            this._handleError(error, { phase: 'render' });
            return '<div class="component-error">Error rendering component</div>';
        }
    }
    
    /**
     * Handle errors and propagate to nearest ErrorBoundary
     * @private
     */
    _handleError(error, errorInfo = {}) {
        // Call component's error handler if it exists
        if (this.onError) {
            try {
                this.onError(error, errorInfo);
            } catch (handlerError) {
                console.error('[Component] Error in onError handler:', handlerError);
            }
        }
        
        // Propagate to parent ErrorBoundary if it exists
        // Check by constructor name to avoid circular dependency
        let parent = this._parent;
        while (parent) {
            if (parent.constructor && parent.constructor.name === 'ErrorBoundary') {
                if (parent._errorHandler) {
                    parent._errorHandler(error, { ...errorInfo, component: this.constructor.name });
                }
                return;
            }
            parent = parent._parent;
        }
        
        // If no ErrorBoundary found, log to console
        console.error(`[Component] Unhandled error in ${this.constructor.name}:`, error, errorInfo);
    }

    events() {
        return {};
    }

    /**
     * Register a cleanup function to be called on unmount
     * @param {Function} cleanupFn - Function to call during cleanup
     * @returns {Function} - Unregister function to remove this cleanup
     */
    registerCleanup(cleanupFn) {
        if (typeof cleanupFn !== 'function') {
            console.warn('[Component] registerCleanup called with non-function:', cleanupFn);
            return () => {};
        }
        
        this._cleanupRegistry.add(cleanupFn);
        
        // Return unregister function
        return () => {
            this._cleanupRegistry.delete(cleanupFn);
        };
    }

    /**
     * Execute all registered cleanup functions
     * @private
     */
    _executeCleanup() {
        for (const cleanupFn of this._cleanupRegistry) {
            try {
                cleanupFn();
            } catch (error) {
                console.error('[Component] Error during cleanup:', error);
            }
        }
        this._cleanupRegistry.clear();
    }

    /**
     * Unmount all child components
     * @private
     */
    _unmountChildren() {
        for (const [key, child] of this._children.entries()) {
            try {
                if (child && typeof child.unmount === 'function') {
                    child.unmount();
                }
            } catch (error) {
                console.error(`[Component] Error unmounting child "${key}":`, error);
            }
        }
        this._children.clear();
    }

    /**
     * Create and track a child component
     * @param {string} key - Unique key for this child component
     * @param {Component} childComponent - Child component instance
     * @returns {Component} - The child component
     */
    createChild(key, childComponent) {
        if (this._children.has(key)) {
            console.warn(`[Component] Child with key "${key}" already exists, unmounting previous instance`);
            const previous = this._children.get(key);
            if (previous && typeof previous.unmount === 'function') {
                previous.unmount();
            }
        }
        
        // Set parent reference for context traversal
        childComponent._parent = this;
        
        // Inherit parent context
        this._context.forEach((value, key) => {
            childComponent._context.set(key, value);
        });
        
        this._children.set(key, childComponent);
        
        // Register cleanup to unmount child
        this.registerCleanup(() => {
            if (childComponent && typeof childComponent.unmount === 'function') {
                childComponent.unmount();
            }
            this._children.delete(key);
        });
        
        return childComponent;
    }

    /**
     * Wrapper for setTimeout that automatically registers cleanup
     * @param {Function} callback - Function to call after delay
     * @param {number} delay - Delay in milliseconds
     * @returns {number} - Timer ID (can be used with clearTimeout)
     */
    setTimeout(callback, delay) {
        const timerId = window.setTimeout(callback, delay);
        
        // Register cleanup to clear the timer
        this.registerCleanup(() => {
            window.clearTimeout(timerId);
        });
        
        return timerId;
    }

    /**
     * Wrapper for setInterval that automatically registers cleanup
     * @param {Function} callback - Function to call repeatedly
     * @param {number} delay - Interval in milliseconds
     * @returns {number} - Timer ID (can be used with clearInterval)
     */
    setInterval(callback, delay) {
        const timerId = window.setInterval(callback, delay);
        
        // Register cleanup to clear the interval
        this.registerCleanup(() => {
            window.clearInterval(timerId);
        });
        
        return timerId;
    }

    /**
     * Subscribe to an event with automatic cleanup on unmount
     * @param {string} eventName - Name of the event to subscribe to
     * @param {Function} callback - Callback function to call when event is emitted
     * @returns {Function} - Unsubscribe function (also auto-called on unmount)
     */
    subscribe(eventName, callback) {
        // Subscribe to the event
        const unsubscribe = eventBus.on(eventName, callback);
        
        // Track the subscription for automatic cleanup
        this._subscriptions.add(unsubscribe);
        
        // Register cleanup to unsubscribe
        this.registerCleanup(() => {
            unsubscribe();
            this._subscriptions.delete(unsubscribe);
        });
        
        return unsubscribe;
    }

    /**
     * Subscribe to an event for one-time use with automatic cleanup
     * @param {string} eventName - Name of the event to subscribe to
     * @param {Function} callback - Callback function to call when event is emitted (once)
     * @returns {Function} - Unsubscribe function (also auto-called on unmount or after first call)
     */
    subscribeOnce(eventName, callback) {
        // Subscribe to the event once
        const unsubscribe = eventBus.once(eventName, callback);
        
        // Track the subscription for automatic cleanup
        this._subscriptions.add(unsubscribe);
        
        // Register cleanup
        this.registerCleanup(() => {
            unsubscribe();
            this._subscriptions.delete(unsubscribe);
        });
        
        return unsubscribe;
    }

    /**
     * Hook to subscribe to store state changes
     * Automatically updates component when selected store state changes
     * 
     * STATE OWNERSHIP RULES:
     * - UI-only state (focus, hover, temporary UI state) → use this.state
     * - Shared/global state (balances, price, wallet, contract data) → use store
     * - Derived state → use selectors
     * 
     * Usage examples:
     *   // Using a selector method
     *   const isPhase2 = this.useStore(tradingStore, () => tradingStore.selectIsPhase2());
     *   
     *   // Using a direct state selector
     *   const price = this.useStore(tradingStore, (state) => state.price.current);
     *   
     *   // With update callback
     *   this.useStore(tradingStore, () => tradingStore.selectIsPhase2(), (newValue, oldValue) => {
     *     console.log('Phase 2 changed:', newValue);
     *   });
     * 
     * @param {Store} store - Store instance to subscribe to
     * @param {Function} selector - Function that selects state (can be store method or state selector)
     * @param {Function} onUpdate - Optional callback when selected state changes
     * @returns {any} - Current selected state value
     */
    useStore(store, selector, onUpdate) {
        if (!store || typeof selector !== 'function') {
            console.warn('[Component] useStore called with invalid arguments');
            return null;
        }

        // Store the last value for comparison
        if (!this._storeValues) {
            this._storeValues = new Map();
        }
        
        const selectorKey = selector.toString(); // Use function string as key (not perfect but works)
        let lastValue = this._storeValues.get(selectorKey);
        
        // Get initial value
        const getCurrentValue = () => {
            // Try calling as store method first (e.g., tradingStore.selectIsPhase2())
            try {
                const result = selector.call(store);
                if (result !== undefined) {
                    return result;
                }
            } catch (e) {
                // Not a method, try as state selector
            }
            
            // Try as state selector (e.g., (state) => state.price)
            return selector(store.getState());
        };
        
        const currentValue = getCurrentValue();
        this._storeValues.set(selectorKey, currentValue);
        
        // Subscribe to store changes
        const unsubscribe = store.subscribe(() => {
            const newValue = getCurrentValue();
            const oldValue = lastValue;
            
            // Only update if value actually changed (shallow comparison)
            if (this._hasValueChanged(oldValue, newValue)) {
                // Update stored value
                this._storeValues.set(selectorKey, newValue);
                lastValue = newValue;
                
                // Call optional update callback
                if (typeof onUpdate === 'function') {
                    onUpdate(newValue, oldValue);
                }
                
                // Trigger component update
                this.update();
            }
        });
        
        // Register cleanup to unsubscribe
        this.registerCleanup(() => {
            unsubscribe();
            if (this._storeValues) {
                this._storeValues.delete(selectorKey);
            }
        });
        
        return currentValue;
    }

    /**
     * Check if two values have changed (shallow comparison)
     * @private
     */
    _hasValueChanged(oldValue, newValue) {
        // Primitive comparison
        if (oldValue === newValue) return false;
        
        // Null/undefined handling
        if (oldValue == null || newValue == null) return oldValue !== newValue;
        
        // Object comparison (shallow)
        if (typeof oldValue === 'object' && typeof newValue === 'object') {
            const oldKeys = Object.keys(oldValue);
            const newKeys = Object.keys(newValue);
            
            if (oldKeys.length !== newKeys.length) return true;
            
            return oldKeys.some(key => oldValue[key] !== newValue[key]);
        }
        
        return true;
    }

    /**
     * Get a cached element reference by name and selector
     * @param {string} name - Reference name (for caching)
     * @param {string} selector - CSS selector to find element
     * @returns {HTMLElement|null} - Element or null if not found
     */
    getRef(name, selector) {
        if (!this.element) return null;

        // Check cache first
        if (this._refs.has(name)) {
            const cached = this._refs.get(name);
            // Verify element is still in DOM
            if (cached && this.element.contains(cached)) {
                return cached;
            }
            // Stale reference, remove from cache
            this._refs.delete(name);
        }

        // Query DOM if not cached
        const element = this.element.querySelector(selector);
        if (element) {
            this._refs.set(name, element);
        }

        return element;
    }

    /**
     * Get multiple elements by selector (no caching for collections)
     * @param {string} selector - CSS selector to find elements
     * @returns {Array<HTMLElement>} - Array of matching elements (empty array if none found)
     */
    getRefs(selector) {
        if (!this.element) {
            console.warn(`[Component] getRefs called on ${this.constructor.name} before element exists`);
            return [];
        }
        // Convert NodeList to Array for easier manipulation
        return Array.from(this.element.querySelectorAll(selector));
    }

    /**
     * Manually update a cached reference
     * @param {string} name - Reference name
     * @param {HTMLElement} element - Element to cache
     */
    updateRef(name, element) {
        if (element) {
            this._refs.set(name, element);
        } else {
            this._refs.delete(name);
        }
    }

    /**
     * Invalidate all cached references
     * Should be called when DOM structure changes significantly
     */
    invalidateRefs() {
        this._refs.clear();
    }

    /**
     * Invalidate a specific cached reference
     * @param {string} name - Reference name to invalidate
     */
    invalidateRef(name) {
        this._refs.delete(name);
    }

    /**
     * Provide a context value to child components
     * @param {string} key - Context key
     * @param {any} value - Context value
     */
    provideContext(key, value) {
        this._context.set(key, value);
        
        // Propagate to existing children
        this._children.forEach(child => {
            if (child && typeof child._context !== 'undefined') {
                child._context.set(key, value);
            }
        });
    }

    /**
     * Get a context value, searching up the component tree
     * @param {string} key - Context key
     * @returns {any} - Context value or undefined if not found
     */
    getContext(key) {
        // Check own context first
        if (this._context.has(key)) {
            return this._context.get(key);
        }
        
        // Search up the tree
        let parent = this._parent;
        while (parent) {
            if (parent._context && parent._context.has(key)) {
                return parent._context.get(key);
            }
            parent = parent._parent;
        }
        
        return undefined;
    }

    /**
     * Remove a context value
     * @param {string} key - Context key to remove
     */
    removeContext(key) {
        this._context.delete(key);
        
        // Remove from children
        this._children.forEach(child => {
            if (child && typeof child._context !== 'undefined') {
                child._context.delete(key);
            }
        });
    }
} 