/**
 * FactoryExploration - V2 Gallery Brutalism
 *
 * Displays all authorized project factories in a grid layout.
 * Fetches factory data from MasterService and enriches with metadata.
 * Follows vault-explorer-demo.html structural patterns adapted for factories.
 */

import { Component, h } from '../../core/microact-setup.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import { enrichFactoryData } from '../../utils/factoryMetadata.js';
import { getExplorerUrl } from '../../config/network.js';

export class FactoryExploration extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            factories: [],
            loading: true,
            error: null
        };
    }

    async didMount() {
        await stylesheetLoader.load('/src/core/route-factories-v2.css', 'route:factories');
        await this.loadFactories();
    }

    async loadFactories() {
        try {
            this.setState({ loading: true, error: null });

            const { config } = this.props;
            if (!config || !config.factories) {
                this.setState({ loading: false, factories: [] });
                return;
            }

            // Instance count per type from config
            const instanceCounts = {
                ERC404: (config.instances?.erc404 || []).length,
                ERC1155: (config.instances?.erc1155 || []).length,
                ERC721: (config.instances?.erc721 || []).length,
            };

            const enrichedFactories = config.factories.map(f => {
                const factory = {
                    address: f.address,
                    type: f.type,
                    title: f.title,
                    displayTitle: f.displayTitle
                };
                return enrichFactoryData(factory, instanceCounts[f.type] || 0, []);
            });

            this.setState({
                factories: enrichedFactories,
                loading: false
            });
        } catch (error) {
            console.error('[FactoryExploration] Error loading factories:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load factories'
            });
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return address.slice(0, 6) + '...' + address.slice(-4);
    }

    handleNavigate(path) {
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate(path);
        } else if (window.router) {
            window.router.navigate(path);
        } else {
            window.location.href = path;
        }
    }

    renderFactoryCard(factory) {
        const displayName = factory.displayTitle || factory.name || (factory.type + ' Factory');
        const description = factory.description || 'Create ' + factory.type + ' contracts with customizable parameters.';
        const instanceCount = factory.instanceCount || 0;
        const features = factory.features || [];
        const truncated = this.truncateAddress(factory.address);

        return h('div', { className: 'factory-card' },
            // Header: name + type badge
            h('div', { className: 'factory-card-header' },
                h('div', { className: 'factory-card-name' }, displayName),
                h('div', { className: 'factory-card-badge' }, factory.type)
            ),

            // Description
            h('p', { className: 'factory-card-description' }, description),

            // Stats
            h('div', { className: 'factory-card-stats' },
                h('div', { className: 'factory-card-stat' },
                    h('div', { className: 'factory-card-stat-label' }, 'Instances'),
                    h('div', { className: 'factory-card-stat-value' }, String(instanceCount))
                ),
                h('div', { className: 'factory-card-stat' },
                    h('div', { className: 'factory-card-stat-label' }, 'Type'),
                    h('div', { className: 'factory-card-stat-value' }, factory.type)
                ),
                h('div', { className: 'factory-card-stat' },
                    h('div', { className: 'factory-card-stat-label' }, 'Features'),
                    h('div', { className: 'factory-card-stat-value' }, String(features.length))
                ),
                h('div', { className: 'factory-card-stat' },
                    h('div', { className: 'factory-card-stat-label' }, 'Status'),
                    h('div', { className: 'factory-card-stat-value' }, 'Active')
                )
            ),

            // Contract address
            h('div', { className: 'factory-card-meta' },
                h('a', {
                    className: 'factory-card-address',
                    href: getExplorerUrl(factory.address) || '#',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    onClick: (e) => e.stopPropagation()
                }, truncated)
            ),

            // Action button
            h('div', { className: 'factory-card-action' },
                h('button', {
                    className: 'btn btn-primary btn-full',
                    onClick: () => this.handleNavigate(`/create?type=${factory.type}`)
                }, 'Create Project')
            )
        );
    }

    renderLoading() {
        return h('div', { className: 'content' },
            h('header', { className: 'factories-page-header' },
                h('h1', { className: 'factories-page-title' }, 'Factories'),
                h('p', { className: 'factories-page-description' }, 'Loading factory data...')
            ),
            h('div', { className: 'factories-loading' },
                h('div', { className: 'factories-loading-text' }, 'Loading factories...')
            )
        );
    }

    renderError() {
        return h('div', { className: 'content' },
            h('header', { className: 'factories-page-header' },
                h('h1', { className: 'factories-page-title' }, 'Factories'),
                h('p', { className: 'factories-page-description' }, 'An error occurred while loading factories.')
            ),
            h('div', { className: 'factories-error' },
                h('p', { className: 'factories-error-message' }, this.state.error),
                h('button', {
                    className: 'btn btn-primary',
                    onClick: () => this.loadFactories()
                }, 'Retry')
            )
        );
    }

    renderEmpty() {
        return h('div', { className: 'content' },
            h('header', { className: 'factories-page-header' },
                h('h1', { className: 'factories-page-title' }, 'Factories'),
                h('p', { className: 'factories-page-description' },
                    'Factories are smart contracts that deploy new project instances. Each factory type creates a different kind of on-chain project.'
                )
            ),
            h('div', { className: 'factories-empty' },
                h('h2', { className: 'factories-empty-title' }, 'No Factories Available'),
                h('p', { className: 'factories-empty-description' },
                    'There are no authorized factories available at this time.'
                ),
                h('button', {
                    className: 'btn btn-primary',
                    onClick: () => this.handleNavigate('/')
                }, 'Back to Home')
            )
        );
    }

    render() {
        const { factories, loading, error } = this.state;

        if (loading) {
            return this.renderLoading();
        }

        if (error) {
            return this.renderError();
        }

        if (factories.length === 0) {
            return this.renderEmpty();
        }

        const factoryCountText = factories.length + (factories.length === 1 ? ' Factory' : ' Factories');

        return h('div', { className: 'content' },
            // Page Header
            h('header', { className: 'factories-page-header' },
                h('h1', { className: 'factories-page-title' }, 'Factories'),
                h('p', { className: 'factories-page-description' },
                    'Factories are smart contracts that deploy new project instances. Each factory type creates a different kind of on-chain project with its own mechanics, tokenomics, and features.'
                )
            ),

            // Section Header
            h('section', null,
                h('div', { className: 'factories-section-header' },
                    h('h2', { className: 'factories-section-title' }, 'Active Factories'),
                    h('div', { className: 'factories-section-count' }, factoryCountText)
                ),

                // Factory Grid
                h('div', { className: 'factory-grid' },
                    ...factories.map((factory) => this.renderFactoryCard(factory))
                )
            ),

            // Bottom spacer
            h('div', { style: 'height: 80px;' })
        );
    }
}

export default FactoryExploration;
