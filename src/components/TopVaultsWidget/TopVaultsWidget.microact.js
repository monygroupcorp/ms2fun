/**
 * TopVaultsWidget - Microact Version
 *
 * Shows top 3 vaults by TVL or popularity with toggle.
 * Migrated from template literals to h() hyperscript.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { EmptyState } from '../EmptyState/EmptyState.microact.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import { detectNetwork } from '../../config/network.js';
import queryService from '../../services/QueryService.js';

export class TopVaultsWidget extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            mode: 'tvl', // 'tvl' or 'popularity'
            vaults: [],
            loading: true,
            error: null
        };
        this.vaultMetadata = null;
    }

    async didMount() {
        try {
            await this.loadVaultMetadata();

            // Subscribe to data provider events if using data provider
            if (this.props.useDataProvider) {
                const unsub = eventBus.on('homepage:data', (data) => {
                    if (data.topVaults) {
                        this.handleVaultsData(data.topVaults);
                    }
                });
                this.registerCleanup(unsub);
            } else {
                await this.loadVaults();
            }
        } catch (error) {
            console.error('[TopVaultsWidget] Error initializing:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    handleVaultsData(vaults) {
        if (!Array.isArray(vaults)) return;

        const transformedVaults = vaults.map((vault, index) =>
            this.transformVaultFromQuery(vault, index)
        );

        this.setState({
            vaults: transformedVaults,
            loading: false,
            error: null
        });
    }

    async loadVaultMetadata() {
        try {
            const network = detectNetwork();
            if (network.contracts) {
                const response = await fetch(network.contracts);
                const config = await response.json();
                this.vaultMetadata = {};
                if (config.vaults) {
                    for (const vault of config.vaults) {
                        this.vaultMetadata[vault.address.toLowerCase()] = vault;
                    }
                }
            }
        } catch (error) {
            console.warn('[TopVaultsWidget] Could not load vault metadata:', error);
            this.vaultMetadata = {};
        }
    }

    async loadVaults() {
        try {
            this.setState({ loading: true, error: null });

            const { mode } = this.state;
            const sortBy = mode === 'tvl' ? 0 : 1;

            const rawVaults = await queryService.getVaultLeaderboard(sortBy, 3);
            const vaults = rawVaults.map((vault, index) =>
                this.transformVaultFromQuery(vault, index)
            );

            this.setState({ vaults, loading: false });
        } catch (error) {
            console.error('[TopVaultsWidget] Error loading vaults:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    transformVaultFromQuery(vault, index) {
        const metadata = this.vaultMetadata?.[vault.vault?.toLowerCase()] || {};
        const tvlEth = parseFloat(vault.tvl || '0');
        const tvlWei = (tvlEth * 1e18).toString();

        return {
            rank: index + 1,
            address: vault.vault,
            name: metadata.tag || vault.name || 'Unnamed Vault',
            type: 'Ultra Alignment',
            targetAsset: metadata.alignmentTokenSymbol || 'ETH',
            tvl: this.formatTVL(tvlWei),
            tvlRaw: tvlWei,
            popularity: vault.instanceCount || 0,
            description: metadata.description || ''
        };
    }

    formatTVL(value) {
        try {
            const eth = parseFloat(value) / 1e18;
            if (eth >= 1000) return `${(eth / 1000).toFixed(2)}K Ξ`;
            if (eth >= 1) return `${eth.toFixed(2)} Ξ`;
            if (eth >= 0.001) return `${eth.toFixed(4)} Ξ`;
            return `${eth.toFixed(6)} Ξ`;
        } catch (error) {
            return '0 Ξ';
        }
    }

    handleModeToggleTvl() {
        if (this.state.mode !== 'tvl') {
            this.setState({ mode: 'tvl' });
            this.loadVaults();
        }
    }

    handleModeTogglePopularity() {
        if (this.state.mode !== 'popularity') {
            this.setState({ mode: 'popularity' });
            this.loadVaults();
        }
    }

    handleVaultClick(address) {
        if (window.router) {
            window.router.navigate(`/vaults/${address}`);
        } else {
            window.location.href = `/vaults/${address}`;
        }
    }

    handleViewAllClick() {
        if (window.router) {
            window.router.navigate('/vaults');
        } else {
            window.location.href = '/vaults';
        }
    }

    render() {
        const { mode, vaults, loading, error } = this.state;

        return h('div', { className: 'top-vaults-widget' },
            // Header with mode toggle
            h('div', { className: 'widget-header' },
                h('h3', { className: 'widget-title' }, 'Top Vaults'),
                h('div', { className: 'mode-toggle' },
                    h('button', {
                        className: `mode-btn ${mode === 'tvl' ? 'active' : ''}`,
                        onClick: this.bind(this.handleModeToggleTvl)
                    }, 'TVL'),
                    h('button', {
                        className: `mode-btn ${mode === 'popularity' ? 'active' : ''}`,
                        onClick: this.bind(this.handleModeTogglePopularity)
                    }, 'Popularity')
                )
            ),

            // Content
            h('div', { className: 'widget-content' },
                this.renderContent(vaults, loading, error, mode)
            ),

            // Footer (only when we have vaults)
            !loading && !error && vaults.length > 0 &&
                h('div', { className: 'widget-footer' },
                    h('button', {
                        className: 'view-all-btn',
                        onClick: this.bind(this.handleViewAllClick)
                    }, 'View All Vaults →')
                )
        );
    }

    renderContent(vaults, loading, error, mode) {
        if (loading) {
            return h('div', { className: 'widget-loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading vaults...')
            );
        }

        if (error) {
            return h('div', { className: 'widget-error' },
                h('p', null, error)
            );
        }

        if (vaults.length === 0) {
            return h(EmptyState, {
                variant: 'vaults',
                showCTA: false
            });
        }

        return h('div', { className: 'vault-cards-grid' },
            ...vaults.map(vault => this.renderVaultCard(vault, mode))
        );
    }

    renderVaultCard(vault, mode) {
        const assetIcon = vault.targetAsset ? getAssetIcon(vault.targetAsset) : '💰';

        return h('div', {
            className: 'vault-card',
            key: vault.address,
            onClick: () => this.handleVaultClick(vault.address)
        },
            h('div', { className: 'vault-card-header' },
                h('div', { className: 'vault-rank-badge' }, `#${vault.rank}`),
                h('div', {
                    className: 'vault-asset-icon',
                    title: vault.targetAsset || 'Generic'
                },
                    h('span', { className: 'asset-icon' }, assetIcon)
                )
            ),
            h('div', { className: 'vault-card-body' },
                h('h4', { className: 'vault-card-name' }, vault.name),
                h('p', { className: 'vault-card-type' }, vault.type),
                h('div', { className: 'vault-card-metric' },
                    h('span', { className: 'metric-label' },
                        mode === 'tvl' ? 'TVL' : 'Popularity'
                    ),
                    h('span', { className: 'metric-value' },
                        mode === 'tvl' ? vault.tvl : vault.popularity
                    )
                )
            )
        );
    }
}

export default TopVaultsWidget;
