/**
 * Simple client-side router for SPA navigation
 * Supports static routes and browser history
 */
class Router {
    constructor() {
        this.routes = new Map();
        this.currentRoute = null;
        this.currentHandler = null;
        this.notFoundHandler = null;
        
        // Bind methods
        this.handleRoute = this.handleRoute.bind(this);
        this.navigate = this.navigate.bind(this);
        
        // Listen for browser back/forward
        window.addEventListener('popstate', async (e) => {
            await this.handleRoute(window.location.pathname);
        });
    }
    
    /**
     * Register a route
     * @param {string} path - Route path (e.g., '/', '/cultexecs')
     * @param {Function} handler - Route handler function
     */
    on(path, handler) {
        this.routes.set(path, handler);
    }
    
    /**
     * Register a 404 handler
     * @param {Function} handler - Handler for unmatched routes
     */
    notFound(handler) {
        this.notFoundHandler = handler;
    }
    
    /**
     * Navigate to a route
     * @param {string} path - Route path
     * @param {boolean} replace - Whether to replace history entry
     */
    async navigate(path, replace = false) {
        if (path === window.location.pathname) {
            return; // Already on this route
        }
        
        if (replace) {
            window.history.replaceState({ path }, '', path);
        } else {
            window.history.pushState({ path }, '', path);
        }
        
        await this.handleRoute(path);
    }
    
    /**
     * Handle route change
     * @param {string} path - Route path
     */
    async handleRoute(path) {
        // Clean up current handler if it exists
        if (this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
            this.currentHandler.cleanup();
        }
        
        // Find matching route
        const handler = this.routes.get(path);
        
        if (handler) {
            this.currentRoute = path;
            // Call handler and store the result (which may include cleanup function)
            // Handle both sync and async handlers
            const result = await Promise.resolve(handler());
            this.currentHandler = result || null;
        } else if (this.notFoundHandler) {
            this.currentRoute = null;
            this.currentHandler = null;
            this.notFoundHandler(path);
        } else {
            console.warn(`No route handler for: ${path}`);
        }
    }
    
    /**
     * Start the router
     */
    async start() {
        // Handle initial route
        await this.handleRoute(window.location.pathname);
    }
    
    /**
     * Get current route
     */
    getCurrentRoute() {
        return this.currentRoute || window.location.pathname;
    }
}

export default Router;

