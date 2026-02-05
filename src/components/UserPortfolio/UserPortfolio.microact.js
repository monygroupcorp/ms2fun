/**
 * UserPortfolio - Microact Version
 *
 * User's personal dashboard showing:
 * - ERC404 holdings (tokens, NFTs, staking positions)
 * - ERC1155 holdings (editions owned)
 * - Vault positions (contributions, shares, claimable)
 * - Storage settings (control local data usage)
 *
 * NOTE: CANDIDATE FOR EventIndexer migration
 * This component currently performs a full scan of ALL instances to find user holdings.
 * This could be replaced by event indexing - watching Transfer events to build
 * a portfolio index. See docs/plans/2026-02-04-contract-event-migration.md Finding #6.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';
import { queryService } from '../../services/QueryService.js';
import { userHoldingsIndex, SCAN_MODE } from '../../services/UserHoldingsIndex.js';
import { projectIndex } from '../../services/ProjectIndex.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class UserPortfolio extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isConnected: false,
            userAddress: null,
            loading: true,
            scanning: false,
            scanProgress: null,
            erc404Holdings: [],
            erc1155Holdings: [],
            vaultPositions: [],
            totalClaimable: '0',
            claiming: null,
            holdingsMode: SCAN_MODE.SMART,
            holdingsStats: null,
            error: null
        };
    }

    async didMount() {
        this.setupEventListeners();
        await this.checkWalletConnection();
    }

    setupEventListeners() {
        const unsubConnected = eventBus.on('wallet:connected', async ({ address }) => {
            this.setState({ isConnected: true, userAddress: address });
            await this.loadPortfolioData();
        });

        const unsubDisconnected = eventBus.on('wallet:disconnected', () => {
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

        const unsubTxConfirmed = eventBus.on('transaction:confirmed', async () => {
            if (this.state.isConnected) {
                await this.loadPortfolioData();
            }
        });

        const unsubHoldingsUpdated = eventBus.on('holdings:updated', async () => {
            await this.loadPortfolioData();
        });

        this.registerCleanup(() => {
            unsubConnected();
            unsubDisconnected();
            unsubTxConfirmed();
            unsubHoldingsUpdated();
        });
    }

    async checkWalletConnection() {
        if (walletService.isConnected()) {
            const address = walletService.getAddress();
            if (address) {
                this.setState({ isConnected: true, userAddress: address });
                await this.loadPortfolioData();
                return;
            }
        }

        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts?.length > 0) {
                    this.setState({ isConnected: true, userAddress: accounts[0] });
                    await this.loadPortfolioData();
                    return;
                }
            } catch (error) {
                console.log('[UserPortfolio] Could not check accounts:', error.message);
            }
        }

        this.setState({ loading: false });
    }

    async loadPortfolioData() {
        const { userAddress } = this.state;
        if (!userAddress) {
            this.setState({ loading: false });
            return;
        }

        this.setState({ loading: true, error: null });

        try {
            const holdingsMode = await userHoldingsIndex.getScanMode();
            let instanceAddresses = [];

            if (holdingsMode !== SCAN_MODE.OFF) {
                instanceAddresses = await userHoldingsIndex.getHoldingInstances(userAddress);

                if (instanceAddresses.length === 0) {
                    await this.performFullScan(userAddress);
                    instanceAddresses = await userHoldingsIndex.getHoldingInstances(userAddress);
                }
            }

            const portfolioData = await queryService.getPortfolioData(userAddress, instanceAddresses);
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

            if (holdingsMode === SCAN_MODE.SMART) {
                this.backgroundRescan(userAddress);
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
     * NOTE: This full scan approach is a candidate for EventIndexer replacement.
     * Instead of scanning all instances, we could watch Transfer events.
     */
    async performFullScan(userAddress) {
        this.setState({ scanning: true, scanProgress: { current: 0, total: 0 } });

        try {
            let allInstances = [];

            try {
                const allProjects = await projectIndex.getAllProjects(1000, 0);
                allInstances = allProjects.map(p => p.address);
            } catch (e) {
                console.log('[UserPortfolio] ProjectIndex failed:', e.message);
            }

            if (allInstances.length === 0) {
                const masterService = serviceFactory.getMasterService();
                const instances = await masterService.getAllInstances();
                allInstances = instances.map(i => i.instanceAddress || i.address || i);
            }

            this.setState({ scanProgress: { current: 0, total: allInstances.length } });

            const batchSize = 20;
            const holdingsMap = {};

            for (let i = 0; i < allInstances.length; i += batchSize) {
                const batch = allInstances.slice(i, i + batchSize);

                try {
                    const batchData = await queryService.getPortfolioData(userAddress, batch);

                    batch.forEach(addr => {
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
                    batch.forEach(addr => {
                        holdingsMap[addr] = false;
                    });
                }

                this.setState({
                    scanProgress: { current: Math.min(i + batchSize, allInstances.length), total: allInstances.length }
                });
            }

            await userHoldingsIndex.updateHoldingsBatch(userAddress, holdingsMap);
            await userHoldingsIndex.setLastFullScan(userAddress);
        } catch (error) {
            console.error('[UserPortfolio] Full scan failed:', error);
        } finally {
            this.setState({ scanning: false, scanProgress: null });
        }
    }

    async backgroundRescan(userAddress) {
        try {
            const staleInstances = await userHoldingsIndex.getStaleInstances(userAddress);
            if (staleInstances.length === 0) return;

            const holdingsMap = {};
            for (const addr of staleInstances) {
                try {
                    const data = await queryService.getPortfolioData(userAddress, [addr]);
                    holdingsMap[addr] = data.erc404Holdings?.length > 0 || data.erc1155Holdings?.length > 0;
                } catch (e) {
                    holdingsMap[addr] = false;
                }
            }

            await userHoldingsIndex.updateHoldingsBatch(userAddress, holdingsMap);

            if (Object.values(holdingsMap).some(v => v)) {
                await this.loadPortfolioData();
            }
        } catch (error) {
            console.warn('[UserPortfolio] Background rescan failed:', error);
        }
    }

    handleGoBack() {
        window.router?.navigate('/');
    }

    async handleConnectWallet() {
        eventBus.emit('wallet:showModal');
    }

    async handleRefreshHoldings() {
        const { userAddress } = this.state;
        if (!userAddress) return;

        await userHoldingsIndex.clearUserData(userAddress);
        await this.loadPortfolioData();
    }

    async handleClaimVaultFees(vaultAddress) {
        if (!this.state.userAddress) return;

        this.setState({ claiming: vaultAddress });

        try {
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

    renderHeader() {
        const { userAddress } = this.state;
        return h('div', { className: 'portfolio-header' },
            h('button', { className: 'back-btn', onClick: this.bind(this.handleGoBack) },
                h('span', { className: 'back-arrow' }, '\u2190'),
                'Back'
            ),
            h('h1', { className: 'page-title' }, 'Your Portfolio'),
            userAddress && h('p', { className: 'wallet-address' },
                h('span', { className: 'wallet-icon' }, '\u25c6'),
                this.formatAddress(userAddress)
            )
        );
    }

    renderConnectPrompt() {
        return h('div', { className: 'connect-prompt' },
            h('div', { className: 'prompt-icon' }, '\u25c6'),
            h('h2', null, 'Connect Your Wallet'),
            h('p', null, 'Connect your wallet to view your holdings, claimable rewards, and portfolio.'),
            h('button', {
                className: 'connect-btn primary-btn',
                onClick: this.bind(this.handleConnectWallet)
            }, 'Connect Wallet')
        );
    }

    renderLoading() {
        return h('div', { className: 'portfolio-loading' },
            h('div', { className: 'loading-spinner' }),
            h('p', null, 'Loading your portfolio...')
        );
    }

    renderScanning(progress) {
        const percent = progress?.total > 0
            ? Math.round((progress.current / progress.total) * 100)
            : 0;

        return h('div', { className: 'portfolio-scanning' },
            h('div', { className: 'loading-spinner' }),
            h('p', null, 'Scanning for holdings...'),
            h('div', { className: 'scan-progress' },
                h('div', { className: 'progress-bar' },
                    h('div', { className: 'progress-fill', style: { width: `${percent}%` } })
                ),
                h('span', { className: 'progress-text' }, `${progress?.current || 0} / ${progress?.total || 0}`)
            )
        );
    }

    renderOverview(totalClaimable) {
        const hasClaimable = totalClaimable && totalClaimable !== '0';

        return h('div', { className: 'portfolio-overview' },
            h('div', { className: 'overview-card' },
                h('span', { className: 'overview-label' }, 'Total Claimable'),
                h('span', { className: `overview-value ${hasClaimable ? 'has-value' : ''}` },
                    this.formatETH(totalClaimable)
                )
            ),
            h('div', { className: 'overview-actions' },
                h('button', {
                    className: 'action-btn secondary-btn',
                    onClick: this.bind(this.handleRefreshHoldings)
                }, 'Refresh Holdings')
            )
        );
    }

    renderERC404Holdings(holdings) {
        if (!holdings?.length) {
            return h('section', { className: 'holdings-section' },
                h('h2', { className: 'section-title' }, 'Token Holdings (ERC404)'),
                h('div', { className: 'empty-state' },
                    h('p', null, 'No ERC404 tokens found in your wallet.')
                )
            );
        }

        return h('section', { className: 'holdings-section' },
            h('h2', { className: 'section-title' }, 'Token Holdings (ERC404)'),
            h('div', { className: 'holdings-grid' },
                ...holdings.map(h => this.renderERC404Card(h))
            )
        );
    }

    renderERC404Card(holding) {
        return h('div', {
            className: 'holding-card erc404-card',
            'data-instance': holding.instance,
            key: holding.instance
        },
            h('div', { className: 'holding-header' },
                h('span', { className: 'holding-name' }, this.escapeHtml(holding.name || 'Unknown Project')),
                h('span', { className: 'holding-address' }, this.formatAddress(holding.instance))
            ),
            h('div', { className: 'holding-stats' },
                h('div', { className: 'stat' },
                    h('span', { className: 'stat-label' }, 'Tokens'),
                    h('span', { className: 'stat-value' }, this.formatBalance(holding.tokenBalance))
                ),
                h('div', { className: 'stat' },
                    h('span', { className: 'stat-label' }, 'NFTs'),
                    h('span', { className: 'stat-value' }, holding.nftBalance || 0)
                ),
                holding.stakedBalance && holding.stakedBalance !== '0' && h('div', { className: 'stat' },
                    h('span', { className: 'stat-label' }, 'Staked'),
                    h('span', { className: 'stat-value' }, this.formatBalance(holding.stakedBalance))
                )
            )
        );
    }

    renderVaultPositions(positions, claiming) {
        if (!positions?.length) {
            return h('section', { className: 'holdings-section' },
                h('h2', { className: 'section-title' }, 'Vault Positions'),
                h('div', { className: 'empty-state' },
                    h('p', null, 'You are not a benefactor of any vaults.')
                )
            );
        }

        return h('section', { className: 'holdings-section' },
            h('h2', { className: 'section-title' }, 'Vault Positions'),
            h('div', { className: 'holdings-grid' },
                ...positions.map(p => this.renderVaultCard(p, claiming))
            )
        );
    }

    renderVaultCard(position, claiming) {
        const isClaiming = claiming === position.vault;
        const hasClaimable = position.claimable && position.claimable !== '0';

        return h('div', {
            className: 'holding-card vault-card',
            'data-vault': position.vault,
            key: position.vault
        },
            h('div', { className: 'holding-header' },
                h('span', { className: 'holding-name' }, this.escapeHtml(position.name || 'Unknown Vault')),
                h('span', { className: 'holding-address' }, this.formatAddress(position.vault))
            ),
            h('div', { className: 'holding-stats' },
                h('div', { className: 'stat' },
                    h('span', { className: 'stat-label' }, 'Contribution'),
                    h('span', { className: 'stat-value' }, this.formatETH(position.contribution))
                ),
                h('div', { className: 'stat' },
                    h('span', { className: 'stat-label' }, 'Shares'),
                    h('span', { className: 'stat-value' }, this.formatBalance(position.shares, 0))
                ),
                h('div', { className: `stat ${hasClaimable ? 'highlight' : ''}` },
                    h('span', { className: 'stat-label' }, 'Claimable'),
                    h('span', { className: 'stat-value' }, this.formatETH(position.claimable))
                )
            ),
            hasClaimable && h('div', { className: 'holding-actions' },
                h('button', {
                    className: 'claim-btn',
                    disabled: isClaiming,
                    onClick: () => this.handleClaimVaultFees(position.vault)
                }, isClaiming ? 'Claiming...' : 'Claim Fees')
            )
        );
    }

    render() {
        const {
            isConnected, loading, scanning, scanProgress,
            erc404Holdings, erc1155Holdings, vaultPositions, totalClaimable, claiming, error
        } = this.state;

        return h('div', { className: 'user-portfolio' },
            this.renderHeader(),

            error && h('div', { className: 'error-banner' },
                h('span', { className: 'error-icon' }, '!'),
                h('span', { className: 'error-text' }, this.escapeHtml(error)),
                h('button', {
                    className: 'dismiss-btn',
                    onClick: () => this.setState({ error: null })
                }, 'Dismiss')
            ),

            !isConnected && this.renderConnectPrompt(),
            isConnected && loading && this.renderLoading(),
            isConnected && scanning && this.renderScanning(scanProgress),

            isConnected && !loading && !scanning && [
                this.renderOverview(totalClaimable),
                this.renderERC404Holdings(erc404Holdings),
                this.renderVaultPositions(vaultPositions, claiming)
            ]
        );
    }
}

export default UserPortfolio;
