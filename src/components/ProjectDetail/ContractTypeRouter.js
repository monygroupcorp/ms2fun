import { Component } from '../../core/Component.js';
import { EditionGallery } from '../ERC1155/EditionGallery.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * ContractTypeRouter component
 * Routes to appropriate interface based on contract type
 */
export class ContractTypeRouter extends Component {
    constructor(contractType, projectId) {
        super();
        this.contractType = contractType;
        this.projectId = projectId;
        this.state = {
            adapter: null,
            loading: true,
            project: null
        };
    }

    async onMount() {
        await this.loadAdapter();
    }

    onStateUpdate(oldState, newState) {
        // When adapter loads, setup child components
        if (!oldState.adapter && newState.adapter && !this.state.loading) {
            // Use setTimeout to ensure DOM is ready after render
            this.setTimeout(() => {
                this.setupChildComponents();
            }, 0);
        }
    }

    async loadAdapter() {
        try {
            this.setState({ loading: true });
            const projectService = serviceFactory.getProjectService();
            const projectRegistry = serviceFactory.getProjectRegistry();
            
            // Try to get adapter - if not found, try to load project first
            let adapter = projectService.getAdapter(this.projectId);
            let project = await projectRegistry.getProject(this.projectId);
            
            if (!adapter) {
                // Try to get project from registry (already loaded above)
                
                // If not found by projectId, try using projectId as contract address
                if (!project) {
                    // projectId might be the contract address, try loading directly
                    try {
                        await projectService.loadProject(
                            this.projectId, // Use as both projectId and contractAddress
                            this.projectId,
                            this.contractType || null
                        );
                        adapter = projectService.getAdapter(this.projectId);
                    } catch (loadError) {
                        console.warn('[ContractTypeRouter] Failed to load project directly:', loadError);
                    }
                }
                
                // If still no adapter and we have project data, try loading with project data
                if (!adapter && project) {
                    const contractAddress = project.contractAddress || project.address || this.projectId;
                    const contractType = project.contractType || this.contractType;
                    
                    try {
                        await projectService.loadProject(
                            this.projectId,
                            contractAddress,
                            contractType
                        );
                        adapter = projectService.getAdapter(this.projectId);
                    } catch (loadError) {
                        console.error('[ContractTypeRouter] Failed to load project with registry data:', loadError);
                    }
                }
            }
            
            if (!adapter) {
                console.error('[ContractTypeRouter] Could not load adapter for projectId:', this.projectId);
                console.error('[ContractTypeRouter] Contract type:', this.contractType);
            }
            
            this.setState({ adapter, project, loading: false });
        } catch (error) {
            console.error('[ContractTypeRouter] Failed to load adapter:', error);
            console.error('[ContractTypeRouter] Error details:', {
                projectId: this.projectId,
                contractType: this.contractType,
                error: error.message,
                stack: error.stack
            });
            this.setState({ loading: false });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="contract-type-router loading marble-bg">
                    <div class="loading-spinner"></div>
                    <p>Loading interface...</p>
                </div>
            `;
        }

        if (!this.contractType) {
            return `
                <div class="contract-type-router marble-bg">
                    <div class="placeholder-message">
                        <p>Contract type not specified</p>
                    </div>
                </div>
            `;
        }

        const type = this.contractType.toUpperCase();

        if (type === 'ERC404') {
            if (!this.state.adapter) {
                return `
                    <div class="contract-type-router erc404 error marble-bg">
                        <p>Failed to load contract adapter</p>
                    </div>
                `;
            }

            return `
                <div class="contract-type-router erc404 marble-bg" ref="erc404-container">
                    <!-- ERC404TradingInterface will be mounted here -->
                </div>
            `;
        } else if (type === 'ERC1155') {
            if (!this.state.adapter) {
            return `
                    <div class="contract-type-router erc1155 error marble-bg">
                        <p>Failed to load contract adapter</p>
                    </div>
                `;
            }

            return `
                <div class="contract-type-router erc1155 marble-bg" ref="erc1155-container">
                    <!-- EditionGallery will be mounted here -->
                </div>
            `;
        } else {
            return `
                <div class="contract-type-router unknown marble-bg">
                    <div class="placeholder-message">
                        <p>Unknown contract type: ${this.escapeHtml(this.contractType)}</p>
                    </div>
                </div>
            `;
        }
    }

    setupChildComponents() {
        const type = this.contractType?.toUpperCase();

        if (type === 'ERC404' && this.state.adapter) {
            const container = this.getRef('erc404-container', '.erc404');
            if (container) {
                // Dynamically import ERC404TradingInterface
                import('../ERC404/ERC404TradingInterface.js').then(({ ERC404TradingInterface }) => {
                    const tradingComponent = new ERC404TradingInterface(this.projectId, this.state.adapter);
                    const tradingElement = document.createElement('div');
                    container.appendChild(tradingElement);
                    tradingComponent.mount(tradingElement);
                    this.createChild('erc404-trading', tradingComponent);
                }).catch(error => {
                    console.error('[ContractTypeRouter] Failed to load ERC404TradingInterface:', error);
                    container.innerHTML = `
                        <div class="error-message">
                            <p>Failed to load trading interface: ${error.message}</p>
                        </div>
                    `;
                });
            }
        } else if (type === 'ERC1155' && this.state.adapter) {
            const container = this.getRef('erc1155-container', '.erc1155');
            if (container) {
                const galleryComponent = new EditionGallery(this.projectId, this.state.adapter, this.state.project);
                const galleryElement = document.createElement('div');
                container.appendChild(galleryElement);
                galleryComponent.mount(galleryElement);
                this.createChild('edition-gallery', galleryComponent);
            }
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

