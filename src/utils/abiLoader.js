/**
 * ABI Loader Utility
 *
 * Handles loading and caching of contract ABIs.
 * Supports dynamic loading from /contracts/abi/ directory.
 */

const abiCache = new Map();

/**
 * Load ABI from file with caching
 * @param {string} abiName - Name of the ABI file (without .json extension)
 * @returns {Promise<Array>} Contract ABI
 * @throws {Error} If ABI file cannot be loaded
 */
export async function loadABI(abiName) {
    // Check cache first
    if (abiCache.has(abiName)) {
        return abiCache.get(abiName);
    }

    try {
        const response = await fetch(`/contracts/abi/${abiName}.json`);

        if (!response.ok) {
            throw new Error(`Failed to load ABI: ${abiName} (HTTP ${response.status})`);
        }

        const abi = await response.json();

        // Validate ABI format
        if (!Array.isArray(abi)) {
            throw new Error(`Invalid ABI format for ${abiName}: expected array, got ${typeof abi}`);
        }

        // Cache the ABI
        abiCache.set(abiName, abi);

        return abi;
    } catch (error) {
        // Re-throw with context
        if (error.message.includes('Failed to fetch')) {
            throw new Error(`ABI file not found: ${abiName}.json (ensure file exists at /contracts/abi/)`);
        }
        throw error;
    }
}

/**
 * Preload multiple ABIs
 * @param {string[]} abiNames - Array of ABI names to preload
 * @returns {Promise<void>}
 */
export async function preloadABIs(abiNames) {
    await Promise.all(abiNames.map(name => loadABI(name)));
}

/**
 * Clear ABI cache
 * Useful for testing or forcing reload
 */
export function clearABICache() {
    abiCache.clear();
}

/**
 * Get cache size
 * @returns {number} Number of cached ABIs
 */
export function getCacheSize() {
    return abiCache.size;
}

/**
 * Check if ABI is cached
 * @param {string} abiName - ABI name to check
 * @returns {boolean} True if cached
 */
export function isABICached(abiName) {
    return abiCache.has(abiName);
}

export default {
    loadABI,
    preloadABIs,
    clearABICache,
    getCacheSize,
    isABICached
};
