/**
 * EnvironmentDetector - Determines application mode based on environment and contract deployment
 *
 * Handles the trilemma of 4 application states:
 * 1. LOCAL_BLOCKCHAIN - Dev + Anvil running + contracts deployed
 * 2. PLACEHOLDER_MOCK - Dev + No Anvil (placeholder data)
 * 3. PRODUCTION_DEPLOYED - Production + Contracts deployed
 * 4. COMING_SOON - Production + No contracts (minimal content)
 */

export class EnvironmentDetector {
    constructor() {
        this.cachedMode = null;
        this.cachedConfig = null;
    }

    /**
     * Detect the current environment mode
     * @returns {Promise<{mode: string, config: object|null}>}
     */
    async detect() {
        // Return cached result if available
        if (this.cachedMode) {
            return { mode: this.cachedMode, config: this.cachedConfig };
        }

        // Allow forcing a specific mode via env var (useful for previewing production states locally)
        const forcedMode = import.meta.env.VITE_FORCE_MODE;
        const validModes = ['LOCAL_BLOCKCHAIN', 'PLACEHOLDER_MOCK', 'PRODUCTION_DEPLOYED', 'COMING_SOON', 'MAINNET_DEV'];
        if (forcedMode && validModes.includes(forcedMode)) {
            // Load appropriate config instead of returning null
            const useMainnetConfig = ['PRODUCTION_DEPLOYED', 'MAINNET_DEV'].includes(forcedMode);
            const useLocalConfig = forcedMode === 'LOCAL_BLOCKCHAIN';
            let configData = null;

            if (useMainnetConfig || useLocalConfig) {
                const configPath = useMainnetConfig
                    ? '/src/config/contracts.mainnet.json'
                    : '/src/config/contracts.local.json';
                // For forced modes, return raw config even if MasterRegistryV1 isn't deployed.
                // Standalone contracts (e.g. CULT EXEC) don't need the registry.
                try {
                    const response = await fetch(configPath);
                    if (response.ok) configData = await response.json();
                } catch (e) {
                    console.warn(`[EnvironmentDetector] Failed to load config from ${configPath}:`, e);
                }
            }

            this.cachedMode = forcedMode;
            this.cachedConfig = configData;
            console.log(`[EnvironmentDetector] Forced mode: ${forcedMode}`, configData ? '(with config)' : '(no config)');
            return { mode: forcedMode, config: configData };
        }

        const isDev = import.meta.env.DEV;
        const hasAnvil = await this.checkLocalRPC();
        const config = await this.loadContractConfig();

        let mode;
        let configData = null;

        if (isDev && hasAnvil && config.hasContracts) {
            mode = 'LOCAL_BLOCKCHAIN';
            configData = config.data;
        } else if (isDev && !hasAnvil) {
            mode = 'PLACEHOLDER_MOCK';
            configData = null;
        } else if (!isDev && config.hasContracts) {
            mode = 'PRODUCTION_DEPLOYED';
            configData = config.data;
        } else {
            mode = 'COMING_SOON';
            configData = null;
        }

        // Cache the result
        this.cachedMode = mode;
        this.cachedConfig = configData;

        console.log(`[EnvironmentDetector] Detected mode: ${mode}`);

        return { mode, config: configData };
    }

    /**
     * Check if local Anvil RPC is available
     * @returns {Promise<boolean>}
     */
    async checkLocalRPC() {
        try {
            const response = await fetch('http://localhost:8545', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_chainId',
                    id: 1
                }),
                signal: AbortSignal.timeout(1000) // 1 second timeout
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return !!data.result;
        } catch (error) {
            return false;
        }
    }

    /**
     * Load contract configuration
     * @returns {Promise<{hasContracts: boolean, data: object|null}>}
     */
    async loadContractConfig(overridePath = null) {
        const isDev = import.meta.env.DEV;
        const configPath = overridePath || (isDev
            ? '/src/config/contracts.local.json'
            : '/src/config/contracts.mainnet.json');

        try {
            const response = await fetch(configPath);
            if (!response.ok) {
                return { hasContracts: false, data: null };
            }

            const config = await response.json();

            // Check if contracts are actually deployed (MasterRegistryV1 address exists and is not zero)
            const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
            const registryAddr = config.contracts && config.contracts.MasterRegistryV1;
            const hasContracts = !!(registryAddr && registryAddr !== ZERO_ADDRESS);

            return {
                hasContracts,
                data: hasContracts ? config : null
            };
        } catch (error) {
            return { hasContracts: false, data: null };
        }
    }

    /**
     * Clear cached detection result (useful for testing)
     */
    clearCache() {
        this.cachedMode = null;
        this.cachedConfig = null;
    }
}

export default EnvironmentDetector;
