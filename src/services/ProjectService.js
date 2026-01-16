/**
 * Project Service
 * 
 * Manages multiple contract instances for multi-project support.
 * Handles lazy loading, project switching, and adapter management.
 */

import contractTypeRegistry from './contracts/ContractTypeRegistry.js';
import ERC404Adapter from './contracts/ERC404Adapter.js';
import ERC1155Adapter from './contracts/ERC1155Adapter.js';
import MasterRegistryAdapter from './contracts/MasterRegistryAdapter.js';
import GlobalMessageRegistryAdapter from './contracts/GlobalMessageRegistryAdapter.js';
import ERC404BondingInstanceAdapter from './contracts/ERC404BondingInstanceAdapter.js';
import UltraAlignmentVaultAdapter from './contracts/UltraAlignmentVaultAdapter.js';
import GovernanceAdapter from './contracts/GovernanceAdapter.js';
import ERC404FactoryAdapter from './contracts/ERC404FactoryAdapter.js';
import ERC1155FactoryAdapter from './contracts/ERC1155FactoryAdapter.js';
import walletService from './WalletService.js';
import { eventBus } from '../core/EventBus.js';
import serviceFactory from './ServiceFactory.js';
import { detectNetwork } from '../config/network.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { projectStore } from '../store/projectStore.js';
import { convertProjectServiceMetadata } from '../utils/projectStateInitializer.js';

class ProjectService {
    constructor() {
        // Instance pool: projectId -> ContractInstance
        this.instances = new Map();
        
        // Active project ID
        this.activeProjectId = null;
        
        // Get project registry
        this.projectRegistry = serviceFactory.getProjectRegistry();
        
        // Register adapters with registry
        contractTypeRegistry.setAdapterClass('ERC404', ERC404Adapter);
        contractTypeRegistry.setAdapterClass('ERC1155', ERC1155Adapter);

        // Phase 2 adapters (complete)
        contractTypeRegistry.setAdapterClass('MasterRegistry', MasterRegistryAdapter);
        contractTypeRegistry.setAdapterClass('GlobalMessageRegistry', GlobalMessageRegistryAdapter);
        contractTypeRegistry.setAdapterClass('ERC404Bonding', ERC404BondingInstanceAdapter);

        // Phase 3 adapters (complete)
        contractTypeRegistry.setAdapterClass('UltraAlignmentVault', UltraAlignmentVaultAdapter);
        contractTypeRegistry.setAdapterClass('FactoryGovernance', GovernanceAdapter);
        contractTypeRegistry.setAdapterClass('VaultGovernance', GovernanceAdapter);
        contractTypeRegistry.setAdapterClass('ERC404Factory', ERC404FactoryAdapter);
        contractTypeRegistry.setAdapterClass('ERC1155Factory', ERC1155FactoryAdapter);
    }

    /**
     * Load a project by ID and contract address
     * @param {string} projectId - Project identifier
     * @param {string} contractAddress - Contract address
     * @param {string|null} contractType - Contract type (auto-detected if null)
     * @returns {Promise<Object>} Contract instance
     */
    async loadProject(projectId, contractAddress, contractType = null) {
        // Check if already loaded
        if (this.instances.has(projectId)) {
            return this.instances.get(projectId);
        }

        // Detect contract type if not provided
        if (!contractType) {
            contractType = await this.detectContractType(contractAddress);
            if (!contractType) {
                throw new Error(`Could not detect contract type for ${contractAddress}`);
            }
        }

        // Get adapter class from registry
        const AdapterClass = contractTypeRegistry.getAdapterClass(contractType);
        if (!AdapterClass) {
            throw new Error(`No adapter registered for type: ${contractType}`);
        }

        // Get provider and signer from wallet service
        let { provider, signer } = walletService.getProviderAndSigner();

        // For mock contracts, we can work without a provider
        // Check common patterns first
        let isMockContract = contractAddress.startsWith('0xMOCK') ||
                             contractAddress.includes('mock') ||
                             contractAddress.startsWith('0xFACTORY');

        // Also check if it exists in mock data (for dynamically generated addresses)
        if (!isMockContract) {
            try {
                const saved = localStorage.getItem('mockLaunchpadData');
                if (saved) {
                    const mockData = JSON.parse(saved);
                    if (mockData && mockData.instances && mockData.instances[contractAddress]) {
                        isMockContract = true;
                    }
                }
            } catch (error) {
                // If we can't check, assume it's not a mock contract
            }
        }

        // If no wallet provider and not a mock contract, create read-only provider for local mode
        if (!provider && !isMockContract) {
            const network = detectNetwork();
            if (network.mode === 'local' && network.rpcUrl) {
                console.log('[ProjectService] Creating read-only provider for local development');
                // Use StaticJsonRpcProvider for Anvil to skip network auto-detection entirely
                provider = new ethers.providers.StaticJsonRpcProvider(
                    network.rpcUrl,
                    { name: 'anvil', chainId: network.chainId, ensAddress: null }
                );
                signer = null;
            } else {
                throw new Error('Wallet provider not available. Please connect a wallet or ensure local Anvil is running.');
            }
        }

        // For mock contracts without provider, use a minimal provider object
        // The adapter will detect mock contracts and skip real contract calls
        const finalProvider = provider || (isMockContract ? { isMock: true } : null);
        const finalSigner = signer || null;

        // Create adapter instance
        const adapter = new AdapterClass(contractAddress, contractType, finalProvider, finalSigner);

        // Initialize adapter
        await adapter.initialize();

        // Get project metadata from registry (if available)
        let metadata = {
            name: projectId,
            factoryAddress: null,
            isFactoryCreated: false,
            contractAddress,
            contractType
        };

        try {
            // Try to get project by contract address (projectId might be address)
            let project = await this.projectRegistry.getProject(contractAddress);
            // If not found, try projectId
            if (!project && projectId !== contractAddress) {
                project = await this.projectRegistry.getProject(projectId);
            }
            
            if (project) {
                metadata = {
                    ...metadata,
                    name: project.name || projectId,
                    factoryAddress: project.factoryAddress || null,
                    isFactoryCreated: project.factoryAddress !== null,
                    description: project.description,
                    symbol: project.symbol,
                    creator: project.creator
                };
            }
        } catch (error) {
            console.warn(`[ProjectService] Could not load metadata for ${projectId}:`, error);
        }

        // Create instance entry
        const instance = {
            projectId,
            contractAddress,
            contractType,
            adapter,
            metadata,
            loadedAt: Date.now()
        };

        // Store instance
        this.instances.set(projectId, instance);

        // Set as active if no active project
        if (!this.activeProjectId) {
            this.activeProjectId = projectId;
        }

        // Initialize project in ProjectStore (for factory-created projects only, not CULT EXEC)
        // CULT EXEC (exec404) continues using tradingStore
        if (projectId !== 'exec404') {
            try {
                const projectMetadata = convertProjectServiceMetadata(instance);
                projectStore.initializeProjectFromService(projectId, projectMetadata);
                console.log(`[ProjectService] Initialized project ${projectId} in ProjectStore`);
            } catch (error) {
                console.warn(`[ProjectService] Failed to initialize project in ProjectStore:`, error);
            }
        }

        // Emit event
        eventBus.emit('project:loaded', {
            projectId,
            contractAddress,
            contractType
        });

        console.log(`[ProjectService] Loaded project: ${projectId} (${contractType})`);

        return instance;
    }

    /**
     * Load project from registry
     * @param {string} projectId - Project identifier
     * @returns {Promise<Object>} Contract instance
     */
    async loadProjectFromRegistry(projectId) {
        // Get project from registry
        const project = await this.projectRegistry.getProject(projectId);
        if (!project) {
            throw new Error(`Project not found in registry: ${projectId}`);
        }

        // Load using registry data
        return await this.loadProject(
            projectId,
            project.contractAddress || project.address,
            project.contractType || null
        );
    }

    /**
     * Load CULT EXEC as a special project
     * @returns {Promise<Object>} Contract instance
     */
    async loadCultExec() {
        const projectId = 'exec404';

        // Check if already loaded
        if (this.instances.has(projectId)) {
            return this.instances.get(projectId);
        }

        // Load config from static file
        let config;
        try {
            const configResponse = await fetch('/EXEC404/switch.json');
            if (!configResponse.ok) {
                throw new Error('Failed to load CULT EXEC config');
            }
            config = await configResponse.json();
        } catch (error) {
            throw new Error(`Failed to load CULT EXEC configuration: ${error.message}`);
        }

        // Load as ERC404 project
        return await this.loadProject(
            projectId,
            config.address,
            'ERC404'
        );
    }

    /**
     * Switch active project
     * @param {string} projectId - Project identifier to switch to
     * @returns {Promise<Object>} Contract instance
     */
    async switchProject(projectId) {
        // Check if project is loaded
        if (!this.instances.has(projectId)) {
            // Try to load from registry
            try {
                await this.loadProjectFromRegistry(projectId);
            } catch (error) {
                throw new Error(`Project not loaded and could not be loaded: ${projectId}`);
            }
        }

        // Set as active
        this.activeProjectId = projectId;

        // Sync active project in ProjectStore (for factory-created projects only, not CULT EXEC)
        if (projectId !== 'exec404') {
            try {
                projectStore.syncActiveProject(projectId);
                console.log(`[ProjectService] Synced active project ${projectId} in ProjectStore`);
            } catch (error) {
                console.warn(`[ProjectService] Failed to sync active project in ProjectStore:`, error);
            }
        }

        // Emit event
        eventBus.emit('project:switched', {
            projectId,
            contractAddress: this.instances.get(projectId).contractAddress
        });

        console.log(`[ProjectService] Switched to project: ${projectId}`);

        return this.instances.get(projectId);
    }

    /**
     * Unload a project
     * @param {string} projectId - Project identifier
     */
    unloadProject(projectId) {
        if (this.instances.has(projectId)) {
            this.instances.delete(projectId);

            // If this was the active project, clear active
            if (this.activeProjectId === projectId) {
                this.activeProjectId = null;
            }

            // Emit event
            eventBus.emit('project:unloaded', { projectId });

            console.log(`[ProjectService] Unloaded project: ${projectId}`);
        }
    }

    /**
     * Get active project instance
     * @returns {Object|null} Active project instance or null
     */
    getActiveProject() {
        if (!this.activeProjectId) {
            return null;
        }
        return this.instances.get(this.activeProjectId) || null;
    }

    /**
     * Get project instance by ID
     * @param {string} projectId - Project identifier
     * @returns {Object|null} Project instance or null
     */
    getProjectInstance(projectId) {
        return this.instances.get(projectId) || null;
    }

    /**
     * Get adapter for a project
     * @param {string} projectId - Project identifier
     * @returns {ContractAdapter|null} Adapter instance or null
     */
    getAdapter(projectId) {
        const instance = this.instances.get(projectId);
        return instance ? instance.adapter : null;
    }

    /**
     * Get active adapter
     * @returns {ContractAdapter|null} Active adapter or null
     */
    getActiveAdapter() {
        const activeProject = this.getActiveProject();
        return activeProject ? activeProject.adapter : null;
    }

    /**
     * Get all loaded project IDs
     * @returns {Array<string>} Array of project IDs
     */
    getProjectIds() {
        return Array.from(this.instances.keys());
    }

    /**
     * Check if a project is loaded
     * @param {string} projectId - Project identifier
     * @returns {boolean} True if loaded
     */
    isProjectLoaded(projectId) {
        return this.instances.has(projectId);
    }

    /**
     * Get project metadata
     * @param {string} projectId - Project identifier
     * @returns {Object|null} Project metadata or null
     */
    getProjectMetadata(projectId) {
        const instance = this.instances.get(projectId);
        return instance ? instance.metadata : null;
    }

    /**
     * Check if project is CULT EXEC
     * @param {string} projectId - Project identifier
     * @returns {boolean} True if CULT EXEC
     */
    isCultExec(projectId) {
        return projectId === 'exec404';
    }

    /**
     * Detect contract type from address
     * @param {string} address - Contract address
     * @returns {Promise<string|null>} Detected contract type or null
     * @private
     */
    async detectContractType(address) {
        // For now, we'll try to detect from ABI if available
        // In the future, this could fetch ABI from Etherscan or similar
        
        // Try to load ABI from standard location (for ERC404)
        try {
            const abiResponse = await fetch('/EXEC404/abi.json');
            if (abiResponse.ok) {
                const abi = await abiResponse.json();
                const detectedType = contractTypeRegistry.detectContractTypeFromABI(abi);
                if (detectedType) {
                    return detectedType;
                }
            }
        } catch (error) {
            // Ignore - ABI might not be available
        }

        // Default to ERC404 for now (can be enhanced later)
        // In production, this would fetch ABI from a service
        console.warn(`[ProjectService] Could not detect contract type for ${address}, defaulting to ERC404`);
        return 'ERC404';
    }
}

export default ProjectService;

