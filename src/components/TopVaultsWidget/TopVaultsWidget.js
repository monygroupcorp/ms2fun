import { Component } from '../../core/Component.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { detectNetwork } from '../../config/network.js';

/**
 * TopVaultsWidget component
 * Shows top 3 vaults by TVL or popularity with toggle
 * Uses real contract data via MasterRegistryAdapter
 */
export class TopVaultsWidget extends Component {
    constructor() {
        super();
        this.state = {
            mode: 'tvl', // 'tvl' or 'popularity'
            vaults: [],
            loading: true,
            error: null
        };
        this.vaultMetadata = null; // Cache for vault metadata from contracts.local.json
    }

    async onMount() {
        try {
            await this.loadVaultMetadata();
            await this.loadVaults();
        } catch (error) {
            console.error('[TopVaultsWidget] Error initializing:', error);
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
                // Create a map of vault address -> metadata
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
            const masterService = serviceFactory.getMasterService();

            // Fetch vaults from contract based on mode
            let rawVaults;
            if (mode === 'tvl') {
                rawVaults = await masterService.getVaultsByTVL(3);
            } else {
                rawVaults = await masterService.getVaultsByPopularity(3);
            }

            // Transform contract data to widget format
            const vaults = rawVaults.map((vault, index) => this.transformVault(vault, index));

            this.setState({
                vaults,
                loading: false
            });
        } catch (error) {
            console.error('[TopVaultsWidget] Error loading vaults:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    /**
     * Transform contract vault data to widget display format
     */
    transformVault(vault, index) {
        // Get additional metadata from contracts.local.json if available
        const metadata = this.vaultMetadata?.[vault.vaultAddress?.toLowerCase()] || {};

        // Parse TVL from ETH string to raw wei and formatted string
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
            description: metadata.description || ''
        };
    }

    /**
     * Format vault type for display
     */
    formatVaultType(vaultType) {
        if (!vaultType) return 'Ultra Alignment';
        // Convert 'ultra-alignment' to 'Ultra Alignment'
        return vaultType
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Format TVL value for display in ETH
     */
    formatTVL(value) {
        try {
            // Convert from wei to ETH
            const eth = parseFloat(value) / 1e18;

            if (eth >= 1000) {
                return `${(eth / 1000).toFixed(2)}K Ξ`;
            } else if (eth >= 1) {
                return `${eth.toFixed(2)} Ξ`;
            } else if (eth >= 0.001) {
                return `${eth.toFixed(4)} Ξ`;
            } else {
                return `${eth.toFixed(6)} Ξ`;
            }
        } catch (error) {
            return '0 Ξ';
        }
    }

    async handleModeToggle(newMode) {
        if (newMode !== this.state.mode) {
            this.setState({ mode: newMode });
            await this.loadVaults();
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

        return `
            <div class="top-vaults-widget">
                <div class="widget-header">
                    <h3 class="widget-title">Top Vaults</h3>
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
                </div>

                <div class="widget-content">
                    ${this.renderContent(vaults, loading, error, mode)}
                </div>

                ${!loading && !error && vaults.length > 0 ? `
                    <div class="widget-footer">
                        <button class="view-all-btn" data-ref="view-all-btn">
                            View All Vaults →
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderContent(vaults, loading, error, mode) {
        if (loading) {
            return `
                <div class="widget-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading vaults...</p>
                </div>
            `;
        }

        if (error) {
            return `
                <div class="widget-error">
                    <p>${this.escapeHtml(error)}</p>
                </div>
            `;
        }

        if (vaults.length === 0) {
            return `
                <div class="widget-empty">
                    <p>No vaults found</p>
                </div>
            `;
        }

        return `
            <div class="vault-cards-grid">
                ${vaults.map(vault => {
                    const assetIcon = vault.targetAsset ? getAssetIcon(vault.targetAsset) : '💰';
                    return `
                        <div class="vault-card" data-address="${this.escapeHtml(vault.address)}" data-ref="vault-card">
                            <div class="vault-card-header">
                                <div class="vault-rank-badge">#${vault.rank}</div>
                                <div class="vault-asset-icon" title="${vault.targetAsset || 'Generic'}">
                                    <span class="asset-icon">${assetIcon}</span>
                                </div>
                            </div>
                            <div class="vault-card-body">
                                <h4 class="vault-card-name">${this.escapeHtml(vault.name)}</h4>
                                <p class="vault-card-type">${this.escapeHtml(vault.type)}</p>
                                <div class="vault-card-metric">
                                    <span class="metric-label">${mode === 'tvl' ? 'TVL' : 'Popularity'}</span>
                                    <span class="metric-value">${mode === 'tvl' ? vault.tvl : vault.popularity}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Mode toggle buttons
        const tvlBtn = this.getRef('tvl-btn', '.mode-btn[data-mode="tvl"]');
        const popularityBtn = this.getRef('popularity-btn', '.mode-btn[data-mode="popularity"]');

        if (tvlBtn) {
            tvlBtn.addEventListener('click', () => this.handleModeToggle('tvl'));
        }

        if (popularityBtn) {
            popularityBtn.addEventListener('click', () => this.handleModeToggle('popularity'));
        }

        // Vault cards - use getRefs for multiple elements
        const vaultCards = this.getRefs('.vault-card');
        vaultCards.forEach(card => {
            card.addEventListener('click', () => {
                const address = card.getAttribute('data-address');
                if (address) {
                    this.handleVaultClick(address);
                }
            });
        });

        // View all button
        const viewAllBtn = this.getRef('view-all-btn', '.view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => this.handleViewAllClick());
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup DOM listeners when state changes
        if (oldState.loading !== newState.loading || oldState.mode !== newState.mode) {
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
