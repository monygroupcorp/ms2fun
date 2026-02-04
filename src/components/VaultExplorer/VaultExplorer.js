import { Component } from '../../core/Component.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import serviceFactory from '../../services/ServiceFactory.js';
import queryService from '../../services/QueryService.js';
import { detectNetwork } from '../../config/network.js';
import { isPreLaunch } from '../../config/contractConfig.js';

/**
 * VaultExplorer component
 * Full-page vault discovery with pagination, TVL/popularity toggle, and click-through to detail
 */
export class VaultExplorer extends Component {
    constructor() {
        super();
        this.state = {
            mode: 'tvl', // 'tvl' or 'popularity'
            vaults: [],
            totalVaults: 0,
            currentPage: 0,
            pageSize: 10,
            loading: true,
            error: null
        };
        this.vaultMetadata = null;
    }

    async onMount() {
        try {
            await this.loadVaultMetadata();
            await this.loadVaults();
        } catch (error) {
            console.error('[VaultExplorer] Error initializing:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    /**
     * Load vault metadata from contracts.local.json for alignment token info
     */
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

            // Check for pre-launch mode (mainnet but contracts not deployed)
            const preLaunch = await isPreLaunch();
            if (preLaunch) {
                console.log('[VaultExplorer] Pre-launch mode: no vaults deployed yet');
                this.setState({
                    vaults: [],
                    totalVaults: 0,
                    loading: false
                });
                return;
            }

            const { mode, currentPage, pageSize } = this.state;

            // Use QueryService for cached/batched vault data
            // sortBy: 0 = TVL, 1 = popularity
            const sortBy = mode === 'tvl' ? 0 : 1;
            const rawVaults = await queryService.getVaultLeaderboard(sortBy, 100);

            // Apply pagination client-side
            const startIndex = currentPage * pageSize;
            const endIndex = startIndex + pageSize;
            const paginatedVaults = rawVaults.slice(startIndex, endIndex);

            // Transform to display format
            const vaults = paginatedVaults.map((vault, index) =>
                this.transformVaultFromQuery(vault, startIndex + index)
            );

            this.setState({
                vaults,
                totalVaults: rawVaults.length,
                loading: false
            });
        } catch (error) {
            console.error('[VaultExplorer] Error loading vaults:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    /**
     * Transform contract vault data to display format
     */
    transformVault(vault, index) {
        const metadata = this.vaultMetadata?.[vault.vaultAddress?.toLowerCase()] || {};
        const tvlEth = parseFloat(vault.tvl || '0');
        const tvlWei = (tvlEth * 1e18).toString();

        return {
            rank: index + 1,
            address: vault.vaultAddress,
            name: metadata.tag || vault.name || 'Unnamed Vault',
            type: this.formatVaultType(vault.vaultType),
            targetAsset: metadata.alignmentTokenSymbol || 'ETH',
            tvl: this.formatTVL(tvlWei),
            tvlRaw: tvlWei,
            popularity: vault.instanceCount || 0,
            instanceCount: vault.instanceCount || 0,
            description: metadata.description || '',
            isActive: vault.isActive !== false
        };
    }

    /**
     * Transform QueryService VaultSummary to display format
     */
    transformVaultFromQuery(vault, index) {
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

    formatVaultType(vaultType) {
        if (!vaultType) return 'Ultra Alignment';
        return vaultType
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    formatTVL(value) {
        try {
            const eth = parseFloat(value) / 1e18;
            if (eth >= 1000000) {
                return `$${(eth / 1000000).toFixed(2)}M`;
            } else if (eth >= 1000) {
                return `$${(eth / 1000).toFixed(2)}K`;
            } else {
                return `$${eth.toFixed(2)}`;
            }
        } catch (error) {
            return '$0';
        }
    }

    async handleModeToggle(newMode) {
        if (newMode !== this.state.mode) {
            this.setState({ mode: newMode, currentPage: 0 });
            await this.loadVaults();
        }
    }

    async handlePageChange(newPage) {
        if (newPage !== this.state.currentPage && newPage >= 0) {
            const maxPage = Math.ceil(this.state.totalVaults / this.state.pageSize) - 1;
            if (newPage <= maxPage) {
                this.setState({ currentPage: newPage });
                await this.loadVaults();
            }
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

        return `
            <div class="vault-explorer">
                <div class="vault-explorer-header">
                    <button class="back-btn" data-ref="back-btn">
                        ← Back to Home
                    </button>
                    <h1 class="page-title">Vault Explorer</h1>
                    <p class="page-subtitle">Discover and explore all registered vaults</p>
                </div>

                <div class="vault-explorer-controls">
                    <div class="mode-toggle" data-ref="mode-toggle">
                        <button
                            class="mode-btn ${mode === 'tvl' ? 'active' : ''}"
                            data-mode="tvl"
                            data-ref="tvl-btn">
                            TVL
                        </button>
                        <button
                            class="mode-btn ${mode === 'popularity' ? 'active' : ''}"
                            data-mode="popularity"
                            data-ref="popularity-btn">
                            Popularity
                        </button>
                    </div>
                    <div class="vault-count">
                        Total Vaults: <strong>${totalVaults}</strong>
                    </div>
                </div>

                <div class="vault-explorer-content">
                    ${this.renderContent(vaults, loading, error, mode)}
                </div>

                ${!loading && !error && totalPages > 1 ? this.renderPagination(currentPage, totalPages) : ''}
            </div>
        `;
    }

    renderContent(vaults, loading, error, mode) {
        if (loading) {
            return `
                <div class="explorer-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading vaults...</p>
                </div>
            `;
        }

        if (error) {
            return `
                <div class="explorer-error">
                    <p>${this.escapeHtml(error)}</p>
                    <button class="retry-btn" data-ref="retry-btn">Try Again</button>
                </div>
            `;
        }

        if (vaults.length === 0) {
            return `
                <div class="explorer-empty">
                    <p>No vaults found</p>
                </div>
            `;
        }

        return `
            <div class="vault-table-container">
                <table class="vault-table">
                    <thead>
                        <tr>
                            <th class="col-rank">#</th>
                            <th class="col-name">Vault</th>
                            <th class="col-type">Type</th>
                            <th class="col-asset">Asset</th>
                            <th class="col-metric">${mode === 'tvl' ? 'TVL' : 'Popularity'}</th>
                            <th class="col-projects">Projects</th>
                            <th class="col-status">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${vaults.map(vault => this.renderVaultRow(vault, mode)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderVaultRow(vault, mode) {
        const assetIcon = vault.targetAsset ? getAssetIcon(vault.targetAsset) : '💰';
        const statusClass = vault.isActive ? 'status-active' : 'status-inactive';
        const statusText = vault.isActive ? 'Active' : 'Inactive';

        return `
            <tr class="vault-row" data-address="${this.escapeHtml(vault.address)}" data-ref="vault-row">
                <td class="col-rank">
                    <span class="rank-badge">${vault.rank}</span>
                </td>
                <td class="col-name">
                    <div class="vault-name-cell">
                        <span class="vault-name">${this.escapeHtml(vault.name)}</span>
                        <span class="vault-address">${this.truncateAddress(vault.address)}</span>
                    </div>
                </td>
                <td class="col-type">${this.escapeHtml(vault.type)}</td>
                <td class="col-asset">
                    <span class="asset-icon">${assetIcon}</span>
                    <span class="asset-symbol">${this.escapeHtml(vault.targetAsset)}</span>
                </td>
                <td class="col-metric">
                    <span class="metric-value">${mode === 'tvl' ? vault.tvl : vault.popularity}</span>
                </td>
                <td class="col-projects">${vault.instanceCount}</td>
                <td class="col-status">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
            </tr>
        `;
    }

    renderPagination(currentPage, totalPages) {
        const pages = [];
        const maxVisiblePages = 5;

        let startPage = Math.max(0, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages - 1, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(0, endPage - maxVisiblePages + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }

        return `
            <div class="pagination">
                <button
                    class="page-btn prev-btn ${currentPage === 0 ? 'disabled' : ''}"
                    data-page="${currentPage - 1}"
                    data-ref="prev-btn"
                    ${currentPage === 0 ? 'disabled' : ''}>
                    ← Prev
                </button>
                <div class="page-numbers">
                    ${pages.map(page => `
                        <button
                            class="page-btn page-num ${page === currentPage ? 'active' : ''}"
                            data-page="${page}"
                            data-ref="page-btn">
                            ${page + 1}
                        </button>
                    `).join('')}
                </div>
                <button
                    class="page-btn next-btn ${currentPage >= totalPages - 1 ? 'disabled' : ''}"
                    data-page="${currentPage + 1}"
                    data-ref="next-btn"
                    ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
                    Next →
                </button>
            </div>
        `;
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Back button
        const backBtn = this.getRef('back-btn', '.back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleBackClick());
        }

        // Mode toggle buttons
        const tvlBtn = this.getRef('tvl-btn', '.mode-btn[data-mode="tvl"]');
        const popularityBtn = this.getRef('popularity-btn', '.mode-btn[data-mode="popularity"]');

        if (tvlBtn) {
            tvlBtn.addEventListener('click', () => this.handleModeToggle('tvl'));
        }
        if (popularityBtn) {
            popularityBtn.addEventListener('click', () => this.handleModeToggle('popularity'));
        }

        // Vault rows
        const vaultRows = this.getRefs('.vault-row');
        vaultRows.forEach(row => {
            row.addEventListener('click', () => {
                const address = row.getAttribute('data-address');
                if (address) {
                    this.handleVaultClick(address);
                }
            });
        });

        // Pagination buttons
        const prevBtn = this.getRef('prev-btn', '.prev-btn');
        const nextBtn = this.getRef('next-btn', '.next-btn');
        const pageBtns = this.getRefs('.page-num');

        if (prevBtn && !prevBtn.disabled) {
            prevBtn.addEventListener('click', () => {
                const page = parseInt(prevBtn.getAttribute('data-page'), 10);
                this.handlePageChange(page);
            });
        }
        if (nextBtn && !nextBtn.disabled) {
            nextBtn.addEventListener('click', () => {
                const page = parseInt(nextBtn.getAttribute('data-page'), 10);
                this.handlePageChange(page);
            });
        }
        pageBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.getAttribute('data-page'), 10);
                this.handlePageChange(page);
            });
        });

        // Retry button
        const retryBtn = this.getRef('retry-btn', '.retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.loadVaults());
        }
    }

    onStateUpdate(oldState, newState) {
        if (oldState.loading !== newState.loading ||
            oldState.mode !== newState.mode ||
            oldState.currentPage !== newState.currentPage) {
            this.setTimeout(() => {
                this.setupDOMEventListeners();
            }, 0);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
