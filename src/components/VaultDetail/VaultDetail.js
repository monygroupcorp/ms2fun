import { Component } from '../../core/Component.js';
import { getAssetIcon } from '../../utils/assetMetadata.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { detectNetwork } from '../../config/network.js';
import { eventBus } from '../../core/EventBus.js';

/**
 * VaultDetail component
 * Shows individual vault details, benefactors, user position, and projects using this vault
 */
export class VaultDetail extends Component {
    constructor(vaultAddress) {
        super();
        this.vaultAddress = vaultAddress;
        this.vaultAdapter = null;
        this.state = {
            vaultInfo: null,
            benefactors: [],
            userPosition: null,
            projectsUsingVault: [],
            loading: true,
            claiming: false,
            error: null
        };
        this.vaultMetadata = null;
    }

    async onMount() {
        try {
            await this.loadVaultMetadata();
            await this.initializeAdapter();
            await this.loadVaultData();

            // Listen for wallet changes
            eventBus.on('wallet:accountChanged', () => this.loadUserPosition());
            eventBus.on('wallet:connected', () => this.loadUserPosition());
        } catch (error) {
            console.error('[VaultDetail] Error initializing:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vault details'
            });
        }
    }

    onUnmount() {
        eventBus.off('wallet:accountChanged', () => this.loadUserPosition());
        eventBus.off('wallet:connected', () => this.loadUserPosition());
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
                    if (vault) {
                        this.vaultMetadata = vault;
                    }
                }
            }
        } catch (error) {
            console.warn('[VaultDetail] Could not load vault metadata:', error);
        }
    }

    async initializeAdapter() {
        try {
            this.vaultAdapter = await serviceFactory.getVaultAdapter(this.vaultAddress);
            await this.vaultAdapter.initialize();
        } catch (error) {
            console.error('[VaultDetail] Failed to initialize adapter:', error);
            throw error;
        }
    }

    async loadVaultData() {
        try {
            this.setState({ loading: true, error: null });

            // Load vault info, benefactors, and projects in parallel
            const [vaultInfo, benefactors, projects] = await Promise.all([
                this.loadVaultInfo(),
                this.loadBenefactors(),
                this.loadProjectsUsingVault()
            ]);

            // Load user position if wallet is connected
            let userPosition = null;
            if (walletService.isConnected()) {
                userPosition = await this.loadUserPosition();
            }

            this.setState({
                vaultInfo,
                benefactors,
                projectsUsingVault: projects,
                userPosition,
                loading: false
            });
        } catch (error) {
            console.error('[VaultDetail] Error loading vault data:', error);
            this.setState({
                loading: false,
                error: 'Failed to load vault details'
            });
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
        // Note: The UltraAlignmentVault contract doesn't support benefactor enumeration
        // Benefactors can only be queried individually by address
        // Return empty array - the UI will show "Benefactor list not available"
        return [];
    }

    async loadProjectsUsingVault() {
        try {
            const masterService = serviceFactory.getMasterService();
            const instances = await masterService.getInstancesByVault(this.vaultAddress);
            return instances || [];
        } catch (error) {
            console.warn('[VaultDetail] Error loading projects:', error);
            return [];
        }
    }

    async loadUserPosition() {
        try {
            if (!walletService.isConnected()) {
                return null;
            }

            const userAddress = await walletService.getAddress();

            // Check if user is a benefactor by checking their shares
            let isBenefactor = false;
            let shares = '0';

            try {
                isBenefactor = await this.vaultAdapter.isBenefactor(userAddress);
                if (isBenefactor) {
                    shares = await this.vaultAdapter.getBenefactorShares(userAddress);
                }
            } catch (error) {
                console.warn('[VaultDetail] Error checking benefactor status:', error);
                // Try alternative: check shares directly
                try {
                    shares = await this.vaultAdapter.benefactorShares(userAddress);
                    isBenefactor = parseFloat(shares) > 0;
                } catch {
                    return null;
                }
            }

            if (!isBenefactor) {
                return null;
            }

            // Load additional data
            let contribution = '0';
            let claimable = '0';

            try {
                contribution = await this.vaultAdapter.getBenefactorContribution(userAddress);
            } catch (error) {
                console.warn('[VaultDetail] Error loading contribution:', error);
            }

            try {
                claimable = await this.vaultAdapter.calculateClaimableAmount(userAddress);
            } catch (error) {
                console.warn('[VaultDetail] Error loading claimable amount:', error);
            }

            const totalShares = this.state.vaultInfo?.totalShares || '1';
            const sharePercent = parseFloat(totalShares) > 0
                ? (parseFloat(shares) / parseFloat(totalShares) * 100).toFixed(2)
                : '0';

            return {
                isBenefactor: true,
                contribution: this.formatTVL((parseFloat(contribution) * 1e18).toString()),
                contributionRaw: contribution,
                shares,
                sharePercent,
                claimableAmount: parseFloat(claimable).toFixed(6),
                claimableRaw: claimable
            };
        } catch (error) {
            console.warn('[VaultDetail] Error loading user position:', error);
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

            // Reload user position after claim
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

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    handleBackClick() {
        if (window.router) {
            window.router.navigate('/vaults');
        } else {
            window.location.href = '/vaults';
        }
    }

    handleProjectClick(projectAddress) {
        if (window.router) {
            window.router.navigate(`/project/${projectAddress}`);
        } else {
            window.location.href = `/project/${projectAddress}`;
        }
    }

    render() {
        const { vaultInfo, benefactors, userPosition, projectsUsingVault, loading, claiming, error } = this.state;

        if (loading) {
            return this.renderLoading();
        }

        if (error) {
            return this.renderError(error);
        }

        const assetIcon = vaultInfo?.targetAsset ? getAssetIcon(vaultInfo.targetAsset) : '💰';
        const userAddress = walletService.isConnected() ? walletService.getAddress() : null;

        return `
            <div class="vault-detail">
                <div class="vault-detail-header">
                    <button class="back-btn" data-ref="back-btn">
                        ← Back to Vaults
                    </button>
                </div>

                <div class="vault-info-section">
                    <div class="vault-icon-large">
                        <span class="asset-icon">${assetIcon}</span>
                    </div>
                    <div class="vault-info-content">
                        <h1 class="vault-name">${this.escapeHtml(vaultInfo?.name || 'Vault')}</h1>
                        <p class="vault-type">${this.escapeHtml(vaultInfo?.type || 'Ultra Alignment')}</p>
                        <p class="vault-address">${this.escapeHtml(this.vaultAddress)}</p>
                        ${vaultInfo?.description ? `<p class="vault-description">${this.escapeHtml(vaultInfo.description)}</p>` : ''}
                    </div>
                </div>

                <div class="vault-stats-grid">
                    <div class="stat-card">
                        <span class="stat-label">Accumulated Fees</span>
                        <span class="stat-value">${vaultInfo?.tvl || '$0'}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Total Shares</span>
                        <span class="stat-value">${this.formatNumber(vaultInfo?.totalShares)}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Target Asset</span>
                        <span class="stat-value">${vaultInfo?.targetAsset || 'ETH'}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Projects</span>
                        <span class="stat-value">${projectsUsingVault?.length || 0}</span>
                    </div>
                </div>

                ${userPosition ? this.renderUserPosition(userPosition, claiming) : ''}

                ${this.renderBenefactorsSection(benefactors, userAddress)}

                ${this.renderProjectsSection(projectsUsingVault)}
            </div>
        `;
    }

    renderLoading() {
        return `
            <div class="vault-detail">
                <div class="vault-detail-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading vault details...</p>
                </div>
            </div>
        `;
    }

    renderError(error) {
        return `
            <div class="vault-detail">
                <div class="vault-detail-header">
                    <button class="back-btn" data-ref="back-btn">
                        ← Back to Vaults
                    </button>
                </div>
                <div class="vault-detail-error">
                    <p>${this.escapeHtml(error)}</p>
                    <button class="retry-btn" data-ref="retry-btn">Try Again</button>
                </div>
            </div>
        `;
    }

    renderUserPosition(position, claiming) {
        return `
            <div class="user-position-section">
                <h2 class="section-title">Your Position</h2>
                <div class="user-position-card">
                    <div class="position-stats">
                        <div class="position-stat">
                            <span class="stat-label">Your Contribution</span>
                            <span class="stat-value">${position.contribution}</span>
                        </div>
                        <div class="position-stat">
                            <span class="stat-label">Your Shares</span>
                            <span class="stat-value">${this.formatNumber(position.shares)} (${position.sharePercent}%)</span>
                        </div>
                        <div class="position-stat highlight">
                            <span class="stat-label">Claimable Fees</span>
                            <span class="stat-value">${position.claimableAmount} ETH</span>
                        </div>
                    </div>
                    <button
                        class="claim-btn ${claiming ? 'loading' : ''} ${parseFloat(position.claimableRaw) <= 0 ? 'disabled' : ''}"
                        data-ref="claim-btn"
                        ${claiming || parseFloat(position.claimableRaw) <= 0 ? 'disabled' : ''}>
                        ${claiming ? 'Claiming...' : 'Claim Fees'}
                    </button>
                </div>
            </div>
        `;
    }

    renderBenefactorsSection(benefactors, userAddress) {
        if (!benefactors || benefactors.length === 0) {
            return `
                <div class="benefactors-section">
                    <h2 class="section-title">Benefactors</h2>
                    <div class="empty-section">
                        <p>Benefactor list not available on-chain. Connect your wallet to view your position.</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="benefactors-section">
                <h2 class="section-title">Top Benefactors</h2>
                <div class="benefactors-table-container">
                    <table class="benefactors-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Address</th>
                                <th>Contribution</th>
                                <th>Shares</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${benefactors.map(b => {
                                const isUser = userAddress && b.address.toLowerCase() === userAddress.toLowerCase();
                                return `
                                    <tr class="${isUser ? 'is-user' : ''}">
                                        <td>${b.rank}</td>
                                        <td>
                                            <span class="benefactor-address">${this.truncateAddress(b.address)}</span>
                                            ${isUser ? '<span class="you-badge">You</span>' : ''}
                                        </td>
                                        <td>${b.contribution}</td>
                                        <td>${this.formatNumber(b.shares)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    renderProjectsSection(projects) {
        if (!projects || projects.length === 0) {
            return `
                <div class="projects-section">
                    <h2 class="section-title">Projects Using This Vault</h2>
                    <div class="empty-section">
                        <p>No projects using this vault yet</p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="projects-section">
                <h2 class="section-title">Projects Using This Vault</h2>
                <div class="projects-grid">
                    ${projects.map(project => `
                        <div class="project-card" data-address="${this.escapeHtml(project.address || project)}" data-ref="project-card">
                            <span class="project-name">${this.escapeHtml(project.name || this.truncateAddress(project.address || project))}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    formatNumber(value) {
        if (!value) return '0';
        const num = parseFloat(value);
        if (num >= 1000000) {
            return (num / 1000000).toFixed(2) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(2) + 'K';
        }
        return num.toLocaleString();
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

        // Claim button
        const claimBtn = this.getRef('claim-btn', '.claim-btn');
        if (claimBtn && !claimBtn.disabled) {
            claimBtn.addEventListener('click', () => this.handleClaimFees());
        }

        // Retry button
        const retryBtn = this.getRef('retry-btn', '.retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.loadVaultData());
        }

        // Project cards
        const projectCards = this.getRefs('.project-card');
        projectCards.forEach(card => {
            card.addEventListener('click', () => {
                const address = card.getAttribute('data-address');
                if (address) {
                    this.handleProjectClick(address);
                }
            });
        });
    }

    onStateUpdate(oldState, newState) {
        if (oldState.loading !== newState.loading ||
            oldState.claiming !== newState.claiming ||
            oldState.userPosition !== newState.userPosition) {
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
