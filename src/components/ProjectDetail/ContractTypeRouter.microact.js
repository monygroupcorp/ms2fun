/**
 * ContractTypeRouter - Microact Version
 *
 * Routes to appropriate interface based on contract type.
 */

import { Component, h } from '../../core/microact-setup.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { ERC1155ProjectPage } from '../ERC1155/ERC1155ProjectPage.microact.js';
import { ERC721ProjectPage } from '../ERC721/ERC721ProjectPage.microact.js';
import { ERC404ProjectPage } from '../ERC404/ERC404ProjectPage.microact.js';

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
            return h('div', { className: 'contract-type-router loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading interface...')
            );
        }

        if (!this.contractType) {
            return h('div', { className: 'contract-type-router' },
                h('div', { className: 'placeholder-message' },
                    h('p', null, 'Contract type not specified')
                )
            );
        }

        const type = this.contractType.toUpperCase();

        if (type === 'ERC404' || type === 'ERC404BONDING') {
            if (!adapter) {
                return h('div', { className: 'contract-type-router erc404 error' },
                    h('p', null, 'Failed to load contract adapter')
                );
            }

            return h('div', { className: 'contract-type-router erc404' },
                h(ERC404ProjectPage, {
                    projectId: this.projectId,
                    adapter: adapter,
                    project: project
                })
            );
        }

        if (type === 'ERC1155') {
            if (!adapter) {
                return h('div', { className: 'contract-type-router erc1155 error' },
                    h('p', null, 'Failed to load contract adapter')
                );
            }

            return h('div', { className: 'contract-type-router erc1155' },
                h(ERC1155ProjectPage, {
                    projectId: this.projectId,
                    adapter: adapter,
                    project: project
                })
            );
        }

        if (type === 'ERC721' || type === 'ERC721AUCTION') {
            if (!adapter) {
                return h('div', { className: 'contract-type-router erc721 error' },
                    h('p', null, 'Failed to load contract adapter')
                );
            }

            return h('div', { className: 'contract-type-router erc721' },
                h(ERC721ProjectPage, {
                    projectId: this.projectId,
                    adapter: adapter,
                    project: project
                })
            );
        }

        return h('div', { className: 'contract-type-router unknown' },
            h('div', { className: 'placeholder-message' },
                h('p', null, `Unknown contract type: ${this.escapeHtml(this.contractType)}`)
            )
        );
    }
}

export default ContractTypeRouter;
