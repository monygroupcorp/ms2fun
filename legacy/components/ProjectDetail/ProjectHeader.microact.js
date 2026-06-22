/**
 * ProjectHeader - Microact Version
 *
 * Displays project header information with stats and metadata.
 */

import { Component, h } from '../../core/microact-setup.js';

export class ProjectHeader extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            metadataExpanded: false
        };
    }

    get project() {
        return this.props.project;
    }

    toggleMetadata() {
        this.setState({ metadataExpanded: !this.state.metadataExpanded });
    }

    async copyAddress(address) {
        try {
            await navigator.clipboard.writeText(address);
            // Could show feedback via state or popup
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    navigateToFactory(factoryAddress) {
        if (window.router) {
            window.router.navigate(`/factory/${factoryAddress}`);
        } else {
            window.location.href = `/factory/${factoryAddress}`;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    render() {
        const { metadataExpanded } = this.state;
        const project = this.project;

        if (!project) {
            return h('div', { className: 'project-header' }, 'No project data');
        }

        const contractType = project.contractType || 'Unknown';
        const volume = project.stats?.volume || '0 ETH';
        const holders = project.stats?.holders || 0;
        const supply = project.stats?.totalSupply || 0;
        const address = project.address || '';
        const factoryAddress = project.factoryAddress || '';
        const creator = project.creator || '';
        const createdAt = project.createdAt
            ? new Date(project.createdAt).toLocaleDateString()
            : 'Unknown';

        return h('div', { className: 'project-header marble-bg' },
            h('div', { className: 'header-top' },
                h('div', { className: 'header-title-group' },
                    h('h1', { className: 'project-name' }, this.escapeHtml(project.name)),
                    h('span', {
                        className: `contract-type-badge ${contractType.toLowerCase()}`
                    }, contractType)
                ),
                h('div', { className: 'header-actions' })
            ),

            h('p', { className: 'project-description' },
                this.escapeHtml(project.description || 'No description available')
            ),

            h('div', { className: 'project-stats' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Volume:'),
                    h('span', { className: 'stat-value' }, volume)
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Holders:'),
                    h('span', { className: 'stat-value' }, holders)
                ),
                supply > 0 && h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Total Supply:'),
                    h('span', { className: 'stat-value' }, supply)
                )
            ),

            h('div', { className: 'project-metadata-toggle' },
                h('button', {
                    className: 'metadata-toggle-btn',
                    onClick: this.bind(this.toggleMetadata)
                },
                    h('span', { className: 'toggle-text' },
                        metadataExpanded ? 'Hide' : 'Show', ' Contract Details'
                    ),
                    h('span', { className: 'toggle-icon' }, metadataExpanded ? '\u25b2' : '\u25bc')
                )
            ),

            h('div', {
                className: 'project-metadata',
                style: { display: metadataExpanded ? 'block' : 'none' }
            },
                h('div', { className: 'metadata-item' },
                    h('span', { className: 'metadata-label' }, 'Contract Address:'),
                    h('span', { className: 'metadata-value address' }, address),
                    h('button', {
                        className: 'copy-button',
                        'aria-label': 'Copy address',
                        onClick: () => this.copyAddress(address)
                    }, '\ud83d\udccb')
                ),

                factoryAddress && h('div', { className: 'metadata-item' },
                    h('span', { className: 'metadata-label' }, 'Factory:'),
                    h('a', {
                        className: 'metadata-link',
                        href: '#',
                        onClick: (e) => {
                            e.preventDefault();
                            this.navigateToFactory(factoryAddress);
                        }
                    }, `${factoryAddress.slice(0, 10)}...${factoryAddress.slice(-8)}`)
                ),

                creator && h('div', { className: 'metadata-item' },
                    h('span', { className: 'metadata-label' }, 'Creator:'),
                    h('span', { className: 'metadata-value' },
                        `${creator.slice(0, 10)}...${creator.slice(-8)}`
                    )
                ),

                h('div', { className: 'metadata-item' },
                    h('span', { className: 'metadata-label' }, 'Created:'),
                    h('span', { className: 'metadata-value' }, createdAt)
                )
            )
        );
    }
}

export default ProjectHeader;
