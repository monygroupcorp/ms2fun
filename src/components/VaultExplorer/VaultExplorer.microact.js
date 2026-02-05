/**
 * VaultExplorer - Microact Version
 *
 * Full-page vault discovery with pagination, TVL/popularity toggle.
 * Migrated from template literals to h() hyperscript.
 *
 * NOTE: This component uses QueryService.getVaultLeaderboard() which
 * fetches from MasterRegistry's vault enumeration. This is a candidate
 * for EventIndexer migration.
 * See: docs/plans/2026-02-04-contract-event-migration.md
 */

import { Component, h } from '../../core/microact-setup.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import queryService from '../../services/QueryService.js';
import { detectNetwork } from '../../config/network.js';
import { isPreLaunch } from '../../config/contractConfig.js';

export class VaultExplorer extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            mode: 'tvl',
            vaults: [],
            totalVaults: 0,
            currentPage: 0,
            pageSize: 10,
            loading: true,
            error: null
        };
        this.vaultMetadata = null;
    }

    async didMount() {
        try {
            await this.loadVaultMetadata();
            await this.loadVaults();
        } catch (error) {
            console.error('[VaultExplorer] Error initializing:', error);
            this.setState({ loading: false, error: 'Failed to load vaults' });
        }
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
            console.warn('[VaultExplorer] Could not load vault metadata:', error);
            this.vaultMetadata = {};
        }
    }

    async loadVaults() {
        try {
            this.setState({ loading: true, error: null });

            const preLaunch = await isPreLaunch();
            if (preLaunch) {
                this.setState({ vaults: [], totalVaults: 0, loading: false });
                return;
            }

            const { mode, currentPage, pageSize } = this.state;
            const sortBy = mode === 'tvl' ? 0 : 1;
            const rawVaults = await queryService.getVaultLeaderboard(sortBy, 100);

            const startIndex = currentPage * pageSize;
            const endIndex = startIndex + pageSize;
            const paginatedVaults = rawVaults.slice(startIndex, endIndex);

            const vaults = paginatedVaults.map((vault, index) =>
                this.transformVault(vault, startIndex + index)
            );

            this.setState({ vaults, totalVaults: rawVaults.length, loading: false });
        } catch (error) {
            console.error('[VaultExplorer] Error loading vaults:', error);
            this.setState({ loading: false, error: 'Failed to load vaults' });
        }
    }

    transformVault(vault, index) {
        const vaultAddress = vault.vault || vault.vaultAddress || vault.address;
        const metadata = this.vaultMetadata?.[vaultAddress?.toLowerCase()] || {};
        const tvlEth = parseFloat(vault.tvl || '0');
        const tvlWei = (tvlEth * 1e18).toString();

        return {
            rank: index + 1,
            address: vaultAddress,
            name: metadata.tag || vault.name || 'Unnamed Vault',
            type: 'Ultra Alignment',
            targetAsset: metadata.alignmentTokenSymbol || 'ETH',
            tvl: this.formatTVL(tvlWei),
            tvlRaw: tvlWei,
            popularity: vault.instanceCount || 0,
            instanceCount: vault.instanceCount || 0,
            description: metadata.description || '',
            isActive: true
        };
    }

    formatTVL(value) {
        try {
            const eth = parseFloat(value) / 1e18;
            if (eth >= 1000000) return `$${(eth / 1000000).toFixed(2)}M`;
            if (eth >= 1000) return `$${(eth / 1000).toFixed(2)}K`;
            return `$${eth.toFixed(2)}`;
        } catch (error) {
            return '$0';
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    handleModeToggleTvl() {
        if (this.state.mode !== 'tvl') {
            this.setState({ mode: 'tvl', currentPage: 0 });
            this.loadVaults();
        }
    }

    handleModeTogglePopularity() {
        if (this.state.mode !== 'popularity') {
            this.setState({ mode: 'popularity', currentPage: 0 });
            this.loadVaults();
        }
    }

    handlePageChange(newPage) {
        const { currentPage, totalVaults, pageSize } = this.state;
        const maxPage = Math.ceil(totalVaults / pageSize) - 1;

        if (newPage !== currentPage && newPage >= 0 && newPage <= maxPage) {
            this.setState({ currentPage: newPage });
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

    handleBackClick() {
        if (window.router) {
            window.router.navigate('/');
        } else {
            window.location.href = '/';
        }
    }

    render() {
        const { mode, vaults, totalVaults, currentPage, pageSize, loading, error } = this.state;
        const totalPages = Math.ceil(totalVaults / pageSize);

        return h('div', { className: 'vault-explorer' },
            // Header
            h('div', { className: 'vault-explorer-header' },
                h('button', {
                    className: 'back-btn',
                    onClick: this.bind(this.handleBackClick)
                }, '← Back to Home'),
                h('h1', { className: 'page-title' }, 'Vault Explorer'),
                h('p', { className: 'page-subtitle' }, 'Discover and explore all registered vaults')
            ),

            // Controls
            h('div', { className: 'vault-explorer-controls' },
                h('div', { className: 'mode-toggle' },
                    h('button', {
                        className: `mode-btn ${mode === 'tvl' ? 'active' : ''}`,
                        onClick: this.bind(this.handleModeToggleTvl)
                    }, 'TVL'),
                    h('button', {
                        className: `mode-btn ${mode === 'popularity' ? 'active' : ''}`,
                        onClick: this.bind(this.handleModeTogglePopularity)
                    }, 'Popularity')
                ),
                h('div', { className: 'vault-count' },
                    'Total Vaults: ',
                    h('strong', null, totalVaults)
                )
            ),

            // Content
            h('div', { className: 'vault-explorer-content' },
                this.renderContent(vaults, loading, error, mode)
            ),

            // Pagination
            !loading && !error && totalPages > 1 &&
                this.renderPagination(currentPage, totalPages)
        );
    }

    renderContent(vaults, loading, error, mode) {
        if (loading) {
            return h('div', { className: 'explorer-loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading vaults...')
            );
        }

        if (error) {
            return h('div', { className: 'explorer-error' },
                h('p', null, error),
                h('button', {
                    className: 'retry-btn',
                    onClick: this.bind(this.loadVaults)
                }, 'Try Again')
            );
        }

        if (vaults.length === 0) {
            return h('div', { className: 'explorer-empty' },
                h('p', null, 'No vaults found')
            );
        }

        return h('div', { className: 'vault-table-container' },
            h('table', { className: 'vault-table' },
                h('thead', null,
                    h('tr', null,
                        h('th', { className: 'col-rank' }, '#'),
                        h('th', { className: 'col-name' }, 'Vault'),
                        h('th', { className: 'col-type' }, 'Type'),
                        h('th', { className: 'col-asset' }, 'Asset'),
                        h('th', { className: 'col-metric' }, mode === 'tvl' ? 'TVL' : 'Popularity'),
                        h('th', { className: 'col-projects' }, 'Projects'),
                        h('th', { className: 'col-status' }, 'Status')
                    )
                ),
                h('tbody', null,
                    ...vaults.map(vault => this.renderVaultRow(vault, mode))
                )
            )
        );
    }

    renderVaultRow(vault, mode) {
        const assetIcon = vault.targetAsset ? getAssetIcon(vault.targetAsset) : '💰';
        const statusClass = vault.isActive ? 'status-active' : 'status-inactive';
        const statusText = vault.isActive ? 'Active' : 'Inactive';

        return h('tr', {
            className: 'vault-row',
            key: vault.address,
            onClick: () => this.handleVaultClick(vault.address)
        },
            h('td', { className: 'col-rank' },
                h('span', { className: 'rank-badge' }, vault.rank)
            ),
            h('td', { className: 'col-name' },
                h('div', { className: 'vault-name-cell' },
                    h('span', { className: 'vault-name' }, vault.name),
                    h('span', { className: 'vault-address' }, this.truncateAddress(vault.address))
                )
            ),
            h('td', { className: 'col-type' }, vault.type),
            h('td', { className: 'col-asset' },
                h('span', { className: 'asset-icon' }, assetIcon),
                h('span', { className: 'asset-symbol' }, vault.targetAsset)
            ),
            h('td', { className: 'col-metric' },
                h('span', { className: 'metric-value' }, mode === 'tvl' ? vault.tvl : vault.popularity)
            ),
            h('td', { className: 'col-projects' }, vault.instanceCount),
            h('td', { className: 'col-status' },
                h('span', { className: `status-badge ${statusClass}` }, statusText)
            )
        );
    }

    renderPagination(currentPage, totalPages) {
        const maxVisiblePages = 5;
        let startPage = Math.max(0, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages - 1, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(0, endPage - maxVisiblePages + 1);
        }

        const pages = [];
        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }

        return h('div', { className: 'pagination' },
            h('button', {
                className: `page-btn prev-btn ${currentPage === 0 ? 'disabled' : ''}`,
                disabled: currentPage === 0,
                onClick: () => this.handlePageChange(currentPage - 1)
            }, '← Prev'),

            h('div', { className: 'page-numbers' },
                ...pages.map(page =>
                    h('button', {
                        className: `page-btn page-num ${page === currentPage ? 'active' : ''}`,
                        key: page,
                        onClick: () => this.handlePageChange(page)
                    }, page + 1)
                )
            ),

            h('button', {
                className: `page-btn next-btn ${currentPage >= totalPages - 1 ? 'disabled' : ''}`,
                disabled: currentPage >= totalPages - 1,
                onClick: () => this.handlePageChange(currentPage + 1)
            }, 'Next →')
        );
    }
}

export default VaultExplorer;
