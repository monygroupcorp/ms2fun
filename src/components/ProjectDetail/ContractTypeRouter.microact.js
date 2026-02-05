/**
 * ContractTypeRouter - Microact Version
 *
 * Routes to appropriate interface based on contract type.
 */

import { Component, h } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class ContractTypeRouter extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            adapter: null,
            loading: true,
            project: null
        };
    }

    get contractType() {
        return this.props.contractType;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadAdapter();
    }

    async loadAdapter() {
        try {
            this.setState({ loading: true });
            const projectService = serviceFactory.getProjectService();
            const projectRegistry = serviceFactory.getProjectRegistry();

            let adapter = projectService.getAdapter(this.projectId);
            let project = await projectRegistry.getProject(this.projectId);

            if (!adapter) {
                if (!project) {
                    try {
                        await projectService.loadProject(
                            this.projectId,
                            this.projectId,
                            this.contractType || null
                        );
                        adapter = projectService.getAdapter(this.projectId);
                    } catch (loadError) {
                        console.warn('[ContractTypeRouter] Failed to load project directly:', loadError);
                    }
                }

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
            }

            this.setState({ adapter, project, loading: false });
        } catch (error) {
            console.error('[ContractTypeRouter] Failed to load adapter:', error);
            this.setState({ loading: false });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    render() {
        const { loading, adapter, project } = this.state;

        if (loading) {
            return h('div', { className: 'contract-type-router loading marble-bg' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading interface...')
            );
        }

        if (!this.contractType) {
            return h('div', { className: 'contract-type-router marble-bg' },
                h('div', { className: 'placeholder-message' },
                    h('p', null, 'Contract type not specified')
                )
            );
        }

        const type = this.contractType.toUpperCase();

        if (type === 'ERC404' || type === 'ERC404BONDING') {
            if (!adapter) {
                return h('div', { className: 'contract-type-router erc404 error marble-bg' },
                    h('p', null, 'Failed to load contract adapter')
                );
            }

            // ERC404 page placeholder - actual component would be mounted
            return h('div', { className: 'contract-type-router erc404' },
                h('div', { className: 'erc404-page-placeholder' },
                    h('p', null, 'ERC404 Project Page - mount ERC404ProjectPage here'),
                    h('p', { className: 'debug-info' },
                        `Project: ${project?.name || 'Unknown'} | Address: ${this.projectId}`
                    )
                )
            );
        }

        if (type === 'ERC1155') {
            if (!adapter) {
                return h('div', { className: 'contract-type-router erc1155 error marble-bg' },
                    h('p', null, 'Failed to load contract adapter')
                );
            }

            // ERC1155 layout placeholder
            return h('div', { className: 'contract-type-router erc1155 marble-bg' },
                h('div', { className: 'erc1155-gallery' },
                    h('p', null, 'Edition Gallery - mount EditionGallery here')
                ),
                h('div', { className: 'erc1155-comments' },
                    h('p', null, 'Comment Feed - mount ProjectCommentFeed here')
                ),
                h('div', { className: 'erc1155-admin-button-float' })
            );
        }

        return h('div', { className: 'contract-type-router unknown marble-bg' },
            h('div', { className: 'placeholder-message' },
                h('p', null, `Unknown contract type: ${this.escapeHtml(this.contractType)}`)
            )
        );
    }
}

export default ContractTypeRouter;
