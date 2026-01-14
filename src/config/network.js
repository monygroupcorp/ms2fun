/**
 * Network Detection and Configuration
 *
 * Detects the current environment (local, mainnet, or mock) and returns
 * appropriate configuration for contract addresses, RPC URLs, and ABI paths.
 */

export function detectNetwork() {
  const hostname = window.location.hostname;
  const searchParams = new URLSearchParams(window.location.search);

  // Manual override via ?network=mock
  if (searchParams.get('network') === 'mock') {
    return {
      mode: 'mock',
      rpcUrl: null,
      chainId: null,
      contracts: null,
      abiPath: null
    };
  }

  // Local development (Anvil fork)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return {
      mode: 'local',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 1337,
      contracts: '/src/config/contracts.local.json',
      abiPath: 'contracts/out' // Read from Forge artifacts
    };
  }

  // Production mainnet
  return {
    mode: 'mainnet',
    rpcUrl: 'https://ethereum.publicnode.com',
    chainId: 1,
    contracts: '/src/config/contracts.mainnet.json',
    abiPath: 'contracts/abi' // Exported ABIs
  };
}

/**
 * Get network configuration
 * @returns {Object} Network configuration object
 */
export function getNetworkConfig() {
  return detectNetwork();
}

/**
 * Check if running in local development mode
 * @returns {boolean}
 */
export function isLocalMode() {
  return detectNetwork().mode === 'local';
}

/**
 * Check if running in mock mode
 * @returns {boolean}
 */
export function isMockMode() {
  return detectNetwork().mode === 'mock';
}

/**
 * Check if running on mainnet
 * @returns {boolean}
 */
export function isMainnet() {
  return detectNetwork().mode === 'mainnet';
}

/**
 * Get the expected chain ID for the current environment
 * @returns {number|null}
 */
export function getExpectedChainId() {
  const network = detectNetwork();
  return network.chainId;
}

/**
 * Get the RPC URL for the current environment
 * @returns {string|null}
 */
export function getRpcUrl() {
  const network = detectNetwork();
  return network.rpcUrl;
}
