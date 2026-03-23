/**
 * ProjectDetail - Microact Version
 *
 * Main component for displaying project details.
 * Loads project data and routes to appropriate interface via ContractTypeRouter.
 */

import { Component, h } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { ContractTypeRouter } from './ContractTypeRouter.microact.js';
import { ProjectPageSkeleton } from '../Skeletons/Skeletons.js';

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

    getNavSource() {
        return window.history.state?.from || null;
    }

    handleHomeClick(e) {
        if (e) e.preventDefault();
        if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    handleSourceClick(e) {
        if (e) e.preventDefault();
        const from = this.getNavSource();
        const path = from === 'projects' ? '/discover' : from === 'activity' ? '/activity' : '/';
        if (window.router) {
            window.router.navigate(path);
        } else {
            window.location.href = path;
        }
    }

    renderBreadcrumb() {
        const from = this.getNavSource();
        const sourceLabels = { projects: 'Projects', activity: 'Activity' };
        const sourceLabel = sourceLabels[from];

        return h('div', { className: 'breadcrumb' },
            h('a', { href: '/', className: 'breadcrumb-wordmark', onClick: this.bind(this.handleHomeClick) },
                'MS2', h('span', { className: 'logo-tld' }, '.fun')
            ),
            sourceLabel && h('span', { className: 'breadcrumb-separator' }, '/'),
            sourceLabel && h('a', {
                href: from === 'projects' ? '/discover' : `/${from}`,
                onClick: this.bind(this.handleSourceClick)
            }, sourceLabel)
        );
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
            return ProjectPageSkeleton();
        }

        if (error) {
            return h('div', { className: 'project-detail' },
                h('div', { className: 'detail-navigation' }, this.renderBreadcrumb()),
                h('div', { className: 'error-state' },
                    h('h2', null, 'Error'),
                    h('p', { className: 'error-message' }, this.escapeHtml(error))
                )
            );
        }

        if (!project) {
            return h('div', { className: 'project-detail' },
                h('div', { className: 'detail-navigation' }, this.renderBreadcrumb()),
                h('div', { className: 'error-state' },
                    h('h2', null, 'Project Not Found'),
                    h('p', null, "The project you're looking for doesn't exist.")
                )
            );
        }

        const contractType = project.contractType?.toUpperCase() || '';
        const isERC404 = contractType === 'ERC404' || contractType === 'ERC404BONDING';
        const isERC1155 = contractType === 'ERC1155';
        const isERC721 = contractType === 'ERC721' || contractType === 'ERC721AUCTION';
        const hasOwnHeader = isERC404 || isERC1155 || isERC721;

        return h('div', { className: 'project-detail content' },
            h('div', { className: 'detail-navigation' }, this.renderBreadcrumb()),

            // Generic header for types that don't have their own page component
            !hasOwnHeader && h('div', { className: 'detail-header-container' },
                h('div', { className: 'project-header' },
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

            // Content container with ContractTypeRouter
            h('div', { className: 'detail-content-container' },
                h(ContractTypeRouter, {
                    projectId: this.projectId,
                    contractType: contractType,
                    project: project
                })
            )
        );
    }
}

export default ProjectDetail;
