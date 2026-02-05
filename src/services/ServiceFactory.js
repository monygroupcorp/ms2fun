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

// Real service implementations
import RealMasterService from './RealMasterService.js';
import RealFactoryService from './RealFactoryService.js';
import RealProjectRegistry from './RealProjectRegistry.js';
import GlobalMessageRegistryAdapter from './contracts/GlobalMessageRegistryAdapter.js';
import UltraAlignmentVaultAdapter from './contracts/UltraAlignmentVaultAdapter.js';
import FeaturedQueueManagerAdapter from './contracts/FeaturedQueueManagerAdapter.js';
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
        this.initialized = false;
        this.initPromise = null;

        if (this.useMock) {
            this.mockManager = new MockServiceManager(true, true);
            this.initialized = true;
        }

        // Listen for contract reload events (local dev only)
        eventBus.on('contracts:reloaded', () => {
            console.log('[ServiceFactory] Clearing cached services due to contract reload');
            this.clearCache();
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
                console.log('[ServiceFactory] Initialized in mock mode (configured)');
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

                        if (isZeroAddress) {
                            console.log('[ServiceFactory] No contracts deployed (zero address)');
                        } else {
                            contractsAvailable = true;
                        }
                    }
                } catch (e) {
                    console.log('[ServiceFactory] Could not load contract config');
                }

                // For local mode, also verify RPC is available and has code
                if (contractsAvailable && network.mode === 'local') {
                    const rpcAvailable = await checkRpcAvailable(masterAddress);
                    if (!rpcAvailable) {
                        console.log('[ServiceFactory] RPC unavailable or contract not deployed');
                        contractsAvailable = false;
                    }
                }

                // Fall back to mock mode if no contracts available
                if (!contractsAvailable) {
                    console.log('[ServiceFactory] No contracts available, using static mode');
                    this.useMock = true;
                    this.mockManager = new MockServiceManager(true, true);
                    eventBus.emit('services:mock-mode', { reason: 'contracts-missing' });
                }
            }

            this.initialized = true;
            console.log('[ServiceFactory] Initialized in', this.useMock ? 'static/mock' : 'real', 'mode');
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

            // Get provider - use wallet if connected, otherwise create read-only provider
            let provider, signer;
            const walletProviderAndSigner = walletService.getProviderAndSigner();

            if (walletProviderAndSigner.provider) {
                provider = walletProviderAndSigner.provider;
                signer = walletProviderAndSigner.signer;
            } else {
                const network = (await import('../config/network.js')).detectNetwork();
                if (network.mode === 'local' && network.rpcUrl) {
                    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                    provider = new ethers.providers.StaticJsonRpcProvider(
                        network.rpcUrl,
                        { name: 'anvil', chainId: network.chainId, ensAddress: null }
                    );
                    signer = null;
                } else {
                    throw new Error('No provider available for FeaturedQueueManager');
                }
            }

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
     * Get GlobalMessageRegistry adapter instance (singleton)
     * @returns {Promise<GlobalMessageRegistryAdapter>} Message registry adapter
     */
    async getMessageRegistryAdapter() {
        if (!this.messageRegistryAdapter) {
            const masterService = this.getMasterService();
            let messageRegistryAddress = await masterService.getGlobalMessageRegistry();

            // Ensure address is a string (contract may return array or other type)
            if (Array.isArray(messageRegistryAddress)) {
                messageRegistryAddress = messageRegistryAddress[0];
            }
            if (messageRegistryAddress && typeof messageRegistryAddress !== 'string') {
                messageRegistryAddress = messageRegistryAddress.toString();
            }

            if (!messageRegistryAddress || messageRegistryAddress === '0x0000000000000000000000000000000000000000') {
                throw new Error('GlobalMessageRegistry address not available');
            }

            // Get provider - use wallet if connected, otherwise create read-only provider
            let provider, signer;
            const walletProviderAndSigner = walletService.getProviderAndSigner();

            if (walletProviderAndSigner.provider) {
                // Wallet connected - use its provider
                provider = walletProviderAndSigner.provider;
                signer = walletProviderAndSigner.signer;
            } else {
                // No wallet - create read-only provider for local mode
                const network = (await import('../config/network.js')).detectNetwork();
                if (network.mode === 'local' && network.rpcUrl) {
                    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                    provider = new ethers.providers.StaticJsonRpcProvider(
                        network.rpcUrl,
                        { name: 'anvil', chainId: network.chainId, ensAddress: null }
                    );
                    signer = null;
                } else {
                    throw new Error('No provider available for GlobalMessageRegistry');
                }
            }

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
        // Get provider - use wallet if connected, otherwise create read-only provider
        let provider, signer;
        const walletProviderAndSigner = walletService.getProviderAndSigner();

        if (walletProviderAndSigner.provider) {
            // Wallet connected - use its provider
            provider = walletProviderAndSigner.provider;
            signer = walletProviderAndSigner.signer;
        } else {
            // No wallet - create read-only provider for local mode
            const network = (await import('../config/network.js')).detectNetwork();
            if (network.mode === 'local' && network.rpcUrl) {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                provider = new ethers.providers.StaticJsonRpcProvider(
                    network.rpcUrl,
                    { name: 'anvil', chainId: network.chainId, ensAddress: null }
                );
                signer = null;
            } else {
                throw new Error('No provider available for UltraAlignmentVault');
            }
        }

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
        console.log('[ServiceFactory] Clearing service caches...');

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

        // Clear QueryService cache (it listens for contracts:reloaded too,
        // but explicitly clearing here ensures proper order)
        queryService.clearAll();

        // Note: ProjectIndex is NOT cleared on contract reload as it stores
        // historical event data that doesn't change with contract updates.
        // Users can manually clear via StorageSettings if needed.

        // Don't clear projectService, blockchainService, execVotingService
        // as they don't cache contract instances directly

        console.log('[ServiceFactory] Service caches cleared');
    }
}

// Export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;

