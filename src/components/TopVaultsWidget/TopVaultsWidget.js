import { Component } from '../../core/Component.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';

/**
 * TopVaultsWidget component
 * Shows top 3 vaults by TVL or popularity with toggle
 * Currently uses mock data - will be wired to real adapters in later phases
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
    }

    async onMount() {
        // TODO: Replace with real adapter when vault adapters are wired up
        // For now, use mock data
        try {
            await this.loadVaults();
        } catch (error) {
            console.error('[TopVaultsWidget] Error initializing:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vaults'
            });
        }
    }

    async loadVaults() {
        try {
            this.setState({ loading: true, error: null });

            const { mode } = this.state;

            // TODO: Replace with real vault adapter calls when available
            // For now, use mock data
            const mockVaults = this.getMockVaults(mode);

            this.setState({
                vaults: mockVaults,
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
     * Get mock vault data for development
     * TODO: Remove when real vault adapters are wired up
     */
    getMockVaults(mode) {
        const mockVaultsByTVL = [
            {
                rank: 1,
                address: '0xVAULT1000000000000000000000000000000001',
                name: 'Community Growth Vault',
                type: 'Ultra Alignment',
                targetAsset: 'ETH',  // Asset this vault is aligned to
                tvl: '$1.2M',
                tvlRaw: '1200000000000000000000000',
                popularity: 150,
                description: 'Community-focused vault'
            },
            {
                rank: 2,
                address: '0xVAULT2000000000000000000000000000000002',
                name: 'Development Fund',
                type: 'Ultra Alignment',
                targetAsset: 'USDC',  // Asset this vault is aligned to
                tvl: '$850K',
                tvlRaw: '850000000000000000000000',
                popularity: 95,
                description: 'Protocol development vault'
            },
            {
                rank: 3,
                address: '0xVAULT3000000000000000000000000000000003',
                name: 'Marketing Vault',
                type: 'Ultra Alignment',
                targetAsset: 'CULT',  // Asset this vault is aligned to
                tvl: '$620K',
                tvlRaw: '620000000000000000000000',
                popularity: 75,
                description: 'Marketing and growth vault'
            }
        ];

        const mockVaultsByPopularity = [
            {
                rank: 1,
                address: '0xVAULT1000000000000000000000000000000001',
                name: 'Community Growth Vault',
                type: 'Ultra Alignment',
                targetAsset: 'ETH',
                tvl: '$1.2M',
                tvlRaw: '1200000000000000000000000',
                popularity: 150,
                description: 'Community-focused vault'
            },
            {
                rank: 2,
                address: '0xVAULT2000000000000000000000000000000002',
                name: 'Development Fund',
                type: 'Ultra Alignment',
                targetAsset: 'USDC',
                tvl: '$850K',
                tvlRaw: '850000000000000000000000',
                popularity: 95,
                description: 'Protocol development vault'
            },
            {
                rank: 3,
                address: '0xVAULT3000000000000000000000000000000003',
                name: 'Marketing Vault',
                type: 'Ultra Alignment',
                targetAsset: 'CULT',
                tvl: '$620K',
                tvlRaw: '620000000000000000000000',
                popularity: 75,
                description: 'Marketing and growth vault'
            }
        ];

        return mode === 'tvl' ? mockVaultsByTVL : mockVaultsByPopularity;
    }

    /**
     * Format TVL value for display
     */
    formatTVL(value) {
        try {
            // Convert from wei to ETH
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
