import { Component } from '../../core/Component.js';
import { EditionGallery } from '../ERC1155/EditionGallery.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import { ProjectCommentFeed } from '../ProjectCommentFeed/ProjectCommentFeed.js';
import { ERC404ProjectPage } from '../ERC404/ERC404ProjectPage.js';
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

        if (type === 'ERC404' || type === 'ERC404BONDING') {
            if (!this.state.adapter) {
                return `
                    <div class="contract-type-router erc404 error marble-bg">
                        <p>Failed to load contract adapter</p>
                    </div>
                `;
            }

            // Use new ERC404ProjectPage - mount it in setupChildComponents
            return `
                <div class="contract-type-router erc404" data-ref="erc404-page">
                    <!-- ERC404ProjectPage will be mounted here -->
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
                <div class="contract-type-router erc1155 marble-bg">
                    <div class="erc1155-gallery" ref="erc1155-container">
                        <!-- EditionGallery will be mounted here -->
                    </div>
                    <div class="erc1155-comments" ref="erc1155-comments">
                        <!-- ProjectCommentFeed will be mounted here -->
                    </div>
                    <div class="erc1155-admin-button-float" ref="erc1155-admin-button">
                        <!-- AdminButton will be mounted here (only for owners) -->
                    </div>
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

        if ((type === 'ERC404' || type === 'ERC404BONDING') && this.state.adapter) {
            this.setupERC404Components();
        } else if (type === 'ERC1155' && this.state.adapter) {
            this.setupERC1155Components();
        }
    }

    /**
     * Setup all ERC1155 child components
     */
    setupERC1155Components() {
        const adapter = this.state.adapter;

        // Mount AdminButton (only renders if user is owner)
        // Pass projectData so ERC1155AdminModal can display project name
        const adminContainer = this.getRef('erc1155-admin-button', '.erc1155-admin-button');
        if (adminContainer && !this._children.has('admin-button')) {
            const adminButton = new AdminButton(this.projectId, 'ERC1155', adapter, this.state.project);
            const adminElement = document.createElement('div');
            adminContainer.appendChild(adminElement);
            adminButton.mount(adminElement);
            this.createChild('admin-button', adminButton);
        }

        // Mount EditionGallery
        const galleryContainer = this.getRef('erc1155-container', '.erc1155-gallery');
        if (galleryContainer && !this._children.has('edition-gallery')) {
            const galleryComponent = new EditionGallery(this.projectId, adapter, this.state.project);
            const galleryElement = document.createElement('div');
            galleryContainer.appendChild(galleryElement);
            galleryComponent.mount(galleryElement);
            this.createChild('edition-gallery', galleryComponent);
        }

        // Mount ProjectCommentFeed
        const commentsContainer = this.getRef('erc1155-comments', '.erc1155-comments');
        if (commentsContainer && !this._children.has('comment-feed')) {
            const commentFeed = new ProjectCommentFeed(this.projectId, adapter);
            const feedElement = document.createElement('div');
            commentsContainer.appendChild(feedElement);
            commentFeed.mount(feedElement);
            this.createChild('comment-feed', commentFeed);
        }
    }

    /**
     * Setup ERC404 child components using new ERC404ProjectPage
     */
    setupERC404Components() {
        const container = this.element?.querySelector('[data-ref="erc404-page"]');
        if (container && !this._erc404Page) {
            // Build projectData from available info
            const projectData = {
                address: this.state.project?.contractAddress || this.state.project?.address || this.projectId,
                name: this.state.project?.name || 'Unknown',
                symbol: this.state.project?.symbol || 'TOKEN',
                image: this.state.project?.image || this.state.project?.styleUri || null,
                creator: this.state.project?.creator || this.state.project?.owner || null,
                createdAt: this.state.project?.createdAt || null,
                vault: this.state.project?.vault || null
            };

            this._erc404Page = new ERC404ProjectPage(
                this.projectId,
                this.state.adapter,
                projectData
            );
            this._erc404Page.mount(container);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    unmount() {
        // Clean up ERC404ProjectPage if it exists
        if (this._erc404Page) {
            this._erc404Page.unmount();
            this._erc404Page = null;
        }
        // Call parent unmount to clean up other children
        super.unmount();
    }
}

