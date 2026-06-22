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
            const newPath = window.location.pathname;
            // Skip if already on this route (hash-only changes, etc.)
            if (newPath === this.currentRoute && this.currentHandler) return;

            // Save scroll position of the page we're leaving
            if (this.currentRoute) {
                try {
                    sessionStorage.setItem('scroll:' + this.currentRoute, String(window.scrollY));
                } catch (e) { /* quota exceeded or private mode */ }
            }
            await this.handleRoute(newPath);
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
     * @param {boolean|object} replaceOrOptions - boolean for replace, or { replace, state }
     */
    async navigate(path, replaceOrOptions = false) {
        if (path === window.location.pathname) {
            return; // Already on this route
        }

        // Save scroll position of the page we're leaving
        try {
            sessionStorage.setItem('scroll:' + window.location.pathname, String(window.scrollY));
        } catch (e) { /* quota exceeded or private mode */ }

        let replace = false;
        let extraState = {};
        if (typeof replaceOrOptions === 'object' && replaceOrOptions !== null) {
            replace = replaceOrOptions.replace || false;
            extraState = replaceOrOptions.state || {};
        } else {
            replace = replaceOrOptions;
        }

        const historyState = { path, ...extraState };

        if (replace) {
            window.history.replaceState(historyState, '', path);
        } else {
            window.history.pushState(historyState, '', path);
        }
        
        await this.handleRoute(path);
        
        // Ensure theme toggle exists after navigation
        if (window.themeManager && typeof window.themeManager.ensureToggleExists === 'function') {
            // Small delay to let route handler finish mounting
            setTimeout(() => {
                window.themeManager.ensureToggleExists();
            }, 100);
        }
    }
    
    /**
     * Match a path against a route pattern
     * @param {string} pattern - Route pattern (e.g., '/project/:id')
     * @param {string} path - Actual path to match
     * @returns {object|null} Matched params or null if no match
     * @private
     */
    _matchRoute(pattern, path) {
        // Exact match for static routes
        if (pattern === path) {
            return {};
        }
        
        // Split into parts, filtering empty strings
        const patternParts = pattern.split('/').filter(p => p);
        const pathParts = path.split('/').filter(p => p);
        
        // Must have same number of parts
        if (patternParts.length !== pathParts.length) {
            return null;
        }
        
        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            const pathPart = pathParts[i];
            
            // Check if this is a parameter (starts with :)
            if (patternPart.startsWith(':')) {
                const paramName = patternPart.slice(1);
                // Decode URL component
                try {
                    params[paramName] = decodeURIComponent(pathPart);
                } catch (e) {
                    // If decoding fails, use raw value
                    params[paramName] = pathPart;
                }
            } else if (patternPart !== pathPart) {
                // Static part doesn't match
                return null;
            }
        }
        
        return params;
    }
    
    /**
     * Find matching route handler
     * @param {string} path - Route path
     * @returns {object|null} { handler, params } or null
     * @private
     */
    _findRoute(path) {
        // First check for exact static route match (static routes take precedence)
        if (this.routes.has(path)) {
            return {
                handler: this.routes.get(path),
                params: {}
            };
        }
        
        // Collect all dynamic routes and sort by specificity
        const dynamicRoutes = [];
        for (const [pattern, handler] of this.routes.entries()) {
            // Skip if it's an exact match (already checked above)
            if (pattern === path) {
                continue;
            }
            
            // Check if pattern contains dynamic parameters
            if (pattern.includes(':')) {
                const paramCount = (pattern.match(/:/g) || []).length;
                // Count literal (non-param) parts for better specificity
                const literalCount = pattern.split('/').filter(p => p && !p.startsWith(':')).length;
                dynamicRoutes.push({ pattern, handler, paramCount, literalCount });
            }
        }
        
        // Sort by literal count first (more literals = more specific), then by param count
        // This ensures routes with literal parts (like /create) are matched before fully dynamic routes
        dynamicRoutes.sort((a, b) => {
            if (b.literalCount !== a.literalCount) {
                return b.literalCount - a.literalCount;
            }
            return b.paramCount - a.paramCount;
        });
        
        // Try each route in order of specificity
        for (const { pattern, handler } of dynamicRoutes) {
            const params = this._matchRoute(pattern, path);
            if (params !== null) {
                return { handler, params };
            }
        }
        
        return null;
    }
    
    /**
     * Handle route change
     * @param {string} path - Route path
     */
    async handleRoute(path) {
        // Strip query string for route matching (query params stay in window.location.search)
        const pathWithoutQuery = path.split('?')[0];

        // Clean up current handler if it exists
        if (this.currentHandler && typeof this.currentHandler.cleanup === 'function') {
            await this.currentHandler.cleanup();
        }

        // Find matching route
        const match = this._findRoute(pathWithoutQuery);
        
        if (match) {
            this.currentRoute = pathWithoutQuery;
            // Call handler with params and store the result (which may include cleanup function)
            // Handle both sync and async handlers
            const result = await Promise.resolve(match.handler(match.params));
            this.currentHandler = result || null;
            
            // Restore saved scroll position for this path
            try {
                const savedScroll = sessionStorage.getItem('scroll:' + path);
                if (savedScroll !== null) {
                    const y = parseInt(savedScroll, 10);
                    sessionStorage.removeItem('scroll:' + path);
                    // Content loads async, so retry scroll until page is tall enough
                    const tryScroll = (attempts) => {
                        if (attempts <= 0) return;
                        if (document.documentElement.scrollHeight >= y + window.innerHeight * 0.5) {
                            window.scrollTo(0, y);
                        } else {
                            setTimeout(() => tryScroll(attempts - 1), 100);
                        }
                    };
                    // First attempt after a short delay for initial render
                    setTimeout(() => tryScroll(15), 50);
                } else {
                    window.scrollTo(0, 0);
                }
            } catch (e) {
                window.scrollTo(0, 0);
            }

            // Ensure theme toggle exists after route handler completes
            if (window.themeManager && typeof window.themeManager.ensureToggleExists === 'function') {
                setTimeout(() => {
                    window.themeManager.ensureToggleExists();
                }, 150);
            }
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
    
    /**
     * Encode a title for use in URL (slug)
     * @param {string} title - Title to encode
     * @returns {string} URL-safe slug
     */
    _encodeTitle(title) {
        if (!title) return '';
        return title
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
            .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens
    }
    
    /**
     * Decode a URL slug back to title (approximate)
     * @param {string} slug - URL slug
     * @returns {string} Decoded title
     */
    _decodeTitle(slug) {
        if (!slug) return '';
        return slug
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    
    /**
     * Generate URL from chain ID, factory title, instance name, and optional piece title
     * @param {string|number} chainId - Chain ID (e.g., 1 for Ethereum mainnet)
     * @param {string} factoryTitle - Factory title
     * @param {string} instanceName - Instance name
     * @param {string} [pieceTitle] - Optional piece title (for ERC1155)
     * @returns {string} URL path
     */
    generateURL(chainId, factoryTitle, instanceName, pieceTitle = null) {
        const chainIdStr = String(chainId || '1'); // Default to 1 (Ethereum mainnet)
        const factorySlug = this._encodeTitle(factoryTitle);
        const instanceSlug = this._encodeTitle(instanceName);
        
        if (pieceTitle) {
            const pieceSlug = this._encodeTitle(pieceTitle);
            return `/${chainIdStr}/${factorySlug}/${instanceSlug}/${pieceSlug}`;
        }
        
        return `/${chainIdStr}/${factorySlug}/${instanceSlug}`;
    }
}

export default Router;

