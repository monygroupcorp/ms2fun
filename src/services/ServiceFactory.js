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

// Real service implementations
import RealMasterService from './RealMasterService.js';
import RealFactoryService from './RealFactoryService.js';
import RealProjectRegistry from './RealProjectRegistry.js';
import GlobalMessageRegistryAdapter from './contracts/GlobalMessageRegistryAdapter.js';
import UltraAlignmentVaultAdapter from './contracts/UltraAlignmentVaultAdapter.js';
import walletService from './WalletService.js';

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

        if (this.useMock) {
            this.mockManager = new MockServiceManager(true, true);
        }

        // Listen for contract reload events (local dev only)
        eventBus.on('contracts:reloaded', () => {
            console.log('[ServiceFactory] Clearing cached services due to contract reload');
            this.clearCache();
        });
    }

    /**
     * Get master service instance
     * @returns {MockMasterService|RealMasterService} Master service
     */
    getMasterService() {
        if (this.useMock) {
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
            return this.mockManager.getProjectRegistry();
        } else {
            if (!this.projectRegistryInstance) {
                this.projectRegistryInstance = new RealProjectRegistry();
            }
            return this.projectRegistryInstance;
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

        // Don't clear projectService, blockchainService, execVotingService
        // as they don't cache contract instances directly

        console.log('[ServiceFactory] Service caches cleared');
    }
}

// Export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;

