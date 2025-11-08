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
            return;
        }
        
        // Check if link already exists in DOM
        const existingLink = document.querySelector(`link[data-stylesheet-id="${id}"]`);
        if (existingLink) {
            this.loadedSheets.set(id, existingLink);
            return;
        }
        
        // Create and append link element
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute('data-stylesheet-id', id);
        document.head.appendChild(link);
        
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

