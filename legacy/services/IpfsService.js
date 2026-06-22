/**
 * IPFS Service
 * 
 * Light client for IPFS resolution with gateway rotation and fallback.
 * Handles both direct IPFS URIs and metadata fetching.
 * 
 * No secrets, no backend - pure client-side IPFS gateway resolution.
 */

/**
 * Public IPFS gateways (in order of preference)
 * These are public gateways that don't require authentication
 */
const IPFS_GATEWAYS = [
    'https://w3s.link/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/'
];

/**
 * Get custom IPFS gateway from localStorage (user preference)
 * @returns {string|null} Custom gateway base URL or null
 */
function getCustomGateway() {
    try {
        const custom = localStorage.getItem('customIpfsGatewayBaseUrl');
        if (custom && typeof custom === 'string' && custom.trim()) {
            const trimmed = custom.trim();
            // Ensure it ends with /ipfs/ or just /
            if (trimmed.endsWith('/ipfs/')) {
                return trimmed;
            } else if (trimmed.endsWith('/')) {
                return trimmed + 'ipfs/';
            } else {
                return trimmed + '/ipfs/';
            }
        }
    } catch (error) {
        console.warn('[IpfsService] Failed to read custom gateway from localStorage:', error);
    }
    return null;
}

/**
 * Get all available gateways (custom first, then public list)
 * @returns {string[]} Array of gateway base URLs
 */
function getAllGateways() {
    const custom = getCustomGateway();
    return custom ? [custom, ...IPFS_GATEWAYS] : IPFS_GATEWAYS;
}

/**
 * Check if a URI is an IPFS URI
 * @param {string} uri - URI to check
 * @returns {boolean} True if URI is IPFS
 */
export function isIpfsUri(uri) {
    if (!uri || typeof uri !== 'string') {
        return false;
    }
    return uri.toLowerCase().startsWith('ipfs://');
}

/**
 * Normalize IPFS path by removing ipfs:// prefix
 * Handles both ipfs://CID and ipfs://CID/path formats
 * @param {string} ipfsUri - IPFS URI (e.g., ipfs://Qm... or ipfs://Qm.../path)
 * @returns {string} Normalized path (e.g., Qm... or Qm.../path)
 */
export function normalizeIpfsPath(ipfsUri) {
    if (!isIpfsUri(ipfsUri)) {
        return ipfsUri;
    }
    
    // Remove ipfs:// prefix
    const path = ipfsUri.substring(7); // 'ipfs://' is 7 characters
    
    // Remove leading slash if present
    return path.startsWith('/') ? path.substring(1) : path;
}

/**
 * Resolve IPFS URI to HTTP URL using a specific gateway
 * @param {string} ipfsUri - IPFS URI (e.g., ipfs://Qm...)
 * @param {number} gatewayIndex - Index of gateway to use (0-based)
 * @returns {string|null} HTTP URL or null if invalid
 */
export function resolveIpfsToHttp(ipfsUri, gatewayIndex = 0) {
    if (!isIpfsUri(ipfsUri)) {
        return ipfsUri; // Return as-is if not IPFS
    }
    
    const gateways = getAllGateways();
    if (gatewayIndex < 0 || gatewayIndex >= gateways.length) {
        return null;
    }
    
    const normalizedPath = normalizeIpfsPath(ipfsUri);
    const gateway = gateways[gatewayIndex];
    
    return gateway + normalizedPath;
}

/**
 * Fetch JSON from IPFS or HTTP URL with gateway rotation
 * @param {string} urlOrIpfs - HTTP URL or IPFS URI
 * @param {object} options - Fetch options (timeout, etc.)
 * @returns {Promise<object>} Parsed JSON data
 * @throws {Error} If all gateways fail or JSON is invalid
 */
export async function fetchJsonWithIpfsSupport(urlOrIpfs, options = {}) {
    const { timeout = 10000, ...fetchOptions } = options;
    
    // If it's not an IPFS URI, use regular fetch
    if (!isIpfsUri(urlOrIpfs)) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(urlOrIpfs, {
                ...fetchOptions,
                signal: controller.signal
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const json = await response.json();
            clearTimeout(timeoutId);
            return json;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }
    
    // IPFS URI - try gateways in order
    const gateways = getAllGateways();
    const normalizedPath = normalizeIpfsPath(urlOrIpfs);
    const errors = [];
    
    for (let i = 0; i < gateways.length; i++) {
        const gateway = gateways[i];
        const httpUrl = gateway + normalizedPath;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(httpUrl, {
                ...fetchOptions,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const json = await response.json();
            
            // Success - log which gateway worked (for debugging)
            if (i > 0) {
                console.log(`[IpfsService] Resolved IPFS via gateway ${i + 1}/${gateways.length}: ${gateway}`);
            }
            
            return json;
        } catch (error) {
            clearTimeout(timeoutId);
            
            const errorMsg = error.name === 'AbortError' 
                ? `Timeout after ${timeout}ms`
                : error.message || 'Unknown error';
            
            errors.push(`Gateway ${i + 1} (${gateway}): ${errorMsg}`);
            
            // Continue to next gateway
            continue;
        }
    }
    
    // All gateways failed
    throw new Error(
        `Failed to fetch IPFS content after trying ${gateways.length} gateways:\n` +
        errors.join('\n')
    );
}

/**
 * Test if an image URL can be loaded (for gateway rotation)
 * @param {string} url - HTTP URL to test
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} True if image loads successfully
 */
export function testImageLoad(url, timeout = 5000) {
    return new Promise((resolve) => {
        const img = new Image();
        const timeoutId = setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            resolve(false);
        }, timeout);
        
        img.onload = () => {
            clearTimeout(timeoutId);
            resolve(true);
        };
        
        img.onerror = () => {
            clearTimeout(timeoutId);
            resolve(false);
        };
        
        img.src = url;
    });
}

/**
 * Get all available gateways (for UI display or debugging)
 * @returns {string[]} Array of gateway base URLs
 */
export function getAvailableGateways() {
    return getAllGateways();
}

/**
 * Set custom IPFS gateway (user preference)
 * @param {string} gatewayBaseUrl - Base URL of custom gateway (e.g., 'https://mygateway.com/ipfs/')
 */
export function setCustomGateway(gatewayBaseUrl) {
    try {
        if (gatewayBaseUrl) {
            localStorage.setItem('customIpfsGatewayBaseUrl', gatewayBaseUrl);
        } else {
            localStorage.removeItem('customIpfsGatewayBaseUrl');
        }
    } catch (error) {
        console.warn('[IpfsService] Failed to save custom gateway to localStorage:', error);
    }
}

