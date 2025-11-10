/**
 * Utility for dynamically loading and unloading stylesheets
 */
class StylesheetLoader {
    constructor() {
        this.loadedSheets = new Map();
    }
    
    /**
     * Load a stylesheet
     * @param {string} href - Path to stylesheet
     * @param {string} id - Unique identifier for the stylesheet
     */
    load(href, id) {
        // Check if already loaded
        if (this.loadedSheets.has(id)) {
            console.log(`[StylesheetLoader] Stylesheet ${id} already loaded`);
            return;
        }
        
        // Check if link already exists in DOM
        const existingLink = document.querySelector(`link[data-stylesheet-id="${id}"]`);
        if (existingLink) {
            console.log(`[StylesheetLoader] Stylesheet ${id} already exists in DOM`);
            this.loadedSheets.set(id, existingLink);
            return;
        }
        
        // Ensure href is an absolute path (starts with /)
        // This prevents relative path resolution issues when the page is at a deep route
        let absoluteHref = href;
        if (!href.startsWith('/') && !href.startsWith('http://') && !href.startsWith('https://')) {
            absoluteHref = '/' + href;
        }
        
        // Create and append link element
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = absoluteHref;
        link.setAttribute('data-stylesheet-id', id);
        
        // Add error handling
        link.onerror = () => {
            console.error(`[StylesheetLoader] Failed to load stylesheet: ${absoluteHref} (original: ${href})`);
        };
        
        link.onload = () => {
            console.log(`[StylesheetLoader] Successfully loaded stylesheet: ${absoluteHref}`);
        };
        
        document.head.appendChild(link);
        console.log(`[StylesheetLoader] Loading stylesheet: ${absoluteHref} (original: ${href}) with id: ${id}`);
        
        this.loadedSheets.set(id, link);
    }
    
    /**
     * Unload a stylesheet
     * @param {string} id - Unique identifier for the stylesheet
     */
    unload(id) {
        const link = this.loadedSheets.get(id);
        if (link && link.parentNode) {
            link.parentNode.removeChild(link);
            this.loadedSheets.delete(id);
        }
    }
    
    /**
     * Unload all stylesheets
     */
    unloadAll() {
        for (const [id] of this.loadedSheets) {
            this.unload(id);
        }
    }
}

export default new StylesheetLoader();

