import { eventBus } from '../core/EventBus.js';

// Layout-related event names
const EVENTS = {
    RESIZE: 'layout:resize',
    VIEW_CHANGE: 'layout:viewChange',
    BREAKPOINT_CHANGE: 'layout:breakpointChange',
    TAB_CHANGE: 'layout:tabChange'
};

class LayoutService {
    constructor() {
        // Default breakpoints (in pixels)
        this.breakpoints = {
            mobile: 768,
            tablet: 1024,
            desktop: 1280
        };

        // Current state
        this.state = {
            currentBreakpoint: this.getCurrentBreakpoint(),
            isMobile: window.innerWidth <= this.breakpoints.mobile,
            activeTab: 'swap',
            visibleViews: [],  // Start empty and let initialize() set the correct views
            dimensions: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        };

        // Bind methods
        this.handleResize = this.handleResize.bind(this);
        this.handleTabChange = this.handleTabChange.bind(this);

        // Debounce resize handler
        this.debouncedResize = this.debounce(this.handleResize, 250);
    }

    /**
     * Initialize the service and set up event listeners
     */
    initialize() {
        // Set initial visible views based on mobile state
        this.state.visibleViews = this.state.isMobile ? [this.state.activeTab] : ['swap', 'curve'];

        // Add window resize listener
        window.addEventListener('resize', this.debouncedResize);

        // Subscribe to tab change events
        eventBus.on('trading:click:tab', this.handleTabChange);

        // Emit initial state
        this.emitCurrentState();

        return this;
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        window.removeEventListener('resize', this.debouncedResize);
        // Note: eventBus cleanup not needed as it handles its own lifecycle
    }

    /**
     * Handle window resize events
     */
    handleResize() {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        const oldBreakpoint = this.state.currentBreakpoint;
        const newBreakpoint = this.getCurrentBreakpoint();

        // Force check isMobile based on actual viewport width
        const isMobile = newWidth <= this.breakpoints.mobile;

        // Update state
        const newState = {
            ...this.state,
            currentBreakpoint: newBreakpoint,
            isMobile: isMobile,  // Explicitly set based on width
            dimensions: { width: newWidth, height: newHeight }
        };

        // Update visible views based on mobile state
        if (isMobile) {
            newState.visibleViews = [newState.activeTab];
        } else {
            newState.visibleViews = ['swap', 'curve'];
        }

        this.state = newState;

        // Emit resize event with new dimensions
        eventBus.emit(EVENTS.RESIZE, {
            width: newWidth,
            height: newHeight,
            isMobile: isMobile  // Make sure we're passing the correct mobile state
        });

        // Emit breakpoint change if it changed
        if (oldBreakpoint !== newBreakpoint) {
            eventBus.emit(EVENTS.BREAKPOINT_CHANGE, {
                previous: oldBreakpoint,
                current: newBreakpoint
            });
        }

        // Emit view change if visibility changed
        eventBus.emit(EVENTS.VIEW_CHANGE, {
            visibleViews: newState.visibleViews,
            activeTab: newState.activeTab
        });
    }

    /**
     * Handle tab change events
     */
    handleTabChange({ view }) {
        if (!view || this.state.activeTab === view) return;

        const newState = {
            ...this.state,
            activeTab: view,
            // Always update visibleViews based on current mobile state
            visibleViews: this.state.isMobile ? [view] : ['swap', 'curve']
        };

        // Update the state
        this.state = newState;

        // Emit view change event
        eventBus.emit(EVENTS.VIEW_CHANGE, {
            activeTab: view,
            visibleViews: newState.visibleViews
        });

        // Emit tab change event
        eventBus.emit(EVENTS.TAB_CHANGE, {
            activeTab: view,
            visibleViews: newState.visibleViews
        });
    }

    /**
     * Get current breakpoint based on window width
     */
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        if (width <= this.breakpoints.mobile) return 'mobile';
        if (width <= this.breakpoints.tablet) return 'tablet';
        if (width <= this.breakpoints.desktop) return 'desktop';
        return 'large';
    }

    /**
     * Emit current state to synchronize new subscribers
     */
    emitCurrentState() {
        const isMobile = window.innerWidth <= this.breakpoints.mobile;
        
        eventBus.emit(EVENTS.RESIZE, {
            width: this.state.dimensions.width,
            height: this.state.dimensions.height,
            isMobile: isMobile
        });

        eventBus.emit(EVENTS.VIEW_CHANGE, {
            visibleViews: this.state.visibleViews,
            activeTab: this.state.activeTab
        });
    }

    /**
     * Check if a specific view should be visible
     */
    isViewVisible(view) {
        return this.state.visibleViews.includes(view);
    }

    /**
     * Get current layout state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Update breakpoints configuration
     */
    setBreakpoints(breakpoints) {
        this.breakpoints = { ...this.breakpoints, ...breakpoints };
        this.handleResize(); // Recalculate state with new breakpoints
    }

    /**
     * Utility method to debounce function calls
     */
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
}

// Export singleton instance
export const layoutService = new LayoutService();

// Export events for consumers
export { EVENTS as LAYOUT_EVENTS }; 