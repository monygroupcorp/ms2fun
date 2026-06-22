/**
 * Utility for dynamically loading and unloading stylesheets
 *
 * Supports layered CSS loading:
 * - global / core: never unload
 * - project:name: unload when leaving project
 * - edition:name: unload when leaving edition
 * - route:name: unload when leaving route
 */
class StylesheetLoader {
    constructor() {
        this.loadedSheets = new Map();
    }

    /**
     * Parse layer from stylesheet ID
     * @param {string} id - Stylesheet ID (e.g., 'route:home', 'project:cultexecs')
     * @returns {{ layer: string, name: string }}
     */
    parseLayer(id) {
        if (!id) return { layer: 'unknown', name: 'unknown' };

        const parts = id.split(':');
        if (parts.length === 1) {
            // No layer prefix, treat as global/core
            return { layer: parts[0], name: parts[0] };
        }

        return { layer: parts[0], name: parts.slice(1).join(':') };
    }

    /**
     * Load a stylesheet
     * @param {string} href - Path to stylesheet
     * @param {string} id - Unique identifier for the stylesheet (e.g., 'route:home', 'project:cultexecs')
     * @returns {Promise<void>}
     */
    async load(href, id = 'unknown') {
        // Check if already loaded
        if (this.loadedSheets.has(id)) {
            return Promise.resolve();
        }

        // Check if link already exists in DOM
        const existingLink = document.querySelector(`link[data-stylesheet-id="${id}"]`);
        if (existingLink) {
            this.loadedSheets.set(id, existingLink);
            return Promise.resolve();
        }

        // Ensure href is an absolute path (starts with /)
        // This prevents relative path resolution issues when the page is at a deep route
        let absoluteHref = href;
        if (!href.startsWith('/') && !href.startsWith('http://') && !href.startsWith('https://')) {
            absoluteHref = '/' + href;
        }

        // Parse layer info
        const { layer, name } = this.parseLayer(id);

        return new Promise((resolve, reject) => {
            // Create and append link element
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = absoluteHref;
            link.setAttribute('data-stylesheet-id', id);
            link.setAttribute('data-stylesheet-layer', layer);
            link.setAttribute('data-stylesheet-name', name);

            // Add load/error handling
            link.onload = () => {
                console.log(`[StylesheetLoader] ✓ Loaded ${layer}:${name} (${absoluteHref})`);
                resolve();
            };

            link.onerror = () => {
                console.error(`[StylesheetLoader] ✗ Failed to load stylesheet: ${absoluteHref}`);
                reject(new Error(`Failed to load stylesheet: ${absoluteHref}`));
            };

            document.head.appendChild(link);
            this.loadedSheets.set(id, link);
        });
    }
    
    /**
     * Unload a specific stylesheet by ID
     * @param {string} id - Unique identifier for the stylesheet
     */
    unload(id) {
        const link = this.loadedSheets.get(id);
        if (link && link.parentNode) {
            const { layer, name } = this.parseLayer(id);
            console.log(`[StylesheetLoader] ✗ Unloaded ${layer}:${name}`);
            link.parentNode.removeChild(link);
            this.loadedSheets.delete(id);
        }
    }

    /**
     * Unload all stylesheets matching a layer prefix
     * @param {string} layerPrefix - Layer to unload (e.g., 'route', 'project', 'edition')
     */
    unloadLayer(layerPrefix) {
        const idsToUnload = [];

        // Find all IDs matching this layer
        for (const [id] of this.loadedSheets) {
            const { layer } = this.parseLayer(id);
            if (layer === layerPrefix) {
                idsToUnload.push(id);
            }
        }

        // Unload them
        console.log(`[StylesheetLoader] Unloading layer '${layerPrefix}': ${idsToUnload.length} sheet(s)`);
        idsToUnload.forEach(id => this.unload(id));
    }

    /**
     * Unload all stylesheets (except global/core if specified)
     * @param {boolean} preserveGlobalCore - If true, keep global and core layers
     */
    unloadAll(preserveGlobalCore = false) {
        if (preserveGlobalCore) {
            // Unload only route, project, edition layers
            this.unloadLayer('route');
            this.unloadLayer('project');
            this.unloadLayer('edition');
        } else {
            // Unload everything
            const allIds = Array.from(this.loadedSheets.keys());
            allIds.forEach(id => this.unload(id));
        }
    }

    /**
     * Get all loaded stylesheets for debugging
     * @returns {Array<{id: string, layer: string, name: string, href: string}>}
     */
    getLoadedSheets() {
        const sheets = [];
        for (const [id, link] of this.loadedSheets) {
            const { layer, name } = this.parseLayer(id);
            sheets.push({
                id,
                layer,
                name,
                href: link.href
            });
        }
        return sheets;
    }
}

export default new StylesheetLoader();

