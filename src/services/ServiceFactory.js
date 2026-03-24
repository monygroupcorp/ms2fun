/**
 * Service Factory
 *
 * Provides access to mock or real services via feature flag.
 * Singleton pattern ensures consistent service instances.
 */

import { USE_MOCK_SERVICES } from '../config.js';
import MockServiceManager from './mock/MockServiceManager.js';
import ProjectService from './ProjectService.js';
import BlockchainService from './BlockchainService.js';
import createExecVotingService from './ExecVotingService.js';
import { getContractAddress, isMockMode } from '../config/contractConfig.js';
import { eventBus } from '../core/EventBus.js';
import { checkRpcAvailable, detectNetwork } from '../config/network.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Real service implementations
import RealMasterService from './RealMasterService.js';
import RealFactoryService from './RealFactoryService.js';
import RealProjectRegistry from './RealProjectRegistry.js';
import GlobalMessageRegistryAdapter from './contracts/GlobalMessageRegistryAdapter.js';
import UltraAlignmentVaultAdapter from './contracts/UltraAlignmentVaultAdapter.js';
import FeaturedQueueManagerAdapter from './contracts/FeaturedQueueManagerAdapter.js';
import AlignmentRegistryAdapter from './contracts/AlignmentRegistryAdapter.js';
import ProtocolTreasuryAdapter from './contracts/ProtocolTreasuryAdapter.js';
import walletService from './WalletService.js';
import queryService from './QueryService.js';
import projectIndex from './ProjectIndex.js';

/**
 * Service Factory
 * 
 * Provides access to services (mock or real) based on feature flag.
 */
class ServiceFactory {
    constructor() {
        this.useMock = USE_MOCK_SERVICES;
        this.mockManager = null;
        this.projectService = null;
        this.blockchainService = null;
        this.execVotingService = null;
        this.masterService = null;
        this.factoryService = null;
        this.projectRegistryInstance = null;
        this.messageRegistryAdapter = null;
        this.featuredQueueAdapter = null;
        this.grandCentralAdapter = null;
        this.componentRegistryAdapter = null;
        this.alignmentRegistryAdapter = null;
        this.protocolTreasuryAdapter = null;
        this.initialized = false;
        this.initPromise = null;

        if (this.useMock) {
            this.mockManager = new MockServiceManager(true, true);
            this.initialized = true;
        }

        // Listen for contract reload events (local dev only)
        eventBus.on('contracts:reloaded', () => {
            this.clearCache();
        });

        // Listen for chain reset events (Anvil restart detected by ProjectIndex)
        eventBus.on('chain:reset', () => {
            console.log('[ServiceFactory] chain:reset received, clearing service cache');
            this.clearCache();
            // Also reset RPC availability check so next access re-verifies chain state
            import('../config/network.js').then(({ resetRpcCheck }) => resetRpcCheck());
            // Clear contract config cache so addresses are re-fetched after redeploy
            import('../config/contractConfig.js').then(({ clearConfigCache }) => clearConfigCache());
        });
    }

    /**
     * Initialize services with RPC availability check
     * Auto-falls back to mock mode if RPC is unavailable or contracts missing
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const network = detectNetwork();

            // Skip contract checks if already in mock mode
            if (this.useMock) {
                this.initialized = true;
                return;
            }

            // Check contracts for both local and mainnet modes
            if (network.mode === 'local' || network.mode === 'mainnet') {
                let masterAddress = null;
                let contractsAvailable = false;

                // Try to load contract config to get MasterRegistry address
                try {
                    const response = await fetch(network.contracts);
                    if (response.ok) {
                        const config = await response.json();
                        masterAddress = config?.contracts?.MasterRegistryV1;

                        // Check if address is valid (not zero address)
                        const isZeroAddress = !masterAddress ||
                            masterAddress === '0x0000000000000000000000000000000000000000';

                        if (!isZeroAddress) {
                            contractsAvailable = true;
                        }
                    }
                } catch (e) {
                    // Contract config not available
                }

                // For local mode, also verify RPC is available and has code
                if (contractsAvailable && network.mode === 'local') {
                    const rpcAvailable = await checkRpcAvailable(masterAddress);
                    if (!rpcAvailable) {
                        contractsAvailable = false;
                    }
                }

                // Fall back to mock mode if no contracts available
                if (!contractsAvailable) {
                    this.useMock = true;
                    this.mockManager = new MockServiceManager(true, true);
                    eventBus.emit('services:mock-mode', { reason: 'contracts-missing' });
                }
            }

            this.initialized = true;
        })();

        return this.initPromise;
    }

    /**
     * Ensure services are initialized before use
     * @returns {Promise<void>}
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Get a read provider + signer pair.
     * In local mode, reads always use StaticJsonRpcProvider (never MetaMask Web3Provider)
     * to avoid stale block tag errors after Anvil restarts.
     * The signer (from wallet) is still returned for write operations.
     * @param {string} [contextName] - Name for error messages
     * @returns {{ provider: ethers.providers.Provider, signer: ethers.Signer|null }}
     */
    _getReadProvider(contextName = 'adapter') {
        const network = detectNetwork();
        const { provider: walletProvider, signer } = walletService.getProviderAndSigner();

        if (network.mode === 'local' && network.rpcUrl) {
            const readProvider = new ethers.providers.StaticJsonRpcProvider(
                network.rpcUrl,
                { name: 'anvil', chainId: network.chainId, ensAddress: null }
            );
            return { provider: readProvider, signer: signer || null };
        }

        if (walletProvider) {
            return { provider: walletProvider, signer };
        }

        throw new Error(`No provider available for ${contextName}`);
    }

    /**
     * Get master service instance
     * @returns {MockMasterService|RealMasterService} Master service
     */
    getMasterService() {
        // Sync check - if not initialized yet, check current useMock state
        if (this.useMock) {
            if (!this.mockManager) {
                this.mockManager = new MockServiceManager(true, true);
            }
            return this.mockManager.getMasterService();
        } else {
            if (!this.masterService) {
                this.masterService = new RealMasterService();
            }
            return this.masterService;
        }
    }

    /**
     * Get factory service instance
     * @returns {MockFactoryService|RealFactoryService} Factory service
     */
    getFactoryService() {
        if (this.useMock) {
            if (!this.mockManager) {
                this.mockManager = new MockServiceManager(true, true);
            }
            return this.mockManager.getFactoryService();
        } else {
            if (!this.factoryService) {
                this.factoryService = new RealFactoryService();
            }
            return this.factoryService;
        }
    }

    /**
     * Get project registry instance
     * @returns {MockProjectRegistry|RealProjectRegistry} Project registry
     */
    getProjectRegistry() {
        if (this.useMock) {
            if (!this.mockManager) {
                this.mockManager = new MockServiceManager(true, true);
            }
            return this.mockManager.getProjectRegistry();
        } else {
            if (!this.projectRegistryInstance) {
                this.projectRegistryInstance = new RealProjectRegistry();
            }
            return this.projectRegistryInstance;
        }
    }

    /**
     * Ensure mock services are fully initialized (including data seeding)
     * @returns {Promise<void>}
     */
    async ensureMockReady() {
        if (this.useMock && this.mockManager) {
            await this.mockManager.ensureReady();
        }
    }

    /**
     * Get ProjectService instance (singleton)
     * @returns {ProjectService} ProjectService instance
     */
    getProjectService() {
        if (!this.projectService) {
            this.projectService = new ProjectService();
        }
        return this.projectService;
    }

    /**
     * Get QueryService instance (singleton)
     * @returns {QueryService} QueryService instance
     */
    getQueryService() {
        return queryService;
    }

    /**
     * Get ProjectIndex instance (singleton)
     * @returns {ProjectIndex} ProjectIndex instance
     */
    getProjectIndex() {
        return projectIndex;
    }

    /**
     * Get MasterRegistry adapter instance
     * @returns {Promise<MasterRegistryAdapter>} Master registry adapter
     */
    async getMasterRegistryAdapter() {
        const masterService = this.getMasterService();
        return await masterService.getAdapter();
    }

    /**
     * Get FeaturedQueueManager adapter instance (singleton)
     * @returns {Promise<FeaturedQueueManagerAdapter>} Featured queue manager adapter
     */
    async getFeaturedQueueManagerAdapter() {
        if (!this.featuredQueueAdapter) {
            // Get address from config
            const featuredQueueAddress = await getContractAddress('FeaturedQueueManager');

            if (!featuredQueueAddress || featuredQueueAddress === '0x0000000000000000000000000000000000000000') {
                throw new Error('FeaturedQueueManager address not available');
            }

            const { provider, signer } = this._getReadProvider('FeaturedQueueManager');

            this.featuredQueueAdapter = new FeaturedQueueManagerAdapter(
                featuredQueueAddress,
                'FeaturedQueueManager',
                provider,
                signer
            );

            await this.featuredQueueAdapter.initialize();
        }
        return this.featuredQueueAdapter;
    }

    /**
     * Get ShareOffering adapter instance (singleton)
     * @returns {Promise<ShareOfferingAdapter>} ShareOffering adapter
     */
    async getShareOfferingAdapter() {
        if (!this._shareOfferingAdapter) {
            const { default: ShareOfferingAdapter } = await import('./contracts/ShareOfferingAdapter.js');
            const address = await getContractAddress('ShareOffering');
            if (!address || address === '0x0000000000000000000000000000000000000000') {
                throw new Error('ShareOffering address not available');
            }
            const { provider, signer } = this._getReadProvider('ShareOffering');
            this._shareOfferingAdapter = new ShareOfferingAdapter(address, provider, signer);
            await this._shareOfferingAdapter.initialize();
        }
        return this._shareOfferingAdapter;
    }

    async getAlignmentRegistryAdapter() {
        if (this.alignmentRegistryAdapter) return this.alignmentRegistryAdapter;
        const address = await getContractAddress('AlignmentRegistryV1');
        if (!address || address === ethers.constants.AddressZero) {
            throw new Error('AlignmentRegistryV1 address not configured');
        }
        const { provider, signer } = this._getReadProvider('AlignmentRegistryV1');
        this.alignmentRegistryAdapter = new AlignmentRegistryAdapter(address, provider, signer);
        await this.alignmentRegistryAdapter.initialize();
        return this.alignmentRegistryAdapter;
    }

    async getProtocolTreasuryAdapter() {
        if (this.protocolTreasuryAdapter) return this.protocolTreasuryAdapter;
        const address = await getContractAddress('ProtocolTreasuryV1');
        if (!address || address === ethers.constants.AddressZero) {
            return null; // Not deployed — caller handles gracefully
        }
        const { provider, signer } = this._getReadProvider('ProtocolTreasuryV1');
        this.protocolTreasuryAdapter = new ProtocolTreasuryAdapter(address, provider, signer);
        await this.protocolTreasuryAdapter.initialize();
        return this.protocolTreasuryAdapter;
    }

    /**
     * Get ComponentRegistry adapter instance (singleton)
     * @returns {Promise<ComponentRegistryAdapter|null>} ComponentRegistry adapter or null if not configured
     */
    async getComponentRegistryAdapter() {
        if (this.componentRegistryAdapter) return this.componentRegistryAdapter;

        const { default: ComponentRegistryAdapter } = await import('./contracts/ComponentRegistryAdapter.js');

        const address = await getContractAddress('ComponentRegistry');
        if (!address || address === ethers.constants.AddressZero) {
            console.warn('[ServiceFactory] ComponentRegistry not configured');
            return null;
        }

        let provider, signer;
        try {
            ({ provider, signer } = this._getReadProvider('ComponentRegistry'));
        } catch {
            console.warn('[ServiceFactory] No provider available for ComponentRegistry');
            return null;
        }

        this.componentRegistryAdapter = new ComponentRegistryAdapter(address, 'ComponentRegistry', provider, signer);
        await this.componentRegistryAdapter.initialize();
        return this.componentRegistryAdapter;
    }

    /**
     * Get GlobalMessageRegistry adapter instance (singleton)
     * @returns {Promise<GlobalMessageRegistryAdapter>} Message registry adapter
     */
    async getMessageRegistryAdapter() {
        if (!this.messageRegistryAdapter) {
            // Try to get address from local config first (faster, avoids contract call)
            let messageRegistryAddress = null;
            const network = detectNetwork();
            if (network.contracts) {
                try {
                    const response = await fetch(network.contracts);
                    if (response.ok) {
                        const config = await response.json();
                        messageRegistryAddress = config.contracts?.GlobalMessageRegistry || config.GlobalMessageRegistry || null;
                    }
                } catch (e) { /* fall through to contract lookup */ }
            }

            // Fall back to contract lookup
            if (!messageRegistryAddress) {
                try {
                    const masterService = this.getMasterService();
                    let addr = await masterService.getGlobalMessageRegistry();
                    if (Array.isArray(addr)) addr = addr[0];
                    if (addr && typeof addr !== 'string') addr = addr.toString();
                    messageRegistryAddress = addr;
                } catch (e) { /* address stays null */ }
            }

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                throw new Error('GlobalMessageRegistry address not available');
            }

            const { provider, signer } = this._getReadProvider('GlobalMessageRegistry');

            this.messageRegistryAdapter = new GlobalMessageRegistryAdapter(
                messageRegistryAddress,
                'GlobalMessageRegistry',
                provider,
                signer
            );

            await this.messageRegistryAdapter.initialize();
        }
        return this.messageRegistryAdapter;
    }

    /**
     * Get UltraAlignmentVault adapter instance for a specific vault
     * @param {string} vaultAddress - Address of the vault contract
     * @returns {Promise<UltraAlignmentVaultAdapter>} Vault adapter
     */
    async getVaultAdapter(vaultAddress) {
        const { provider, signer } = this._getReadProvider('UltraAlignmentVault');

        const adapter = new UltraAlignmentVaultAdapter(
            vaultAddress,
            'UltraAlignmentVault',
            provider,
            signer
        );

        return adapter;
    }

    /**
     * Get BlockchainService instance (singleton)
     * Note: CULT EXEC uses BlockchainService directly
     * @returns {BlockchainService} BlockchainService instance
     */
    getBlockchainService() {
        if (!this.blockchainService) {
            this.blockchainService = new BlockchainService();
        }
        return this.blockchainService;
    }

    /**
     * Get appropriate service for a project
     * CULT EXEC uses BlockchainService, other projects use ProjectService
     * @param {string} projectId - Project identifier
     * @returns {BlockchainService|ProjectService} Appropriate service
     */
    getServiceForProject(projectId) {
        if (projectId === 'exec404') {
            // CULT EXEC uses BlockchainService (existing)
            return this.getBlockchainService();
        } else {
            // Factory-created projects use ProjectService
            return this.getProjectService();
        }
    }

    /**
     * Get EXEC voting service instance
     * @returns {MockExecVotingService|RealExecVotingService} Voting service
     */
    getExecVotingService() {
        if (!this.execVotingService) {
            const mockData = this.useMock ? this.mockManager?.getMockData() : null;

            // For mock mode, use hardcoded addresses
            if (this.useMock) {
                this.execVotingService = createExecVotingService(
                    '0xMASTER0000000000000000000000000000000000', // master contract address
                    '0xEXEC4040000000000000000000000000000000000', // EXEC token address
                    mockData
                );
            } else {
                // Real mode: addresses will be loaded asynchronously by the service
                // Service will call getContractAddress() when needed
                this.execVotingService = createExecVotingService(
                    null, // Will be loaded from config
                    null, // Will be loaded from config
                    null
                );
            }
        }
        return this.execVotingService;
    }

    /**
     * Check if using mock services
     * @returns {boolean} True if using mock services
     */
    isUsingMock() {
        return this.useMock;
    }

    /**
     * Get mock data (for mock services)
     * @returns {object|null} Mock data or null
     */
    getMockData() {
        return this.mockManager?.getMockData() || null;
    }

    /**
     * Get contract address from network configuration
     * Falls back to mock addresses if in mock mode
     *
     * @param {string} contractName - Name of contract (e.g., 'MasterRegistryV1')
     * @returns {Promise<string>} Contract address
     */
    async getContractAddress(contractName) {
        // In mock mode, return mock addresses
        if (this.useMock || isMockMode()) {
            // Mock addresses for testing
            const mockAddresses = {
                'MasterRegistryV1': '0xMASTER0000000000000000000000000000000000',
                'GlobalMessageRegistry': '0xMESSAGE000000000000000000000000000000000',
                'FactoryApprovalGovernance': '0xFACGOV0000000000000000000000000000000000',
                'VaultApprovalGovernance': '0xVLTGOV0000000000000000000000000000000000',
                'ERC404Factory': '0xFACTORY404000000000000000000000000000000',
                'ERC1155Factory': '0xFACTORY1155000000000000000000000000000000',
                'UltraAlignmentVault': '0xVAULT00000000000000000000000000000000000',
                'UltraAlignmentHookFactory': '0xHOOKFACTORY0000000000000000000000000000'
            };
            return mockAddresses[contractName] || '0x0000000000000000000000000000000000000000';
        }

        // Real mode: load from config
        return await getContractAddress(contractName);
    }

    /**
     * Check if contract is deployed
     *
     * @param {string} contractName - Name of contract
     * @returns {Promise<boolean>} True if deployed
     */
    async isContractDeployed(contractName) {
        try {
            const address = await this.getContractAddress(contractName);
            return address && address !== '0x0000000000000000000000000000000000000000';
        } catch {
            return false;
        }
    }

    /**
     * Clear all cached service instances
     * Called when contracts are reloaded in development
     */
    clearCache() {
        // Clear real service caches
        if (this.masterService) {
            this.masterService = null;
        }
        if (this.factoryService) {
            this.factoryService?.clearCache();
            this.factoryService = null;
        }
        if (this.projectRegistryInstance) {
            this.projectRegistryInstance?.clearCache();
            this.projectRegistryInstance = null;
        }
        if (this.messageRegistryAdapter) {
            this.messageRegistryAdapter = null;
        }
        if (this.featuredQueueAdapter) {
            this.featuredQueueAdapter = null;
        }
        if (this.grandCentralAdapter) {
            this.grandCentralAdapter = null;
        }
        if (this.componentRegistryAdapter) {
            this.componentRegistryAdapter = null;
        }
        if (this._shareOfferingAdapter) {
            this._shareOfferingAdapter = null;
        }

        // Clear QueryService cache (it listens for contracts:reloaded too,
        // but explicitly clearing here ensures proper order)
        queryService.clearAll();

        // Note: ProjectIndex is NOT cleared on contract reload as it stores
        // historical event data that doesn't change with contract updates.
        // Users can manually clear via StorageSettings if needed.

        // Don't clear projectService, blockchainService, execVotingService
        // as they don't cache contract instances directly
    }
}

// Export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;

