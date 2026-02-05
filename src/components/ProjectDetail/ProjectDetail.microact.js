/**
 * ProjectDetail - Microact Version
 *
 * Main component for displaying project details.
 * Loads project data and routes to appropriate interface via ContractTypeRouter.
 */

import { Component, h } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class ProjectDetail extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            project: null,
            loading: true,
            error: null
        };
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadProject();
    }

    async loadProject() {
        try {
            this.setState({ loading: true, error: null });

            const projectRegistry = serviceFactory.getProjectRegistry();
            const project = await projectRegistry.getProject(this.projectId);

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

                if (!projectService.isProjectLoaded(this.projectId)) {
                    await projectService.loadProject(
                        this.projectId,
                        contractAddress,
                        contractType
                    );
                }
            } catch (serviceError) {
                console.warn('[ProjectDetail] Failed to load project in ProjectService:', serviceError);
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

    handleBack() {
        if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    render() {
        const { project, loading, error } = this.state;

        if (loading) {
            return h('div', { className: 'project-detail' },
                h('div', { className: 'loading-state' },
                    h('div', { className: 'spinner' }),
                    h('p', null, 'Loading project...')
                )
            );
        }

        if (error) {
            return h('div', { className: 'project-detail' },
                h('div', { className: 'error-state' },
                    h('h2', null, 'Error'),
                    h('p', { className: 'error-message' }, this.escapeHtml(error)),
                    h('button', {
                        className: 'back-button',
                        onClick: this.bind(this.handleBack)
                    }, '\u2190 Back to Projects')
                )
            );
        }

        if (!project) {
            return h('div', { className: 'project-detail' },
                h('div', { className: 'error-state' },
                    h('h2', null, 'Project Not Found'),
                    h('p', null, "The project you're looking for doesn't exist."),
                    h('button', {
                        className: 'back-button',
                        onClick: this.bind(this.handleBack)
                    }, '\u2190 Back to Projects')
                )
            );
        }

        const contractType = project.contractType?.toUpperCase() || '';
        const isERC404 = contractType === 'ERC404' || contractType === 'ERC404BONDING';

        return h('div', { className: 'project-detail marble-bg' },
            h('div', { className: 'detail-navigation' },
                h('button', {
                    className: 'back-button',
                    onClick: this.bind(this.handleBack)
                }, '\u2190 Back to Launchpad')
            ),

            // ProjectHeader placeholder (skip for ERC404 which has its own compact header)
            !isERC404 && h('div', { className: 'detail-header-container' },
                h('div', { className: 'project-header marble-bg' },
                    h('div', { className: 'header-top' },
                        h('div', { className: 'header-title-group' },
                            h('h1', { className: 'project-name' }, this.escapeHtml(project.name)),
                            h('span', {
                                className: `contract-type-badge ${contractType.toLowerCase()}`
                            }, contractType)
                        )
                    ),
                    h('p', { className: 'project-description' },
                        this.escapeHtml(project.description || 'No description available')
                    )
                )
            ),

            // Content container placeholder for ContractTypeRouter
            h('div', { className: 'detail-content-container' },
                h('div', { className: 'contract-router-placeholder' },
                    h('p', null, `Contract interface for ${contractType} will be mounted here`)
                )
            )
        );
    }
}

export default ProjectDetail;
