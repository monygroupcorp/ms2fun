import { Component } from '../../core/Component.js';
import { ProjectHeader } from './ProjectHeader.js';
import { ContractTypeRouter } from './ContractTypeRouter.js';
import { WalletDisplay } from '../WalletDisplay/WalletDisplay.js';
import serviceFactory from '../../services/ServiceFactory.js';

/**
 * ProjectDetail component
 * Main component for displaying project details
 */
export class ProjectDetail extends Component {
    constructor(projectId) {
        super();
        this.projectId = projectId;
        this.projectRegistry = serviceFactory.getProjectRegistry();
        this.state = {
            project: null,
            loading: true,
            error: null
        };
    }

    async onMount() {
        await this.loadProject();
    }

    async loadProject() {
        try {
            this.setState({ loading: true, error: null });

            const project = await this.projectRegistry.getProject(this.projectId);

            if (!project) {
                this.setState({
                    loading: false,
                    error: 'Project not found'
                });
                return;
            }

            // Load project into ProjectService so adapter is available
            try {
                const projectService = serviceFactory.getProjectService();
                const contractAddress = project.contractAddress || project.address || this.projectId;
                const contractType = project.contractType || null;
                
                // Only load if not already loaded
                if (!projectService.isProjectLoaded(this.projectId)) {
                    await projectService.loadProject(
                        this.projectId,
                        contractAddress,
                        contractType
                    );
                }
            } catch (serviceError) {
                console.warn('[ProjectDetail] Failed to load project in ProjectService:', serviceError);
                // Continue anyway - adapter loading will retry
            }

            this.setState({
                project,
                loading: false
            });
        } catch (error) {
            console.error('Error loading project:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load project'
            });
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="project-detail">
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Loading project...</p>
                    </div>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="project-detail">
                    <div class="error-state">
                        <h2>Error</h2>
                        <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                        <button class="back-button" data-ref="back-button">← Back to Projects</button>
                    </div>
                </div>
            `;
        }

        if (!this.state.project) {
            return `
                <div class="project-detail">
                    <div class="error-state">
                        <h2>Project Not Found</h2>
                        <p>The project you're looking for doesn't exist.</p>
                        <button class="back-button" data-ref="back-button">← Back to Projects</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="project-detail">
                <div class="detail-navigation">
                    <button class="back-button" data-ref="back-button">← Back to Launchpad</button>
                </div>
                <div class="wallet-display-container" data-ref="wallet-display-container">
                    <!-- WalletDisplay will be mounted here -->
                </div>
                <div class="detail-header-container" data-ref="header-container">
                    <!-- ProjectHeader will be mounted here -->
                </div>
                
                <div class="detail-content-container" data-ref="content-container">
                    <!-- ContractTypeRouter will be mounted here -->
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        
        // Wait for project to load before mounting child components
        if (this.state.project) {
            this.setupChildComponents();
        }
        
        this.setupDOMEventListeners();
    }

    onStateUpdate(oldState, newState) {
        // When project loads, mount child components
        if (!oldState.project && newState.project) {
            this.setupChildComponents();
        }
    }

    setupChildComponents() {
        if (!this.state.project) return;

        // Mount WalletDisplay
        const walletContainer = this.getRef('wallet-display-container', '.wallet-display-container');
        if (walletContainer) {
            const walletDisplay = new WalletDisplay();
            const walletElement = document.createElement('div');
            walletContainer.appendChild(walletElement);
            walletDisplay.mount(walletElement);
            this.createChild('wallet-display', walletDisplay);
        }

        // Mount ProjectHeader
        const headerContainer = this.getRef('header-container', '.detail-header-container');
        if (headerContainer) {
            const headerComponent = new ProjectHeader(this.state.project);
            const headerElement = document.createElement('div');
            headerContainer.appendChild(headerElement);
            headerComponent.mount(headerElement);
            this.createChild('header', headerComponent);
        }

        // Mount ContractTypeRouter
        const contentContainer = this.getRef('content-container', '.detail-content-container');
        if (contentContainer) {
            const routerComponent = new ContractTypeRouter(this.state.project.contractType, this.projectId);
            const routerElement = document.createElement('div');
            contentContainer.appendChild(routerElement);
            routerComponent.mount(routerElement);
            this.createChild('router', routerComponent);
        }
    }

    setupDOMEventListeners() {
        const backButton = this.getRef('back-button', '.back-button');

        if (backButton) {
            backButton.addEventListener('click', () => {
                if (window.router) {
                    window.router.navigate('/');
                } else {
                    window.location.href = '/';
                }
            });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

