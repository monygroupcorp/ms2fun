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
        console.error('[generateProjectURL] No instance name available - cannot generate URL for address:', instance.address);
        return null;
    }

    const chainIdStr = String(chainId || 1);
    const instanceSlug = slugify(instanceName);

    if (piece) {
        const pieceTitle = piece.title || piece.displayTitle;
        if (pieceTitle) {
            const pieceSlug = slugify(pieceTitle);
            // Edition format: /:chainId/:instanceName/:pieceTitle
            return `/${chainIdStr}/${instanceSlug}/${pieceSlug}`;
        }
    }

    // Project format: /:chainId/:instanceName
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

/**
 * Navigate to a project by address, looking up the proper URL format
 * @param {string} instanceAddress - The instance/project contract address
 * @param {number} [chainId] - Chain ID (defaults to detected network or 1)
 * @returns {Promise<void>}
 */
export async function navigateToProject(instanceAddress, chainId = null) {
    if (!instanceAddress) {
        console.warn('[navigateToProject] No instance address provided');
        return;
    }

    try {
        // Get chain ID if not provided
        if (!chainId) {
            const { detectNetwork } = await import('../config/network.js');
            const network = detectNetwork();
            chainId = network.chainId || 1;
        }

        // Try to look up project info for modern URL
        const { default: serviceFactory } = await import('../services/ServiceFactory.js');
        const queryService = serviceFactory.getQueryService();

        if (queryService) {
            const projectCard = await queryService.getProjectCard(instanceAddress);

            if (projectCard && projectCard.name) {
                const projectURL = generateProjectURL(
                    null,
                    { name: projectCard.name, address: instanceAddress },
                    null,
                    chainId
                );

                if (projectURL && !projectURL.startsWith('/project/')) {
                    console.log('[navigateToProject] Using modern URL:', projectURL);
                    if (window.router) {
                        window.router.navigate(projectURL);
                    } else {
                        window.location.href = projectURL;
                    }
                    return;
                }
            }
        }
    } catch (error) {
        console.warn('[navigateToProject] Error looking up project info:', error);
    }

    // No fallback - deprecated /project/ routes have been removed
    console.error('[navigateToProject] Failed to generate URL for address:', instanceAddress);
    console.error('[navigateToProject] Project name not found in registry. Navigating to discovery.');
    if (window.router) {
        window.router.navigate('/');
    } else {
        window.location.href = '/';
    }
}

