/**
 * Navigation utility functions
 * 
 * Provides helpers for generating and parsing hierarchical navigation URLs
 */

/**
 * Convert text to URL-safe slug
 * @param {string} text - Text to slugify
 * @returns {string} URL-safe slug
 */
export function slugify(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Generate project URL from factory and instance data
 * @param {object} factory - Factory object (with title or displayTitle)
 * @param {object} instance - Instance object (with name or displayName)
 * @param {object} [piece] - Optional piece object (with title or displayTitle)
 * @param {string|number} [chainId] - Chain ID (defaults to 1 for Ethereum mainnet)
 * @returns {string|null} URL path or null if data insufficient
 */
export function generateProjectURL(factory, instance, piece = null, chainId = 1) {
    if (!instance) {
        return null;
    }

    const instanceName = instance.name || instance.displayName;

    if (!instanceName) {
        // Fallback to address-based if name not available
        return `/project/${instance.address}`;
    }

    const chainIdStr = String(chainId || 1);
    const instanceSlug = slugify(instanceName);

    if (piece) {
        const pieceTitle = piece.title || piece.displayTitle;
        if (pieceTitle) {
            const pieceSlug = slugify(pieceTitle);
            // If factory is provided, use 4-part URL, otherwise 3-part
            if (factory && (factory.title || factory.displayTitle)) {
                const factorySlug = slugify(factory.title || factory.displayTitle);
                return `/${chainIdStr}/${factorySlug}/${instanceSlug}/${pieceSlug}`;
            }
            // Simple 3-part format for piece: /:chainId/:instanceName/:pieceTitle
            return `/${chainIdStr}/${instanceSlug}/${pieceSlug}`;
        }
    }

    // Simple format: /:chainId/:instanceName
    return `/${chainIdStr}/${instanceSlug}`;
}

/**
 * Parse URL path to extract chain ID, factory, instance, and piece titles
 * @param {string} path - URL path
 * @returns {object|null} Object with chainId, factoryTitle, instanceName, pieceTitle or null
 */
export function parseProjectURL(path) {
    if (!path || path === '/') {
        return null;
    }

    const parts = path.split('/').filter(p => p);
    
    // Need at least chainId + factoryTitle + instanceName (3 parts minimum)
    if (parts.length < 3) {
        return null;
    }

    // First part is chain ID
    const chainId = parts[0];
    const factoryTitle = parts[1];
    const instanceName = parts[2];
    const pieceTitle = parts.length >= 4 ? parts[3] : null;

    const result = {
        chainId: chainId,
        factoryTitle: factoryTitle,
        instanceName: instanceName,
        pieceTitle: pieceTitle
    };

    return result;
}

