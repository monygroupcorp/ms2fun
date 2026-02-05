/**
 * VaultDetail - Microact Version
 *
 * Shows individual vault details, user position, benefactors, and projects using the vault.
 * Handles fee claiming for benefactors.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { detectNetwork } from '../../config/network.js';

export class VaultDetail extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            vaultInfo: null,
            benefactors: [],
            userPosition: null,
            projectsUsingVault: [],
            loading: true,
            claiming: false,
            error: null
        };
        this.vaultAdapter = null;
        this.vaultMetadata = null;
    }

    get vaultAddress() {
        return this.props.vaultAddress;
    }

    async didMount() {
        try {
            await this.loadVaultMetadata();
            await this.initializeAdapter();
            await this.loadVaultData();

            const unsub1 = eventBus.on('wallet:accountChanged', () => this.loadUserPosition());
            const unsub2 = eventBus.on('wallet:connected', () => this.loadUserPosition());
            this.registerCleanup(() => { unsub1(); unsub2(); });
        } catch (error) {
            console.error('[VaultDetail] Error initializing:', error);
            this.setState({ loading: false, error: 'Failed to load vault details' });
        }
    }

    async loadVaultMetadata() {
        try {
            const network = detectNetwork();
            if (network.contracts) {
                const response = await fetch(network.contracts);
                const config = await response.json();
                if (config.vaults) {
                    const vault = config.vaults.find(
                        v => v.address.toLowerCase() === this.vaultAddress.toLowerCase()
                    );
                    if (vault) this.vaultMetadata = vault;
                }
            }
        } catch (error) {
            console.warn('[VaultDetail] Could not load vault metadata:', error);
        }
    }

    async initializeAdapter() {
        this.vaultAdapter = await serviceFactory.getVaultAdapter(this.vaultAddress);
        await this.vaultAdapter.initialize();
    }

    async loadVaultData() {
        try {
            this.setState({ loading: true, error: null });

            const [vaultInfo, benefactors, projects] = await Promise.all([
                this.loadVaultInfo(),
                this.loadBenefactors(),
                this.loadProjectsUsingVault()
            ]);

            let userPosition = null;
            if (walletService.isConnected()) {
                userPosition = await this.loadUserPosition();
            }

            this.setState({ vaultInfo, benefactors, projectsUsingVault: projects, userPosition, loading: false });
        } catch (error) {
            console.error('[VaultDetail] Error loading vault data:', error);
            this.setState({ loading: false, error: 'Failed to load vault details' });
        }
    }

    async loadVaultInfo() {
        const info = await this.vaultAdapter.getVaultInfo();
        return {
            address: this.vaultAddress,
            name: this.vaultMetadata?.tag || this.vaultMetadata?.name || 'Vault',
            type: this.formatVaultType(info.vaultType),
            description: info.description || this.vaultMetadata?.description || '',
            tvl: this.formatTVL(info.accumulatedFees),
            tvlRaw: info.accumulatedFees,
            totalShares: info.totalShares,
            benefactorCount: info.benefactorCount,
            targetAsset: this.vaultMetadata?.alignmentTokenSymbol || 'ETH'
        };
    }

    async loadBenefactors() {
        // Vault contract doesn't support benefactor enumeration
        return [];
    }

    async loadProjectsUsingVault() {
        try {
            const masterService = serviceFactory.getMasterService();
            return await masterService.getInstancesByVault(this.vaultAddress) || [];
        } catch (error) {
            return [];
        }
    }

    async loadUserPosition() {
        try {
            if (!walletService.isConnected()) return null;

            const userAddress = await walletService.getAddress();
            let isBenefactor = false;
            let shares = '0';

            try {
                isBenefactor = await this.vaultAdapter.isBenefactor(userAddress);
                if (isBenefactor) {
                    shares = await this.vaultAdapter.getBenefactorShares(userAddress);
                }
            } catch (error) {
                try {
                    shares = await this.vaultAdapter.benefactorShares(userAddress);
                    isBenefactor = parseFloat(shares) > 0;
                } catch {
                    return null;
                }
            }

            if (!isBenefactor) return null;

            let contribution = '0';
            let claimable = '0';

            try {
                contribution = await this.vaultAdapter.getBenefactorContribution(userAddress);
            } catch {}

            try {
                claimable = await this.vaultAdapter.calculateClaimableAmount(userAddress);
            } catch {}

            const totalShares = this.state.vaultInfo?.totalShares || '1';
            const sharePercent = parseFloat(totalShares) > 0
                ? (parseFloat(shares) / parseFloat(totalShares) * 100).toFixed(2)
                : '0';

            return {
                isBenefactor: true,
                contribution: this.formatTVL((parseFloat(contribution) * 1e18).toString()),
                shares,
                sharePercent,
                claimableAmount: parseFloat(claimable).toFixed(6),
                claimableRaw: claimable
            };
        } catch (error) {
            return null;
        }
    }

    async handleClaimFees() {
        try {
            if (!walletService.isConnected()) {
                eventBus.emit('wallet:requestConnection');
                return;
            }

            this.setState({ claiming: true });
            await this.vaultAdapter.claimFees();

            const userPosition = await this.loadUserPosition();
            this.setState({ userPosition, claiming: false });

            eventBus.emit('notification:success', {
                title: 'Fees Claimed',
                message: 'Your vault fees have been claimed successfully!'
            });
        } catch (error) {
            console.error('[VaultDetail] Error claiming fees:', error);
            this.setState({ claiming: false });
            eventBus.emit('notification:error', {
                title: 'Claim Failed',
                message: error.message || 'Failed to claim fees'
            });
        }
    }

    handleBackClick() {
        const { onNavigate } = this.props;
        if (onNavigate) {
            onNavigate('/vaults');
        } else if (window.router) {
            window.router.navigate('/vaults');
        } else {
            window.location.href = '/vaults';
        }
    }

    async handleProjectClick(projectAddress) {
        const { navigateToProject } = await import('../../utils/navigation.js');
        await navigateToProject(projectAddress);
    }

    formatVaultType(vaultType) {
        if (!vaultType) return 'Ultra Alignment';
        return vaultType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    formatTVL(value) {
        try {
            const eth = parseFloat(value) / 1e18;
            if (eth >= 1000000) return `$${(eth / 1000000).toFixed(2)}M`;
            if (eth >= 1000) return `$${(eth / 1000).toFixed(2)}K`;
            return `$${eth.toFixed(2)}`;
        } catch {
            return '$0';
        }
    }

    formatNumber(value) {
        if (!value) return '0';
        const num = parseFloat(value);
        if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
        return num.toLocaleString();
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { vaultInfo, userPosition, projectsUsingVault, loading, claiming, error } = this.state;

        if (loading) {
            return h('div', { className: 'vault-detail' },
                h('div', { className: 'vault-detail-loading' },
                    h('div', { className: 'loading-spinner' }),
                    h('p', null, 'Loading vault details...')
                )
            );
        }

        if (error) {
            return h('div', { className: 'vault-detail' },
                h('div', { className: 'vault-detail-header' },
                    h('button', { className: 'back-btn', onClick: this.bind(this.handleBackClick) }, '← Back to Vaults')
                ),
                h('div', { className: 'vault-detail-error' },
                    h('p', null, error),
                    h('button', { className: 'retry-btn', onClick: this.bind(this.loadVaultData) }, 'Try Again')
                )
            );
        }

        const assetIcon = vaultInfo?.targetAsset ? getAssetIcon(vaultInfo.targetAsset) : '💰';

        return h('div', { className: 'vault-detail' },
            h('div', { className: 'vault-detail-header' },
                h('button', { className: 'back-btn', onClick: this.bind(this.handleBackClick) }, '← Back to Vaults')
            ),

            h('div', { className: 'vault-info-section' },
                h('div', { className: 'vault-icon-large' },
                    h('span', { className: 'asset-icon' }, assetIcon)
                ),
                h('div', { className: 'vault-info-content' },
                    h('h1', { className: 'vault-name' }, vaultInfo?.name || 'Vault'),
                    h('p', { className: 'vault-type' }, vaultInfo?.type || 'Ultra Alignment'),
                    h('p', { className: 'vault-address' }, this.vaultAddress),
                    vaultInfo?.description && h('p', { className: 'vault-description' }, vaultInfo.description)
                )
            ),

            h('div', { className: 'vault-stats-grid' },
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Accumulated Fees'),
                    h('span', { className: 'stat-value' }, vaultInfo?.tvl || '$0')
                ),
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Total Shares'),
                    h('span', { className: 'stat-value' }, this.formatNumber(vaultInfo?.totalShares))
                ),
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Target Asset'),
                    h('span', { className: 'stat-value' }, vaultInfo?.targetAsset || 'ETH')
                ),
                h('div', { className: 'stat-card' },
                    h('span', { className: 'stat-label' }, 'Projects'),
                    h('span', { className: 'stat-value' }, projectsUsingVault?.length || 0)
                )
            ),

            userPosition && this.renderUserPosition(userPosition, claiming),
            this.renderBenefactorsSection(),
            this.renderProjectsSection(projectsUsingVault)
        );
    }

    renderUserPosition(position, claiming) {
        const canClaim = parseFloat(position.claimableRaw) > 0;

        return h('div', { className: 'user-position-section' },
            h('h2', { className: 'section-title' }, 'Your Position'),
            h('div', { className: 'user-position-card' },
                h('div', { className: 'position-stats' },
                    h('div', { className: 'position-stat' },
                        h('span', { className: 'stat-label' }, 'Your Contribution'),
                        h('span', { className: 'stat-value' }, position.contribution)
                    ),
                    h('div', { className: 'position-stat' },
                        h('span', { className: 'stat-label' }, 'Your Shares'),
                        h('span', { className: 'stat-value' }, `${this.formatNumber(position.shares)} (${position.sharePercent}%)`)
                    ),
                    h('div', { className: 'position-stat highlight' },
                        h('span', { className: 'stat-label' }, 'Claimable Fees'),
                        h('span', { className: 'stat-value' }, `${position.claimableAmount} ETH`)
                    )
                ),
                h('button', {
                    className: `claim-btn ${claiming ? 'loading' : ''} ${!canClaim ? 'disabled' : ''}`,
                    disabled: claiming || !canClaim,
                    onClick: this.bind(this.handleClaimFees)
                }, claiming ? 'Claiming...' : 'Claim Fees')
            )
        );
    }

    renderBenefactorsSection() {
        return h('div', { className: 'benefactors-section' },
            h('h2', { className: 'section-title' }, 'Benefactors'),
            h('div', { className: 'empty-section' },
                h('p', null, 'Benefactor list not available on-chain. Connect your wallet to view your position.')
            )
        );
    }

    renderProjectsSection(projects) {
        if (!projects || projects.length === 0) {
            return h('div', { className: 'projects-section' },
                h('h2', { className: 'section-title' }, 'Projects Using This Vault'),
                h('div', { className: 'empty-section' },
                    h('p', null, 'No projects using this vault yet')
                )
            );
        }

        return h('div', { className: 'projects-section' },
            h('h2', { className: 'section-title' }, 'Projects Using This Vault'),
            h('div', { className: 'projects-grid' },
                ...projects.map(project =>
                    h('div', {
                        className: 'project-card',
                        key: project.address || project,
                        onClick: () => this.handleProjectClick(project.address || project)
                    },
                        h('span', { className: 'project-name' },
                            project.name || this.truncateAddress(project.address || project)
                        )
                    )
                )
            )
        );
    }
}

export default VaultDetail;
