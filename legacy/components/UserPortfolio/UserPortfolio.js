/**
 * UserPortfolio Component
 *
 * User's personal dashboard showing:
 * - ERC404 holdings (tokens, NFTs, staking positions)
 * - ERC1155 holdings (editions owned)
 * - Vault positions (contributions, shares, claimable)
 * - Storage settings (control local data usage)
 *
 * Uses UserHoldingsIndex to efficiently track which instances to query.
 */

import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';
import { queryService } from '../../services/QueryService.js';
import { userHoldingsIndex, SCAN_MODE } from '../../services/UserHoldingsIndex.js';
import { projectIndex, INDEX_MODE } from '../../services/ProjectIndex.js';
import serviceFactory from '../../services/ServiceFactory.js';
import WalletModal from '../WalletModal/WalletModal.js';

export class UserPortfolio extends Component {
    constructor() {
        super();
        this.walletModal = null;
        this.state = {
            // Wallet
            isConnected: false,
            userAddress: null,

            // Loading states
            loading: true,
            scanning: false,
            scanProgress: null,

            // Holdings data
            erc404Holdings: [],
            erc1155Holdings: [],
            vaultPositions: [],
            totalClaimable: '0',

            // Claiming state
            claiming: null, // address being claimed from

            // Settings
            holdingsMode: SCAN_MODE.SMART,
            holdingsStats: null,

            // Errors
            error: null
        };
    }

    async onMount() {
        this._setupEventListeners();
        await this._checkWalletConnection();
    }

    _setupEventListeners() {
        // Wallet events
        this.subscribe('wallet:connected', async ({ address }) => {
            this.setState({ isConnected: true, userAddress: address });
            await this._loadPortfolioData();
        });

        this.subscribe('wallet:disconnected', () => {
            this.setState({
                isConnected: false,
                userAddress: null,
                erc404Holdings: [],
                erc1155Holdings: [],
                vaultPositions: [],
                totalClaimable: '0',
                loading: false
            });
        });

        // Transaction confirmation - refresh holdings
        this.subscribe('transaction:confirmed', async () => {
            if (this.state.isConnected) {
                await this._loadPortfolioData();
            }
        });

        // Holdings index events
        this.subscribe('holdings:updated', async () => {
            await this._loadPortfolioData();
        });

        this.subscribe('holdings:mode:changed', (mode) => {
            this.setState({ holdingsMode: mode });
            this._loadStorageStats();
        });
    }

    async _checkWalletConnection() {
        // First check if walletService already has a connection
        if (walletService.isConnected()) {
            const address = walletService.getAddress();
            if (address) {
                this.setState({
                    isConnected: true,
                    userAddress: address
                });
                await this._loadPortfolioData();
                return;
            }
        }

        // Check if window.ethereum has accounts (user previously connected)
        if (typeof window.ethereum !== 'undefined') {
            try {
                // eth_accounts doesn't prompt - just checks existing permissions
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });

                if (accounts && accounts.length > 0) {
                    // User has previously connected
                    this.setState({
                        isConnected: true,
                        userAddress: accounts[0]
                    });
                    await this._loadPortfolioData();
                    return;
                }
            } catch (error) {
                console.log('[UserPortfolio] Could not check accounts:', error.message);
            }
        }

        // No connection found
        this.setState({ loading: false });
    }

    async _loadPortfolioData() {
        const { userAddress } = this.state;
        if (!userAddress) {
            this.setState({ loading: false });
            return;
        }

        this.setState({ loading: true, error: null });

        try {
            // Get scan mode
            const holdingsMode = await userHoldingsIndex.getScanMode();
            console.log(`[UserPortfolio] Scan mode: ${holdingsMode}`);

            // Get instances with holdings
            let instanceAddresses = [];

            if (holdingsMode !== SCAN_MODE.OFF) {
                instanceAddresses = await userHoldingsIndex.getHoldingInstances(userAddress);
                console.log(`[UserPortfolio] Cached holdings: ${instanceAddresses.length} instances`);

                // If no cached holdings, always do a scan
                // This handles chain resets where old timestamp persists but data is stale
                if (instanceAddresses.length === 0) {
                    const lastScan = await userHoldingsIndex.getLastFullScan(userAddress);
                    console.log(`[UserPortfolio] Last scan timestamp: ${lastScan}, starting fresh scan...`);

                    // Always scan if we have 0 holdings - the chain may have been reset
                    await this._performFullScan(userAddress);
                    instanceAddresses = await userHoldingsIndex.getHoldingInstances(userAddress);
                    console.log(`[UserPortfolio] After scan: ${instanceAddresses.length} instances with holdings`);
                }
            }

            console.log(`[UserPortfolio] Querying portfolio for ${instanceAddresses.length} instances`);
            // Get portfolio data from QueryService
            const portfolioData = await queryService.getPortfolioData(userAddress, instanceAddresses);

            // Load storage stats
            const holdingsStats = await userHoldingsIndex.getStorageStats(userAddress);

            this.setState({
                erc404Holdings: portfolioData.erc404Holdings || [],
                erc1155Holdings: portfolioData.erc1155Holdings || [],
                vaultPositions: portfolioData.vaultPositions || [],
                totalClaimable: portfolioData.totalClaimable || '0',
                holdingsMode,
                holdingsStats,
                loading: false
            });

            // Background: check for stale instances
            if (holdingsMode === SCAN_MODE.SMART) {
                this._backgroundRescan(userAddress);
            }

        } catch (error) {
            console.error('[UserPortfolio] Failed to load portfolio:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load portfolio data'
            });
        }
    }

    /**
     * Perform full scan of all instances to find user holdings
     */
    async _performFullScan(userAddress) {
        this.setState({ scanning: true, scanProgress: { current: 0, total: 0 } });

        try {
            // Get all instance addresses from ProjectIndex or MasterRegistry
            let allInstances = [];

            try {
                const allProjects = await projectIndex.getAllProjects(1000, 0);
                allInstances = allProjects.map(p => p.address);
            } catch (e) {
                console.log('[UserPortfolio] ProjectIndex failed:', e.message);
            }

            // If ProjectIndex is empty/failed, fallback to MasterRegistry
            if (allInstances.length === 0) {
                console.log('[UserPortfolio] Falling back to MasterRegistry for instance list');
                const masterService = serviceFactory.getMasterService();
                const instances = await masterService.getAllInstances();
                allInstances = instances.map(i => i.instanceAddress || i.address || i);
            }

            console.log(`[UserPortfolio] Found ${allInstances.length} instances to scan`);
            this.setState({ scanProgress: { current: 0, total: allInstances.length } });

            // Batch check holdings (20 at a time to avoid RPC limits)
            const batchSize = 20;
            const holdingsMap = {};

            for (let i = 0; i < allInstances.length; i += batchSize) {
                const batch = allInstances.slice(i, i + batchSize);

                // Query portfolio data for batch
                try {
                    const batchData = await queryService.getPortfolioData(userAddress, batch);

                    // Mark which instances have holdings
                    batch.forEach((addr, idx) => {
                        // Check if any holdings exist for this instance
                        const hasErc404 = batchData.erc404Holdings?.some(h =>
                            h.instance?.toLowerCase() === addr.toLowerCase() &&
                            (h.tokenBalance !== '0' || h.nftBalance > 0 || h.stakedBalance !== '0')
                        );
                        const hasErc1155 = batchData.erc1155Holdings?.some(h =>
                            h.instance?.toLowerCase() === addr.toLowerCase() &&
                            h.balances?.some(b => b > 0)
                        );

                        holdingsMap[addr] = hasErc404 || hasErc1155 || false;
                    });
                } catch (e) {
                    // Mark all as false on error
                    batch.forEach(addr => {
                        holdingsMap[addr] = false;
                    });
                }

                this.setState({ scanProgress: { current: Math.min(i + batchSize, allInstances.length), total: allInstances.length } });
            }

            // Save to index
            await userHoldingsIndex.updateHoldingsBatch(userAddress, holdingsMap);
            await userHoldingsIndex.setLastFullScan(userAddress);

        } catch (error) {
            console.error('[UserPortfolio] Full scan failed:', error);
        } finally {
            this.setState({ scanning: false, scanProgress: null });
        }
    }

    /**
     * Background rescan of stale instances
     */
    async _backgroundRescan(userAddress) {
        try {
            const staleInstances = await userHoldingsIndex.getStaleInstances(userAddress);
            if (staleInstances.length === 0) return;

            // Rescan in background (don't update UI until done)
            const holdingsMap = {};

            for (const addr of staleInstances) {
                try {
                    const data = await queryService.getPortfolioData(userAddress, [addr]);
                    const hasHoldings = data.erc404Holdings?.length > 0 || data.erc1155Holdings?.length > 0;
                    holdingsMap[addr] = hasHoldings;
                } catch (e) {
                    holdingsMap[addr] = false;
                }
            }

            await userHoldingsIndex.updateHoldingsBatch(userAddress, holdingsMap);

            // Refresh if any new holdings found
            const newHoldings = Object.values(holdingsMap).some(v => v);
            if (newHoldings) {
                await this._loadPortfolioData();
            }

        } catch (error) {
            console.warn('[UserPortfolio] Background rescan failed:', error);
        }
    }

    async _loadStorageStats() {
        const { userAddress } = this.state;
        const holdingsStats = await userHoldingsIndex.getStorageStats(userAddress);
        this.setState({ holdingsStats });
    }

    // =========================
    // Actions
    // =========================

    async handleConnectWallet() {
        // Show wallet modal to let user select wallet type
        const providerMap = {
            rabby: () => window.ethereum?.isRabby ? window.ethereum : null,
            rainbow: () => window.ethereum?.isRainbow ? window.ethereum : null,
            phantom: () => window.phantom?.ethereum || null,
            metamask: () => window.ethereum || null
        };

        const walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/MetaMask.webp'
        };

        // Create WalletModal if not exists
        if (!this.walletModal) {
            this.walletModal = new WalletModal(
                providerMap,
                walletIcons,
                async (walletType) => {
                    await this._handleWalletSelection(walletType);
                }
            );
        }

        this.walletModal.show();
    }

    async _handleWalletSelection(walletType) {
        try {
            await walletService.selectWallet(walletType);
            await walletService.connect();
            // Event listener will update state on success
        } catch (error) {
            console.error('[UserPortfolio] Wallet connection failed:', error);
            this.setState({ error: error.message });
        }
    }

    async handleClaimVaultFees(vaultAddress) {
        if (!this.state.userAddress) return;

        this.setState({ claiming: vaultAddress });

        try {
            // Get vault adapter and claim
            const vaultService = serviceFactory.getVaultService();
            const adapter = await vaultService.getVaultAdapter(vaultAddress);

            const tx = await adapter.claimFees();
            await tx.wait();

            eventBus.emit('transaction:confirmed', { contractAddress: vaultAddress });

        } catch (error) {
            console.error('[UserPortfolio] Claim failed:', error);
            this.setState({ error: error.message || 'Failed to claim fees' });
        } finally {
            this.setState({ claiming: null });
        }
    }

    async handleClaimAll() {
        const { vaultPositions, userAddress } = this.state;
        if (!userAddress) return;

        for (const position of vaultPositions) {
            if (position.claimable !== '0') {
                await this.handleClaimVaultFees(position.vault);
            }
        }
    }

    async handleRefreshHoldings() {
        const { userAddress } = this.state;
        if (!userAddress) return;

        // Clear cache and rescan
        await userHoldingsIndex.clearUserData(userAddress);
        await this._loadPortfolioData();
    }

    async handleChangeScanMode(mode) {
        await userHoldingsIndex.setScanMode(mode);
        this.setState({ holdingsMode: mode });
        await this._loadStorageStats();
    }

    handleGoBack() {
        window.router?.navigate('/');
    }

    // =========================
    // Formatters
    // =========================

    formatAddress(address) {
        if (!address) return '0x...';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatBalance(balance, decimals = 18) {
        if (!balance || balance === '0') return '0';
        const num = parseFloat(balance) / Math.pow(10, decimals);
        if (num < 0.01) return '< 0.01';
        if (num < 1) return num.toFixed(4);
        if (num < 1000) return num.toFixed(2);
        if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
        return `${(num / 1000000).toFixed(2)}M`;
    }

    formatETH(wei) {
        if (!wei || wei === '0') return '0 ETH';
        const eth = parseFloat(wei) / 1e18;
        if (eth < 0.0001) return '< 0.0001 ETH';
        if (eth < 1) return `${eth.toFixed(4)} ETH`;
        return `${eth.toFixed(2)} ETH`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================
    // Render
    // =========================

    render() {
        const {
            isConnected,
            userAddress,
            loading,
            scanning,
            scanProgress,
            erc404Holdings,
            erc1155Holdings,
            vaultPositions,
            totalClaimable,
            claiming,
            holdingsMode,
            holdingsStats,
            error
        } = this.state;

        return `
            <div class="user-portfolio">
                ${this._renderHeader()}

                ${error ? this._renderError(error) : ''}

                ${!isConnected ? this._renderConnectPrompt() : ''}

                ${isConnected && loading ? this._renderLoading() : ''}

                ${isConnected && scanning ? this._renderScanning(scanProgress) : ''}

                ${isConnected && !loading && !scanning ? `
                    ${this._renderOverview(totalClaimable)}
                    ${this._renderERC404Holdings(erc404Holdings)}
                    ${this._renderERC1155Holdings(erc1155Holdings)}
                    ${this._renderVaultPositions(vaultPositions, claiming)}
                    ${this._renderStorageSettings(holdingsMode, holdingsStats)}
                ` : ''}
            </div>
        `;
    }

    _renderHeader() {
        const { userAddress } = this.state;
        return `
            <div class="portfolio-header">
                <button class="back-btn" data-ref="back-btn">
                    <span class="back-arrow">&larr;</span>
                    Back
                </button>

                <h1 class="page-title">Your Portfolio</h1>
                ${userAddress ? `
                    <p class="wallet-address">
                        <span class="wallet-icon">&#9670;</span>
                        ${this.formatAddress(userAddress)}
                    </p>
                ` : ''}
            </div>
        `;
    }

    _renderError(error) {
        return `
            <div class="error-banner">
                <span class="error-icon">!</span>
                <span class="error-text">${this.escapeHtml(error)}</span>
                <button class="dismiss-btn" data-ref="dismiss-error">Dismiss</button>
            </div>
        `;
    }

    _renderConnectPrompt() {
        return `
            <div class="connect-prompt">
                <div class="prompt-icon">&#9670;</div>
                <h2>Connect Your Wallet</h2>
                <p>Connect your wallet to view your holdings, claimable rewards, and portfolio.</p>
                <button class="connect-btn primary-btn" data-ref="connect-btn">
                    Connect Wallet
                </button>
            </div>
        `;
    }

    _renderLoading() {
        return `
            <div class="portfolio-loading">
                <div class="loading-spinner"></div>
                <p>Loading your portfolio...</p>
            </div>
        `;
    }

    _renderScanning(progress) {
        const percent = progress && progress.total > 0
            ? Math.round((progress.current / progress.total) * 100)
            : 0;

        return `
            <div class="portfolio-scanning">
                <div class="loading-spinner"></div>
                <p>Scanning for holdings...</p>
                <div class="scan-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percent}%"></div>
                    </div>
                    <span class="progress-text">${progress?.current || 0} / ${progress?.total || 0}</span>
                </div>
            </div>
        `;
    }

    _renderOverview(totalClaimable) {
        const hasClaimable = totalClaimable && totalClaimable !== '0';

        return `
            <div class="portfolio-overview">
                <div class="overview-card">
                    <span class="overview-label">Total Claimable</span>
                    <span class="overview-value ${hasClaimable ? 'has-value' : ''}">${this.formatETH(totalClaimable)}</span>
                </div>

                <div class="overview-actions">
                    <button class="action-btn secondary-btn" data-ref="refresh-btn">
                        Refresh Holdings
                    </button>
                    ${hasClaimable ? `
                        <button class="action-btn primary-btn" data-ref="claim-all-btn">
                            Claim All
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    _renderERC404Holdings(holdings) {
        if (!holdings || holdings.length === 0) {
            return `
                <section class="holdings-section">
                    <h2 class="section-title">Token Holdings (ERC404)</h2>
                    <div class="empty-state">
                        <p>No ERC404 tokens found in your wallet.</p>
                    </div>
                </section>
            `;
        }

        const holdingsHtml = holdings.map(h => `
            <div class="holding-card erc404-card" data-instance="${this.escapeHtml(h.instance)}">
                <div class="holding-header">
                    <span class="holding-name">${this.escapeHtml(h.name || 'Unknown Project')}</span>
                    <span class="holding-address">${this.formatAddress(h.instance)}</span>
                </div>
                <div class="holding-stats">
                    <div class="stat">
                        <span class="stat-label">Tokens</span>
                        <span class="stat-value">${this.formatBalance(h.tokenBalance)}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">NFTs</span>
                        <span class="stat-value">${h.nftBalance || 0}</span>
                    </div>
                    ${h.stakedBalance && h.stakedBalance !== '0' ? `
                        <div class="stat">
                            <span class="stat-label">Staked</span>
                            <span class="stat-value">${this.formatBalance(h.stakedBalance)}</span>
                        </div>
                    ` : ''}
                    ${h.pendingRewards && h.pendingRewards !== '0' ? `
                        <div class="stat highlight">
                            <span class="stat-label">Pending Rewards</span>
                            <span class="stat-value">${this.formatETH(h.pendingRewards)}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');

        return `
            <section class="holdings-section">
                <h2 class="section-title">Token Holdings (ERC404)</h2>
                <div class="holdings-grid">
                    ${holdingsHtml}
                </div>
            </section>
        `;
    }

    _renderERC1155Holdings(holdings) {
        if (!holdings || holdings.length === 0) {
            return `
                <section class="holdings-section">
                    <h2 class="section-title">Edition Holdings (ERC1155)</h2>
                    <div class="empty-state">
                        <p>No editions found in your wallet.</p>
                    </div>
                </section>
            `;
        }

        const holdingsHtml = holdings.map(h => {
            const editionsHtml = (h.editionIds || []).map((editionId, idx) => {
                const balance = h.balances?.[idx] || 0;
                if (balance === 0) return '';
                return `
                    <div class="edition-item">
                        <span class="edition-id">Edition #${editionId}</span>
                        <span class="edition-balance">x${balance}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="holding-card erc1155-card" data-instance="${this.escapeHtml(h.instance)}">
                    <div class="holding-header">
                        <span class="holding-name">${this.escapeHtml(h.name || 'Unknown Project')}</span>
                        <span class="holding-address">${this.formatAddress(h.instance)}</span>
                    </div>
                    <div class="editions-list">
                        ${editionsHtml || '<p class="no-editions">No editions</p>'}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="holdings-section">
                <h2 class="section-title">Edition Holdings (ERC1155)</h2>
                <div class="holdings-grid">
                    ${holdingsHtml}
                </div>
            </section>
        `;
    }

    _renderVaultPositions(positions, claiming) {
        if (!positions || positions.length === 0) {
            return `
                <section class="holdings-section">
                    <h2 class="section-title">Vault Positions</h2>
                    <div class="empty-state">
                        <p>You are not a benefactor of any vaults.</p>
                    </div>
                </section>
            `;
        }

        const positionsHtml = positions.map(p => {
            const isClaiming = claiming === p.vault;
            const hasClaimable = p.claimable && p.claimable !== '0';

            return `
                <div class="holding-card vault-card" data-vault="${this.escapeHtml(p.vault)}">
                    <div class="holding-header">
                        <span class="holding-name">${this.escapeHtml(p.name || 'Unknown Vault')}</span>
                        <span class="holding-address">${this.formatAddress(p.vault)}</span>
                    </div>
                    <div class="holding-stats">
                        <div class="stat">
                            <span class="stat-label">Contribution</span>
                            <span class="stat-value">${this.formatETH(p.contribution)}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Shares</span>
                            <span class="stat-value">${this.formatBalance(p.shares, 0)}</span>
                        </div>
                        <div class="stat ${hasClaimable ? 'highlight' : ''}">
                            <span class="stat-label">Claimable</span>
                            <span class="stat-value">${this.formatETH(p.claimable)}</span>
                        </div>
                    </div>
                    ${hasClaimable ? `
                        <div class="holding-actions">
                            <button class="claim-btn" data-vault="${this.escapeHtml(p.vault)}" ${isClaiming ? 'disabled' : ''}>
                                ${isClaiming ? 'Claiming...' : 'Claim Fees'}
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        return `
            <section class="holdings-section">
                <h2 class="section-title">Vault Positions</h2>
                <div class="holdings-grid">
                    ${positionsHtml}
                </div>
            </section>
        `;
    }

    _renderStorageSettings(mode, stats) {
        return `
            <section class="holdings-section settings-section">
                <h2 class="section-title">Storage Settings</h2>
                <p class="section-description">
                    Holdings data is cached locally for faster loading. Adjust settings to control storage usage.
                </p>

                <div class="settings-card">
                    <div class="setting-group">
                        <h4>Cache Mode</h4>
                        <div class="mode-options">
                            <label class="mode-option ${mode === SCAN_MODE.SMART ? 'selected' : ''}">
                                <input type="radio" name="scanMode" value="${SCAN_MODE.SMART}"
                                    ${mode === SCAN_MODE.SMART ? 'checked' : ''}
                                    data-ref="mode-smart">
                                <div class="mode-content">
                                    <span class="mode-title">Smart</span>
                                    <span class="mode-description">Cache holdings, periodically re-check (recommended)</span>
                                </div>
                            </label>
                            <label class="mode-option ${mode === SCAN_MODE.FULL ? 'selected' : ''}">
                                <input type="radio" name="scanMode" value="${SCAN_MODE.FULL}"
                                    ${mode === SCAN_MODE.FULL ? 'checked' : ''}
                                    data-ref="mode-full">
                                <div class="mode-content">
                                    <span class="mode-title">Full</span>
                                    <span class="mode-description">Scan all instances every time</span>
                                </div>
                            </label>
                            <label class="mode-option ${mode === SCAN_MODE.OFF ? 'selected' : ''}">
                                <input type="radio" name="scanMode" value="${SCAN_MODE.OFF}"
                                    ${mode === SCAN_MODE.OFF ? 'checked' : ''}
                                    data-ref="mode-off">
                                <div class="mode-content">
                                    <span class="mode-title">Off</span>
                                    <span class="mode-description">No local caching (uses less storage)</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    ${stats ? `
                        <div class="storage-stats">
                            <div class="stat-item">
                                <span class="stat-label">Instances Tracked</span>
                                <span class="stat-value">${stats.totalRecords || 0}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">With Holdings</span>
                                <span class="stat-value">${stats.holdingsCount || 0}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Last Full Scan</span>
                                <span class="stat-value">${stats.lastFullScan ? new Date(stats.lastFullScan).toLocaleDateString() : 'Never'}</span>
                            </div>
                        </div>
                    ` : ''}

                    <div class="settings-actions">
                        <button class="action-btn secondary-btn" data-ref="clear-cache-btn"
                            ${mode === SCAN_MODE.OFF ? 'disabled' : ''}>
                            Clear Cache
                        </button>
                    </div>
                </div>
            </section>
        `;
    }

    // =========================
    // DOM Event Handlers
    // =========================

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Back button
        const backBtn = this.element.querySelector('[data-ref="back-btn"]');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleGoBack());
        }

        // Connect wallet button
        const connectBtn = this.element.querySelector('[data-ref="connect-btn"]');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => this.handleConnectWallet());
        }

        // Dismiss error
        const dismissBtn = this.element.querySelector('[data-ref="dismiss-error"]');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => this.setState({ error: null }));
        }

        // Refresh holdings
        const refreshBtn = this.element.querySelector('[data-ref="refresh-btn"]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.handleRefreshHoldings());
        }

        // Claim all
        const claimAllBtn = this.element.querySelector('[data-ref="claim-all-btn"]');
        if (claimAllBtn) {
            claimAllBtn.addEventListener('click', () => this.handleClaimAll());
        }

        // Individual claim buttons
        const claimBtns = this.element.querySelectorAll('.claim-btn[data-vault]');
        claimBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const vault = btn.getAttribute('data-vault');
                this.handleClaimVaultFees(vault);
            });
        });

        // Scan mode radios
        const modeRadios = this.element.querySelectorAll('input[name="scanMode"]');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.handleChangeScanMode(e.target.value);
            });
        });

        // Clear cache button
        const clearCacheBtn = this.element.querySelector('[data-ref="clear-cache-btn"]');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                if (confirm('Clear all cached holdings data? You will need to rescan on next load.')) {
                    const { userAddress } = this.state;
                    if (userAddress) {
                        await userHoldingsIndex.clearUserData(userAddress);
                        await this._loadStorageStats();
                    }
                }
            });
        }

        // Holding cards - navigate to project on click
        const holdingCards = this.element.querySelectorAll('.holding-card[data-instance]');
        holdingCards.forEach(card => {
            card.addEventListener('click', async (e) => {
                // Don't navigate if clicking a button
                if (e.target.closest('button')) return;

                const instance = card.getAttribute('data-instance');
                if (instance) {
                    // Navigate using modern URL format
                    const { navigateToProject } = await import('../../utils/navigation.js');
                    await navigateToProject(instance);
                }
            });
        });

        // Vault cards - navigate to vault on click
        const vaultCards = this.element.querySelectorAll('.vault-card[data-vault]');
        vaultCards.forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't navigate if clicking a button
                if (e.target.closest('button')) return;

                const vault = card.getAttribute('data-vault');
                if (vault) {
                    window.router?.navigate(`/vaults/${vault}`);
                }
            });
        });
    }

    onStateUpdate(oldState, newState) {
        // Re-setup DOM listeners when UI changes significantly
        this.setTimeout(() => {
            this.setupDOMEventListeners();
        }, 0);
    }

    onUnmount() {
        // Clean up wallet modal
        if (this.walletModal) {
            this.walletModal.hide();
            this.walletModal = null;
        }
    }
}

export default UserPortfolio;
