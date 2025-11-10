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
            loading: true
        };
    }

    async onMount() {
        await this.loadAdapter();
    }

    onStateUpdate(oldState, newState) {
        // When adapter loads, setup child components
        if (!oldState.adapter && newState.adapter && !this.state.loading) {
            this.setupChildComponents();
        }
    }

    async loadAdapter() {
        try {
            this.setState({ loading: true });
            const projectService = serviceFactory.getProjectService();
            
            // Try to get adapter - if not found, try to load project first
            let adapter = projectService.getAdapter(this.projectId);
            
            if (!adapter) {
                // Try to load project from registry
                const projectRegistry = serviceFactory.getProjectRegistry();
                const project = await projectRegistry.getProject(this.projectId);
                
                if (project && project.contractAddress) {
                    // Load the project in ProjectService
                    await projectService.loadProject(
                        this.projectId,
                        project.contractAddress,
                        project.contractType
                    );
                    adapter = projectService.getAdapter(this.projectId);
                }
            }
            
            this.setState({ adapter, loading: false });
        } catch (error) {
            console.error('[ContractTypeRouter] Failed to load adapter:', error);
            this.setState({ loading: false });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="contract-type-router loading">
                    <div class="loading-spinner"></div>
                    <p>Loading interface...</p>
                </div>
            `;
        }

        if (!this.contractType) {
            return `
                <div class="contract-type-router">
                    <div class="placeholder-message">
                        <p>Contract type not specified</p>
                    </div>
                </div>
            `;
        }

        const type = this.contractType.toUpperCase();

        if (type === 'ERC404') {
            return `
                <div class="contract-type-router erc404">
                    <div class="placeholder-message">
                        <h2>Trading Interface</h2>
                        <p>ERC404 trading interface will be available here in Phase 3.</p>
                        <p class="coming-soon">Coming Soon</p>
                    </div>
                </div>
            `;
        } else if (type === 'ERC1155') {
            if (!this.state.adapter) {
            return `
                    <div class="contract-type-router erc1155 error">
                        <p>Failed to load contract adapter</p>
                    </div>
                `;
            }

            return `
                <div class="contract-type-router erc1155" ref="erc1155-container">
                    <!-- EditionGallery will be mounted here -->
                </div>
            `;
        } else {
            return `
                <div class="contract-type-router unknown">
                    <div class="placeholder-message">
                        <p>Unknown contract type: ${this.escapeHtml(this.contractType)}</p>
                    </div>
                </div>
            `;
        }
    }

    setupChildComponents() {
        const type = this.contractType?.toUpperCase();

        if (type === 'ERC1155' && this.state.adapter) {
            const container = this.getRef('erc1155-container', '.erc1155');
            if (container) {
                const galleryComponent = new EditionGallery(this.projectId, this.state.adapter);
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

