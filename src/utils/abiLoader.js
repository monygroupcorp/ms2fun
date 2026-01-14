/**
 * ABI Loader Utility
 *
 * Handles loading and caching of contract ABIs.
 * Supports hybrid loading: Forge artifacts in local dev, exported ABIs in production.
 */

import { detectNetwork } from '../config/network.js';

const abiCache = new Map();

/**
 * Load ABI from file with caching
 * Automatically detects environment and loads from appropriate location:
 * - Local dev: contracts/out/ (Forge build artifacts)
 * - Production: contracts/abi/ (exported ABIs)
 *
 * @param {string} abiName - Name of the ABI file (without .json extension)
 * @returns {Promise<Array>} Contract ABI
 * @throws {Error} If ABI file cannot be loaded
 */
export async function loadABI(abiName) {
    const network = detectNetwork();

    // Check cache first (skip cache in local dev for fresh ABIs)
    const cacheKey = abiName;
    if (network.mode !== 'local' && abiCache.has(cacheKey)) {
        return abiCache.get(cacheKey);
    }

    try {
        let path;
        let abi;

        if (network.mode === 'local') {
            // Local development: Read from Forge build output
            // Path format: /contracts/out/ContractName.sol/ContractName.json
            // Add cache buster to force fresh ABI load
            const cacheBuster = Date.now();
            path = `/contracts/out/${abiName}.sol/${abiName}.json?v=${cacheBuster}`;

            const response = await fetch(path, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            if (!response.ok) {
                throw new Error(`Failed to load ABI: ${abiName} (HTTP ${response.status})`);
            }

            const artifact = await response.json();
            // Forge artifacts have ABI nested under 'abi' field
            abi = artifact.abi;

            if (!abi) {
                throw new Error(`Invalid Forge artifact for ${abiName}: missing 'abi' field`);
            }
        } else {
            // Production or mock: Read from exported ABI directory
            path = `/contracts/abi/${abiName}.json`;

            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load ABI: ${abiName} (HTTP ${response.status})`);
            }

            abi = await response.json();
        }

        // Validate ABI format
        if (!Array.isArray(abi)) {
            throw new Error(`Invalid ABI format for ${abiName}: expected array, got ${typeof abi}`);
        }

        // Cache the ABI
        abiCache.set(cacheKey, abi);

        return abi;
    } catch (error) {
        // Re-throw with context
        if (error.message.includes('Failed to fetch')) {
            const network = detectNetwork();
            const expectedPath = network.mode === 'local'
                ? `contracts/out/${abiName}.sol/${abiName}.json`
                : `contracts/abi/${abiName}.json`;
            throw new Error(`ABI file not found: ${abiName} (expected at ${expectedPath})`);
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
