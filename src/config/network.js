/**
 * Network Detection and Configuration
 *
 * Detects the current environment (local, mainnet, or mock) and returns
 * appropriate configuration for contract addresses, RPC URLs, and ABI paths.
 */

// Cache RPC availability check result
let rpcAvailable = null;
let rpcCheckPromise = null;

/**
 * Check if local RPC is available AND has our contracts deployed
 * @param {string} contractAddress - Address to check for code
 * @returns {Promise<boolean>}
 */
export async function checkRpcAvailable(contractAddress = null) {
    if (rpcAvailable !== null) return rpcAvailable;
    if (rpcCheckPromise) return rpcCheckPromise;

    rpcCheckPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);

            // First check if RPC responds
            const chainResponse = await fetch('http://127.0.0.1:8545', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
                signal: controller.signal
            });

            clearTimeout(timeout);
            const chainData = await chainResponse.json();

            if (!chainData.result) {
                console.log('[Network] RPC not responding properly');
                rpcAvailable = false;
                return false;
            }

            // If we have a contract address, verify it has code
            if (contractAddress) {
                const codeResponse = await fetch('http://127.0.0.1:8545', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_getCode',
                        params: [contractAddress, 'latest'],
                        id: 2
                    })
                });

                const codeData = await codeResponse.json();
                const hasCode = codeData.result && codeData.result !== '0x' && codeData.result.length > 2;

                if (!hasCode) {
                    console.log('[Network] RPC available but contract not deployed at', contractAddress);
                    rpcAvailable = false;
                    return false;
                }
            }

            console.log('[Network] RPC available with valid contracts');
            rpcAvailable = true;
            return true;
        } catch (error) {
            console.log('[Network] RPC unavailable:', error.message);
            rpcAvailable = false;
            return false;
        }
    })();

    return rpcCheckPromise;
}

/**
 * Reset RPC availability cache (useful for retrying)
 */
export function resetRpcCheck() {
    rpcAvailable = null;
    rpcCheckPromise = null;
}

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
