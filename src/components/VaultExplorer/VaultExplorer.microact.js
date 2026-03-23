/**
 * VaultExplorer - V2 Gallery Brutalism vault discovery page
 *
 * Source of truth: docs/examples/vault-explorer-demo.html
 *
 * Displays active vaults with on-chain TVL data loaded via
 * provider.getBalance(). Vault metadata comes from contracts config.
 *
 * Props (from Layout/route): { mode, config, provider, web3Ready, web3InitError }
 */

import { Component, h } from '../../core/microact-setup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class VaultExplorer extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            vaults: [],
            activeFilter: 'all'
        };
    }

    async didMount() {
        await stylesheetLoader.load('/src/core/route-vaults-v2.css', 'route:vaults');

        try {
            await this.loadVaults();
        } catch (error) {
            console.error('[VaultExplorer] Error initializing:', error);
            this.setState({ loading: false, error: 'Failed to load vaults' });
        }
    }

    async loadVaults() {
        const { config, provider } = this.props;

        if (!config || !config.vaults || config.vaults.length === 0) {
            this.setState({ loading: false, vaults: [] });
            return;
        }

        const vaults = [];
        for (const vaultConfig of config.vaults) {
            const vault = await this.loadVaultData(vaultConfig, provider);
            vaults.push(vault);
        }

        this.setState({ loading: false, vaults });
    }

    async loadVaultData(vaultConfig, provider) {
        let tvlWei = ethers.BigNumber.from(0);
        let tvlFormatted = '0 ETH';

        // Fetch on-chain ETH balance as TVL
        if (provider && vaultConfig.address) {
            try {
                tvlWei = await provider.getBalance(vaultConfig.address);
                const eth = parseFloat(ethers.utils.formatEther(tvlWei));
                if (eth >= 1000) {
                    tvlFormatted = `${(eth).toLocaleString(undefined, { maximumFractionDigits: 1 })} ETH`;
                } else {
                    tvlFormatted = `${eth.toFixed(2)} ETH`;
                }
            } catch (err) {
                console.warn('[VaultExplorer] Could not fetch balance for', vaultConfig.address, err);
                tvlFormatted = '-- ETH';
            }
        }

        // Count aligned projects from config instances
        let alignedProjects = 0;
        const { config } = this.props;
        if (config && config.instances) {
            const allInstances = [
                ...(config.instances.erc404 || []),
                ...(config.instances.erc1155 || []),
                ...(config.instances.erc721 || [])
            ];
            alignedProjects = allInstances.filter(
                inst => inst.vault && inst.vault.toLowerCase() === vaultConfig.address.toLowerCase()
            ).length;
        }

        // Derive a display name from the vault config
        const name = vaultConfig.name || vaultConfig.tag || this.truncateAddress(vaultConfig.address);

        return {
            address: vaultConfig.address,
            name,
            vaultType: vaultConfig.vaultType || 'Ultra Alignment',
            alignmentToken: vaultConfig.alignmentToken,
            hookAddress: vaultConfig.hookAddress,
            tvl: tvlFormatted,
            tvlWei,
            alignedProjects,
            description: vaultConfig.description || ''
        };
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    handleFilterClick(filter) {
        if (this.state.activeFilter !== filter) {
            this.setState({ activeFilter: filter });
        }
    }

    handleVaultClick(address) {
        if (window.router) {
            window.router.navigate(`/vaults/${address}`);
        } else {
            window.location.href = `/vaults/${address}`;
        }
    }

    getFilteredVaults() {
        const { vaults, activeFilter } = this.state;
        if (activeFilter === 'all') return vaults;
        if (activeFilter === 'tvl') {
            return [...vaults].sort((a, b) => {
                const aBn = a.tvlWei || ethers.BigNumber.from(0);
                const bBn = b.tvlWei || ethers.BigNumber.from(0);
                if (bBn.gt(aBn)) return 1;
                if (aBn.gt(bBn)) return -1;
                return 0;
            });
        }
        if (activeFilter === 'projects') {
            return [...vaults].sort((a, b) => b.alignedProjects - a.alignedProjects);
        }
        return vaults;
    }

    renderLoading() {
        return h('div', { className: 'vault-explorer-loading' },
            h('p', null, 'Loading vaults...')
        );
    }

    renderError() {
        return h('div', { className: 'vault-explorer-error' },
            h('p', null, this.state.error),
            h('button', {
                className: 'btn btn-primary',
                onClick: this.bind(this.loadVaults)
            }, 'Try Again')
        );
    }

    renderEmpty() {
        return h('div', { className: 'empty-state' },
            h('div', { className: 'empty-state-title' }, 'No Vaults Found'),
            h('div', { className: 'empty-state-description' },
                'No vaults have been deployed yet.'
            )
        );
    }

    renderVaultCard(vault) {
        return h('a', {
            className: 'vault-card',
            key: vault.address,
            href: `/vaults/${vault.address}`,
            onClick: (e) => {
                e.preventDefault();
                this.handleVaultClick(vault.address);
            }
        },
            h('div', { className: 'vault-header' },
                h('div', { className: 'vault-target' }, vault.name),
                h('div', { className: 'vault-badge' }, vault.vaultType)
            ),

            vault.description
                ? h('div', { className: 'vault-description' }, vault.description)
                : null,

            h('div', { className: 'vault-stats' },
                h('div', { className: 'vault-stat' },
                    h('div', { className: 'vault-stat-label' }, 'TVL'),
                    h('div', { className: 'vault-stat-value' }, vault.tvl)
                ),
                h('div', { className: 'vault-stat' },
                    h('div', { className: 'vault-stat-label' }, 'Aligned Projects'),
                    h('div', { className: 'vault-stat-value' }, String(vault.alignedProjects))
                )
            ),

            h('div', { className: 'vault-meta' },
                h('div', null, `Target: ${this.truncateAddress(vault.alignmentToken)}`),
                h('div', null, 'Pool: v4')
            )
        );
    }

    render() {
        const { loading, error, vaults, activeFilter } = this.state;
        const filteredVaults = this.getFilteredVaults();

        return h('div', { className: 'vault-explorer-content' },
            // Page Header
            h('header', { className: 'page-header' },
                h('h1', { className: 'page-title' }, 'Vault Explorer'),
                h('p', { className: 'page-description' },
                    'Vaults funnel project tithes into target assets, building Uniswap v4 liquidity positions and providing yield to benefactors. Each DAO-approved target can have one vault.'
                )
            ),

            // Filter Bar
            h('div', { className: 'filter-bar' },
                h('button', {
                    className: `filter-pill ${activeFilter === 'all' ? 'active' : ''}`,
                    onClick: () => this.handleFilterClick('all')
                }, 'All Vaults'),
                h('button', {
                    className: `filter-pill ${activeFilter === 'tvl' ? 'active' : ''}`,
                    onClick: () => this.handleFilterClick('tvl')
                }, 'By TVL'),
                h('button', {
                    className: `filter-pill ${activeFilter === 'projects' ? 'active' : ''}`,
                    onClick: () => this.handleFilterClick('projects')
                }, 'By Projects')
            ),

            // Active Vaults Section
            h('section', { style: 'margin-bottom: var(--space-8);' },
                h('div', { className: 'section-header' },
                    h('h2', { className: 'section-title' }, 'Active Vaults'),
                    h('div', { className: 'section-count' },
                        loading ? '...' : `${filteredVaults.length} Vault${filteredVaults.length !== 1 ? 's' : ''}`)
                ),

                loading
                    ? this.renderLoading()
                    : error
                        ? this.renderError()
                        : filteredVaults.length === 0
                            ? this.renderEmpty()
                            : h('div', { className: 'vault-grid' },
                                ...filteredVaults.map(vault => this.renderVaultCard(vault))
                            )
            ),

            // Bottom spacer (matches demo)
            h('div', { style: 'height: 80px;' })
        );
    }
}

export default VaultExplorer;
