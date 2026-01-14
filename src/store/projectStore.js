import Store from './Store.js';
import { createSelector } from '../utils/selectors.js';

// Initial state structure
const initialState = {
    activeProjectId: null,
    projects: {},
    globalState: {
        wallet: {
            address: null,
            isConnected: false,
            networkId: null
        },
        network: {
            chainId: null,
            name: null
        }
    }
};

// Validators
const validators = {
    'activeProjectId': (value) => value === null || typeof value === 'string',
    'projects': (value) => typeof value === 'object' && value !== null,
    'globalState': (value) => typeof value === 'object' && value !== null,
    'globalState.wallet': (value) => typeof value === 'object' && value !== null,
    'globalState.network': (value) => typeof value === 'object' && value !== null
};

/**
 * ProjectStore
 * 
 * Multi-project state management store that supports:
 * - Multiple projects with isolated state per project
 * - Global state shared across all projects (wallet, network)
 * - Project switching and management
 * - Integration with ProjectService
 * 
 * NOTE: CULT EXEC continues using tradingStore. This store is for factory-created projects only.
 */
class ProjectStore extends Store {
    constructor() {
        super(initialState, validators);
        
        // Load persisted state from localStorage if available
        this.loadFromLocalStorage();
    }

    // ============================================
    // PROJECT MANAGEMENT METHODS (Task 2)
    // ============================================

    /**
     * Create a new project entry
     * @param {string} projectId - Project identifier
     * @param {Object} metadata - Project metadata
     * @param {Object} initialState - Optional initial state overrides
     * @returns {Object} Created project state
     */
    createProject(projectId, metadata, initialState = {}) {
        if (this.state.projects[projectId]) {
            console.warn(`Project ${projectId} already exists`);
            return this.state.projects[projectId];
        }

        const defaultProjectState = {
            id: projectId,
            contractAddress: metadata.contractAddress || '',
            contractType: metadata.contractType || 'ERC404',
            name: metadata.name || projectId,
            factoryAddress: metadata.factoryAddress || null,
            isFactoryCreated: metadata.isFactoryCreated || false,

            // Initialize with tradingStore-like defaults
            ca: metadata.contractAddress || '',
            mirror: metadata.mirrorAddress || '',
            isEthToExec: true,
            ethAmount: '',
            execAmount: '',
            showMessageOption: false,
            mintOptionChecked: false,
            transactionMessage: '',
            view: {
                isMobile: typeof window !== 'undefined' && window.innerWidth <= 768,
                showCurve: true,
                showSwap: true
            },
            price: {
                current: 0,
                lastUpdated: null
            },
            balances: {
                eth: '0',
                exec: '0',
                nfts: '0',
                userNFTs: [],
                lastUpdated: null
            },
            message: {
                text: '',
                pending: '',
                debounceActive: false
            },
            options: {},
            status: {
                loading: false,
                error: null
            },
            amounts: {
                lastUpdated: null
            },
            isTransactionValid: true,
            contractData: {
                totalBondingSupply: 0,
                lastUpdated: null,
                totalMessages: 0,
                totalNFTs: 0,
                recentMessages: null,
                freeSupply: 0,
                freeMint: 0,
                liquidityPool: null
            },
            poolData: {
                liquidityPool: null,
                reserve0: 0,
                reserve1: 0
            },
            ...initialState
        };

        this.setState({
            projects: {
                ...this.state.projects,
                [projectId]: defaultProjectState
            },
            activeProjectId: this.state.activeProjectId || projectId
        }, { immediate: true }); // Apply immediately to avoid race condition

        // Save to localStorage
        this.saveToLocalStorage();

        return defaultProjectState;
    }

    /**
     * Switch active project
     * @param {string} projectId - Project identifier to switch to
     * @returns {Object} New active project state
     */
    switchProject(projectId) {
        if (!this.state.projects[projectId]) {
            throw new Error(`Project ${projectId} does not exist`);
        }

        this.setState({
            activeProjectId: projectId
        });

        // Save to localStorage
        this.saveToLocalStorage();

        return this.state.projects[projectId];
    }

    /**
     * Get project state (read-only copy)
     * @param {string} projectId - Project identifier
     * @returns {Object|null} Project state or null if doesn't exist
     */
    getProjectState(projectId) {
        const project = this.state.projects[projectId];
        return project ? { ...project } : null;
    }

    /**
     * Update project-specific state
     * @param {string} projectId - Project identifier
     * @param {Object} updates - State updates to apply
     */
    updateProjectState(projectId, updates) {
        if (!this.state.projects[projectId]) {
            throw new Error(`Project ${projectId} does not exist`);
        }

        this.setState({
            projects: {
                ...this.state.projects,
                [projectId]: {
                    ...this.state.projects[projectId],
                    ...updates
                }
            }
        });

        // Save to localStorage
        this.saveToLocalStorage();
    }

    /**
     * Delete a project from the store
     * @param {string} projectId - Project identifier
     */
    deleteProject(projectId) {
        if (!this.state.projects[projectId]) {
            return;
        }

        const newProjects = { ...this.state.projects };
        delete newProjects[projectId];

        const newActiveProjectId = 
            this.state.activeProjectId === projectId 
                ? (Object.keys(newProjects)[0] || null)
                : this.state.activeProjectId;

        this.setState({
            projects: newProjects,
            activeProjectId: newActiveProjectId
        });

        // Save to localStorage
        this.saveToLocalStorage();
    }

    /**
     * Check if project exists
     * @param {string} projectId - Project identifier
     * @returns {boolean} True if project exists
     */
    hasProject(projectId) {
        return !!this.state.projects[projectId];
    }

    /**
     * Get active project ID
     * @returns {string|null} Active project ID or null
     */
    getActiveProjectId() {
        return this.state.activeProjectId;
    }

    // ============================================
    // PROJECT STATE ACTION CREATORS (Task 3)
    // ============================================

    /**
     * Set trading direction for a project
     * @param {string} projectId - Project identifier
     * @param {boolean} isEthToExec - Direction (true = ETH to EXEC, false = EXEC to ETH)
     */
    setDirection(projectId, isEthToExec) {
        this.updateProjectState(projectId, {
            isEthToExec,
            ethAmount: '',
            execAmount: '',
            showMessageOption: false,
            mintOptionChecked: false,
            transactionMessage: '',
            view: {
                ...this.state.projects[projectId].view,
                isMobile: typeof window !== 'undefined' && window.innerWidth <= 768
            }
        });
    }

    /**
     * Update amounts for a project
     * @param {string} projectId - Project identifier
     * @param {string|null} ethAmount - ETH amount (null to keep current)
     * @param {string|null} execAmount - EXEC amount (null to keep current)
     */
    updateAmounts(projectId, ethAmount, execAmount) {
        const project = this.state.projects[projectId];
        if (!project) return;

        this.updateProjectState(projectId, {
            amounts: {
                eth: ethAmount !== null ? ethAmount : project.amounts?.eth || '',
                exec: execAmount !== null ? execAmount : project.amounts?.exec || '',
                lastUpdated: Date.now()
            },
            ethAmount: ethAmount !== null ? ethAmount : project.ethAmount,
            execAmount: execAmount !== null ? execAmount : project.execAmount
        });
    }

    /**
     * Update price for a project
     * @param {string} projectId - Project identifier
     * @param {number} price - New price
     */
    updatePrice(projectId, price) {
        this.updateProjectState(projectId, {
            price: {
                current: price,
                lastUpdated: Date.now()
            }
        });
    }

    /**
     * Update balances for a project
     * @param {string} projectId - Project identifier
     * @param {Object} balances - Balance updates
     */
    updateBalances(projectId, balances) {
        this.updateProjectState(projectId, {
            balances: {
                ...this.state.projects[projectId].balances,
                ...balances,
                lastUpdated: Date.now()
            }
        });
    }

    /**
     * Update free situation for a project
     * @param {string} projectId - Project identifier
     * @param {Object} freeSituation - Free mint/supply data
     */
    updateFreeSituation(projectId, freeSituation) {
        this.updateProjectState(projectId, {
            contractData: {
                ...this.state.projects[projectId].contractData,
                freeMint: freeSituation.freeMint,
                freeSupply: freeSituation.freeSupply
            }
        });
    }

    /**
     * Set view state for a project
     * @param {string} projectId - Project identifier
     * @param {Object} view - View state updates
     */
    setView(projectId, view) {
        this.updateProjectState(projectId, {
            view: {
                ...view,
                isMobile: typeof window !== 'undefined' && window.innerWidth <= 768
            }
        });
    }

    /**
     * Update message for a project
     * @param {string} projectId - Project identifier
     * @param {string} text - Message text
     * @param {boolean} isPending - Whether message is pending
     */
    updateMessage(projectId, text, isPending = false) {
        const project = this.state.projects[projectId];
        if (!project) return;

        this.updateProjectState(projectId, {
            message: {
                text: isPending ? project.message.text : text,
                pending: isPending ? text : '',
                debounceActive: isPending
            }
        });
    }

    /**
     * Toggle option for a project
     * @param {string} projectId - Project identifier
     * @param {string} option - Option name
     * @param {*} value - Option value
     */
    toggleOption(projectId, option, value) {
        this.updateProjectState(projectId, {
            options: {
                ...this.state.projects[projectId].options,
                [option]: value
            }
        });
    }

    /**
     * Set loading state for a project
     * @param {string} projectId - Project identifier
     * @param {boolean} loading - Loading state
     */
    setLoading(projectId, loading) {
        this.updateProjectState(projectId, {
            status: {
                ...this.state.projects[projectId].status,
                loading
            }
        });
    }

    /**
     * Set error state for a project
     * @param {string} projectId - Project identifier
     * @param {string|null} error - Error message or null to clear
     */
    setError(projectId, error) {
        this.updateProjectState(projectId, {
            status: {
                ...this.state.projects[projectId].status,
                error
            }
        });
    }

    /**
     * Set transaction validity for a project
     * @param {string} projectId - Project identifier
     * @param {boolean} isValid - Transaction validity
     */
    setTransactionValidity(projectId, isValid) {
        this.updateProjectState(projectId, {
            isTransactionValid: isValid
        });
    }

    /**
     * Update contract data for a project
     * @param {string} projectId - Project identifier
     * @param {Object} data - Contract data updates
     */
    updateContractData(projectId, data) {
        const project = this.state.projects[projectId];
        if (!project) return;

        const updatedContractData = {
            ...project.contractData,
            ...data,
            lastUpdated: Date.now()
        };

        // Use setStateSync for contract data since components need immediate access
        this.setStateSync({
            projects: {
                ...this.state.projects,
                [projectId]: {
                    ...project,
                    contractData: updatedContractData
                }
            }
        });

        // Save to localStorage
        this.saveToLocalStorage();
    }

    /**
     * Update pool data for a project
     * @param {string} projectId - Project identifier
     * @param {Object} data - Pool data updates
     */
    updatePoolData(projectId, data) {
        this.updateProjectState(projectId, {
            poolData: {
                ...this.state.projects[projectId].poolData,
                ...data
            }
        });
    }

    /**
     * Set contracts (CA and mirror) for a project
     * @param {string} projectId - Project identifier
     * @param {string} ca - Contract address
     * @param {string} mirror - Mirror address
     */
    setContracts(projectId, ca, mirror) {
        this.updateProjectState(projectId, {
            ca,
            mirror
        });
    }

    /**
     * Update user NFTs for a project
     * @param {string} projectId - Project identifier
     * @param {Array} nftData - NFT data array
     */
    updateUserNFTs(projectId, nftData) {
        this.updateProjectState(projectId, {
            balances: {
                ...this.state.projects[projectId].balances,
                userNFTs: nftData
            }
        });
    }

    // ============================================
    // SELECTORS (Task 4)
    // ============================================

    /**
     * Select active project state
     * @returns {Object|null} Active project state or null
     */
    selectActiveProject() {
        if (!this.state.activeProjectId) {
            return null;
        }
        return this.getProjectState(this.state.activeProjectId);
    }

    /**
     * Select specific project state
     * @param {string} projectId - Project identifier
     * @returns {Object|null} Project state or null
     */
    selectProjectState(projectId) {
        return this.getProjectState(projectId);
    }

    /**
     * Select all projects
     * @returns {Object} All projects (read-only copy)
     */
    selectAllProjects() {
        return { ...this.state.projects };
    }

    /**
     * Select active project ID
     * @returns {string|null} Active project ID
     */
    selectActiveProjectId() {
        return this.state.activeProjectId;
    }

    /**
     * Select global state
     * @returns {Object} Global state (read-only copy)
     */
    selectGlobalState() {
        return { ...this.state.globalState };
    }

    /**
     * Select wallet state
     * @returns {Object} Wallet state (read-only copy)
     */
    selectWallet() {
        return { ...this.state.globalState.wallet };
    }

    /**
     * Select network state
     * @returns {Object} Network state (read-only copy)
     */
    selectNetwork() {
        return { ...this.state.globalState.network };
    }

    // Active project selectors (convenience methods)

    /**
     * Select active project direction
     * @returns {boolean|null} isEthToExec for active project
     */
    selectActiveDirection() {
        const project = this.selectActiveProject();
        return project ? project.isEthToExec : null;
    }

    /**
     * Select active project amounts
     * @returns {Object|null} Amounts for active project
     */
    selectActiveAmounts() {
        const project = this.selectActiveProject();
        return project ? {
            eth: project.ethAmount,
            exec: project.execAmount,
            lastUpdated: project.amounts?.lastUpdated
        } : null;
    }

    /**
     * Select active project price
     * @returns {Object|null} Price for active project
     */
    selectActivePrice() {
        const project = this.selectActiveProject();
        return project ? project.price : null;
    }

    /**
     * Select active project balances
     * @returns {Object|null} Balances for active project
     */
    selectActiveBalances() {
        const project = this.selectActiveProject();
        return project ? project.balances : null;
    }

    /**
     * Select active project view
     * @returns {Object|null} View for active project
     */
    selectActiveView() {
        const project = this.selectActiveProject();
        return project ? project.view : null;
    }

    /**
     * Select active project message
     * @returns {Object|null} Message for active project
     */
    selectActiveMessage() {
        const project = this.selectActiveProject();
        return project ? project.message : null;
    }

    /**
     * Select active project status
     * @returns {Object|null} Status for active project
     */
    selectActiveStatus() {
        const project = this.selectActiveProject();
        return project ? project.status : null;
    }

    /**
     * Select active project contract data
     * @returns {Object|null} Contract data for active project
     */
    selectActiveContractData() {
        const project = this.selectActiveProject();
        return project ? project.contractData : null;
    }

    /**
     * Select active project contracts (CA and mirror)
     * @returns {Object|null} Contracts for active project
     */
    selectActiveContracts() {
        const project = this.selectActiveProject();
        return project ? {
            ca: project.ca,
            mirror: project.mirror
        } : null;
    }

    /**
     * Select active project transaction validity
     * @returns {boolean|null} Transaction validity for active project
     */
    selectActiveTransactionValidity() {
        const project = this.selectActiveProject();
        return project ? project.isTransactionValid : null;
    }

    /**
     * Select active project pool data
     * @returns {Object|null} Pool data for active project
     */
    selectActivePoolData() {
        const project = this.selectActiveProject();
        return project ? project.poolData : null;
    }

    /**
     * Selector for Phase 2 status (liquidity pool deployed) for active project
     * Memoized to prevent unnecessary recalculations
     * @returns {boolean} - True if Phase 2 is active
     */
    selectActiveIsPhase2() {
        // Use memoized selector if available, otherwise create it
        if (!this._selectActiveIsPhase2) {
            this._selectActiveIsPhase2 = createSelector(
                [() => this.selectActiveContractData()],
                (contractData) => {
                    if (!contractData) return false;
                    return contractData.liquidityPool && 
                           contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';
                },
                {
                    name: 'selectActiveIsPhase2',
                    store: this,
                    paths: ['projects']
                }
            );
        }
        return this._selectActiveIsPhase2();
    }

    // ============================================
    // GLOBAL STATE MANAGEMENT (Task 5)
    // ============================================

    /**
     * Set wallet address
     * @param {string|null} address - Wallet address
     */
    setWalletAddress(address) {
        this.setStateSync({
            globalState: {
                ...this.state.globalState,
                wallet: {
                    ...this.state.globalState.wallet,
                    address,
                    isConnected: !!address
                }
            }
        });
        this.saveToLocalStorage();
    }

    /**
     * Set wallet connected state
     * @param {boolean} isConnected - Connection state
     */
    setWalletConnected(isConnected) {
        this.setState({
            globalState: {
                ...this.state.globalState,
                wallet: {
                    ...this.state.globalState.wallet,
                    isConnected
                }
            }
        });
        this.saveToLocalStorage();
    }

    /**
     * Set wallet network ID
     * @param {number|null} networkId - Network ID
     */
    setWalletNetworkId(networkId) {
        this.setState({
            globalState: {
                ...this.state.globalState,
                wallet: {
                    ...this.state.globalState.wallet,
                    networkId
                }
            }
        });
        this.saveToLocalStorage();
    }

    /**
     * Set network information
     * @param {number|null} chainId - Chain ID
     * @param {string|null} name - Network name
     */
    setNetwork(chainId, name) {
        this.setState({
            globalState: {
                ...this.state.globalState,
                network: {
                    chainId,
                    name
                }
            }
        });
        this.saveToLocalStorage();
    }

    // ============================================
    // PROJECT SERVICE INTEGRATION (Task 6)
    // ============================================

    /**
     * Initialize project from ProjectService
     * Called by ProjectService when loading a project
     * @param {string} projectId - Project identifier
     * @param {Object} projectMetadata - Project metadata from ProjectService
     */
    initializeProjectFromService(projectId, projectMetadata) {
        if (!this.hasProject(projectId)) {
            this.createProject(projectId, projectMetadata);
        }
        this.switchProject(projectId);
    }

    /**
     * Sync active project with ProjectService
     * Called by ProjectService when switching projects
     * @param {string} projectId - Project identifier
     */
    syncActiveProject(projectId) {
        if (this.state.activeProjectId !== projectId) {
            this.switchProject(projectId);
        }
    }

    // ============================================
    // LOCAL STORAGE PERSISTENCE (Task 10)
    // ============================================

    /**
     * Save state to localStorage
     * @private
     */
    saveToLocalStorage() {
        try {
            const serializableState = {
                activeProjectId: this.state.activeProjectId,
                projects: this.state.projects,
                globalState: this.state.globalState
            };
            localStorage.setItem('projectStore', JSON.stringify(serializableState));
        } catch (error) {
            console.error('Failed to save ProjectStore to localStorage:', error);
        }
    }

    /**
     * Load state from localStorage
     * @private
     */
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('projectStore');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate and merge with current state
                if (parsed && typeof parsed === 'object') {
                    this.setState({
                        activeProjectId: parsed.activeProjectId || null,
                        projects: parsed.projects || {},
                        globalState: {
                            ...this.state.globalState,
                            ...(parsed.globalState || {})
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load ProjectStore from localStorage:', error);
        }
    }
}

// Export singleton instance
export const projectStore = new ProjectStore();

