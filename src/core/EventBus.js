class EventBus {
    constructor() {
        this.listeners = new Map();
        this.debugMode = true;
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled 
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Subscribe to an event
     * @param {string} eventName 
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        
        this.listeners.get(eventName).add(callback);
        
        if (this.debugMode) {
            console.log(`[EventBus] Listener added for "${eventName}"`);
        }

        // Return unsubscribe function
        return () => this.off(eventName, callback);
    }

    /**
     * Remove a specific event listener
     * @param {string} eventName 
     * @param {Function} callback 
     */
    off(eventName, callback) {
        if (!this.listeners.has(eventName)) return;
        
        this.listeners.get(eventName).delete(callback);
        
        if (this.debugMode) {
            console.log(`[EventBus] Listener removed for "${eventName}"`);
        }

        // Cleanup empty event sets
        if (this.listeners.get(eventName).size === 0) {
            this.listeners.delete(eventName);
        }
    }

    /**
     * Remove all listeners for an event
     * @param {string} eventName 
     */
    removeAllListeners(eventName) {
        if (eventName) {
            this.listeners.delete(eventName);
            if (this.debugMode) {
                console.log(`[EventBus] All listeners removed for "${eventName}"`);
            }
        } else {
            this.listeners.clear();
            if (this.debugMode) {
                console.log('[EventBus] All listeners removed');
            }
        }
    }

    /**
     * Emit an event with data
     * @param {string} eventName 
     * @param {any} data 
     */
    emit(eventName, data) {
        if (!this.listeners.has(eventName)) return;

        if (this.debugMode) {
            console.log(`[EventBus] Emitting "${eventName}"`, data);
        }

        this.listeners.get(eventName).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[EventBus] Error in listener for "${eventName}":`, error);
            }
        });
    }
}

// Create a single instance for the application
export const eventBus = new EventBus(); 