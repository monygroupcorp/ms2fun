/**
 * UpdateScheduler - Coordinates component updates using requestAnimationFrame batching
 * 
 * Prevents UI blocking by batching multiple component updates into a single frame.
 * Components can opt-in to batching for non-critical updates, while critical updates
 * (user input, errors) can execute immediately.
 * 
 * Usage:
 *   // In Component.js
 *   this.scheduleUpdate(); // Batched (default)
 *   this.scheduleUpdate({ immediate: true }); // Immediate
 */
export class UpdateScheduler {
    constructor() {
        // Queue of components waiting to be updated
        this._queue = new Set();
        
        // Flag to track if requestAnimationFrame is already scheduled
        this._scheduled = false;
        
        // Performance metrics (only tracked in dev mode)
        this._metrics = {
            frames: 0,
            updates: 0,
            maxFrameTime: 0,
            totalFrameTime: 0,
            maxUpdatesPerFrame: 0
        };
        
        // Dev mode flag (can be enabled for performance monitoring)
        this._devMode = false;
        
        // Track if scheduler is enabled (can be disabled for debugging)
        this._enabled = true;
    }
    
    /**
     * Get singleton instance
     * @returns {UpdateScheduler}
     */
    static getInstance() {
        if (!UpdateScheduler._instance) {
            UpdateScheduler._instance = new UpdateScheduler();
        }
        return UpdateScheduler._instance;
    }
    
    /**
     * Enable or disable dev mode (performance tracking)
     * @param {boolean} enabled
     */
    setDevMode(enabled) {
        this._devMode = enabled;
    }
    
    /**
     * Enable or disable the scheduler (for debugging)
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled && this._scheduled) {
            // Cancel pending frame if disabling
            this._queue.clear();
            this._scheduled = false;
        }
    }
    
    /**
     * Queue a component for batched update
     * @param {Component} component - Component instance to update
     */
    queue(component) {
        if (!this._enabled) {
            // If scheduler is disabled, execute immediately
            try {
                component.update();
            } catch (error) {
                console.error('[UpdateScheduler] Error updating component (immediate):', error);
            }
            return;
        }
        
        if (!component || typeof component.update !== 'function') {
            console.warn('[UpdateScheduler] Invalid component queued:', component);
            return;
        }
        
        // Add to queue (Set automatically deduplicates)
        this._queue.add(component);
        
        // Schedule flush if not already scheduled
        if (!this._scheduled) {
            this._scheduled = true;
            requestAnimationFrame(() => this._flush());
        }
    }
    
    /**
     * Execute all queued updates in a single frame
     * @private
     */
    _flush() {
        if (this._queue.size === 0) {
            this._scheduled = false;
            return;
        }
        
        const start = performance.now();
        const updates = Array.from(this._queue);
        const updateCount = updates.length;
        
        // Clear queue and reset scheduled flag
        this._queue.clear();
        this._scheduled = false;
        
        // Execute all updates
        updates.forEach(component => {
            try {
                // Check if component is still mounted/valid before updating
                if (component && component.element && typeof component.update === 'function') {
                    component.update();
                }
            } catch (error) {
                // Log error but continue with other updates
                console.error('[UpdateScheduler] Error updating component:', error);
                console.error('[UpdateScheduler] Component:', component);
            }
        });
        
        const duration = performance.now() - start;
        
        // Track metrics in dev mode
        if (this._devMode) {
            this._metrics.frames++;
            this._metrics.updates += updateCount;
            this._metrics.totalFrameTime += duration;
            this._metrics.maxFrameTime = Math.max(this._metrics.maxFrameTime, duration);
            this._metrics.maxUpdatesPerFrame = Math.max(this._metrics.maxUpdatesPerFrame, updateCount);
            
            // Warn if frame took too long (>16ms for 60fps)
            if (duration > 16) {
                console.warn(
                    `[UpdateScheduler] Frame took ${duration.toFixed(2)}ms (>16ms target). ` +
                    `Updated ${updateCount} component(s).`
                );
            }
        }
        
        // Handle nested updates (components that schedule updates during their update)
        // If new updates were queued during this flush, schedule another frame
        if (this._queue.size > 0) {
            this._scheduled = true;
            requestAnimationFrame(() => this._flush());
        }
    }
    
    /**
     * Get performance metrics
     * @returns {Object} Metrics object
     */
    getMetrics() {
        if (!this._devMode) {
            return { enabled: false };
        }
        
        const avgFrameTime = this._metrics.frames > 0
            ? this._metrics.totalFrameTime / this._metrics.frames
            : 0;
        
        const avgUpdatesPerFrame = this._metrics.frames > 0
            ? this._metrics.updates / this._metrics.frames
            : 0;
        
        return {
            enabled: true,
            frames: this._metrics.frames,
            totalUpdates: this._metrics.updates,
            maxFrameTime: this._metrics.maxFrameTime,
            avgFrameTime: avgFrameTime,
            maxUpdatesPerFrame: this._metrics.maxUpdatesPerFrame,
            avgUpdatesPerFrame: avgUpdatesPerFrame
        };
    }
    
    /**
     * Reset performance metrics
     */
    resetMetrics() {
        this._metrics = {
            frames: 0,
            updates: 0,
            maxFrameTime: 0,
            totalFrameTime: 0,
            maxUpdatesPerFrame: 0
        };
    }
    
    /**
     * Clear the update queue (useful for cleanup or testing)
     */
    clear() {
        this._queue.clear();
        this._scheduled = false;
    }
    
    /**
     * Get current queue size (for debugging)
     * @returns {number}
     */
    getQueueSize() {
        return this._queue.size;
    }
}

// Export singleton instance getter
export const getUpdateScheduler = () => UpdateScheduler.getInstance();

