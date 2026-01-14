/**
 * Contract Configuration Loader
 *
 * Loads contract addresses from network-specific configuration files.
 * Supports local development (Anvil), mainnet, and fallback to mock addresses.
 */

import { detectNetwork } from './network.js';

// Cache for loaded configurations
let configCache = null;
let lastNetworkMode = null;

/**
 * Load contract configuration for current network
 * Automatically detects network and loads appropriate config file
 *
 * @returns {Promise<Object>} Contract configuration object
 * @throws {Error} If config cannot be loaded
 */
export async function loadContractConfig() {
    const network = detectNetwork();

    // Check if we need to reload (network changed or no cache)
    if (configCache && lastNetworkMode === network.mode) {
        return configCache;
    }

    // Mock mode - return null, services should handle with mock data
    if (network.mode === 'mock' || !network.contracts) {
        configCache = null;
        lastNetworkMode = network.mode;
        return null;
    }

    try {
        // Load config file based on network
        const response = await fetch(network.contracts);

        if (!response.ok) {
            throw new Error(`Failed to load contract config: HTTP ${response.status}`);
        }

        const config = await response.json();

        // Validate config structure
        if (!config.contracts) {
            throw new Error('Invalid config: missing "contracts" field');
        }

        // Cache the config
        configCache = config;
        lastNetworkMode = network.mode;

        console.log(`Contract config loaded for ${network.mode} mode:`, config);

        return config;
    } catch (error) {
        console.error('Failed to load contract config:', error);

        // In local mode, this might mean contracts haven't been deployed yet
        if (network.mode === 'local') {
            console.warn('Local contracts not deployed yet. Run: npm run chain:start');
        }

        throw new Error(`Contract config unavailable: ${error.message}`);
    }
}

/**
 * Get address for a specific contract
 *
 * @param {string} contractName - Name of contract (e.g., 'MasterRegistryV1')
 * @returns {Promise<string>} Contract address
 * @throws {Error} If config not loaded or contract not found
 */
export async function getContractAddress(contractName) {
    const config = await loadContractConfig();

    if (!config) {
        throw new Error('Contract config not available (mock mode or not loaded)');
    }

    const address = config.contracts[contractName];

    if (!address) {
        throw new Error(`Contract not found in config: ${contractName}`);
    }

    // Validate it's not a zero address (placeholder)
    if (address === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Contract ${contractName} has zero address (not deployed)`);
    }

    return address;
}

/**
 * Get all contract addresses
 *
 * @returns {Promise<Object>} Object mapping contract names to addresses
 */
export async function getAllContractAddresses() {
    const config = await loadContractConfig();

    if (!config) {
        return {};
    }

    return config.contracts;
}

/**
 * Check if a contract is deployed
 *
 * @param {string} contractName - Name of contract
 * @returns {Promise<boolean>} True if contract is deployed
 */
export async function isContractDeployed(contractName) {
    try {
        const address = await getContractAddress(contractName);
        return address && address !== '0x0000000000000000000000000000000000000000';
    } catch {
        return false;
    }
}

/**
 * Get network configuration
 *
 * @returns {Object} Network configuration (mode, chainId, etc.)
 */
export function getNetworkInfo() {
    return detectNetwork();
}

/**
 * Clear cached configuration
 * Useful for forcing reload or testing
 */
export function clearConfigCache() {
    configCache = null;
    lastNetworkMode = null;
}

/**
 * Get test accounts (local development only)
 *
 * @returns {Promise<Object>} Test accounts with addresses
 */
export async function getTestAccounts() {
    const config = await loadContractConfig();

    if (!config || !config.testAccounts) {
        return {};
    }

    return config.testAccounts;
}

/**
 * Check if running in local development mode
 *
 * @returns {boolean} True if local mode
 */
export function isLocalMode() {
    return detectNetwork().mode === 'local';
}

/**
 * Check if running on mainnet
 *
 * @returns {boolean} True if mainnet
 */
export function isMainnet() {
    return detectNetwork().mode === 'mainnet';
}

/**
 * Check if running in mock mode
 *
 * @returns {boolean} True if mock mode
 */
export function isMockMode() {
    return detectNetwork().mode === 'mock';
}

export default {
    loadContractConfig,
    getContractAddress,
    getAllContractAddresses,
    isContractDeployed,
    getNetworkInfo,
    clearConfigCache,
    getTestAccounts,
    isLocalMode,
    isMainnet,
    isMockMode
};
