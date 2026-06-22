/**
 * Portfolio - Gallery Brutalism v2
 *
 * User's personal portfolio page showing:
 * - Wallet info (address, member since, items, projects)
 * - Portfolio value breakdown (tokens, NFTs, staked, yield)
 * - Tabbed interface: Staking, Holdings, NFTs, Activity
 *
 * @example
 * h(Portfolio)
 */

import { h, Component } from '@monygroupcorp/microact';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { Layout } from '../components/Layout/Layout.js';
import { DataAdapter } from '../services/DataAdapter.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';
import walletService from '../services/WalletService.js';
import { eventBus } from '../core/EventBus.js';
import { queryService } from '../services/QueryService.js';
import { PriceOracle } from '../services/PriceOracle.js';
import { loadABI } from '../utils/abiLoader.js';
import { debug } from '../utils/debug.js';

export class Portfolio extends Component {
    constructor(props) {
        super(props);

        this.state = {
            // Wallet connection
            connected: false,
            address: null,

            // Active tab
            activeTab: 'staking',

            // Loading states
            loading: true,
            loadingStaking: true,
            loadingHoldings: true,
            loadingNFTs: true,
            loadingActivity: true,

            // Data
            portfolioValue: {
                total: '0.00',
                tokenHoldings: '0.00',
                nftValue: '0.00',
                stakedValue: '0.00',
                unclaimedYield: '0.00'
            },
            stakingPositions: [],
            holdings: [],
            nfts: [],
            activity: [],

            // Metadata
            memberSince: null,
            totalItems: 0,
            totalProjects: 0
        };
    }

    async didMount() {
        // Load route-specific CSS
        await stylesheetLoader.load('/src/core/route-portfolio-v2.css', 'route:portfolio');

        // Check wallet connection
        await this.checkWalletConnection();

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        const unsub1 = eventBus.on('wallet:connected', async (data) => {
            this.setState({ connected: true, address: data.address });
            await this.loadPortfolioData();
        });

        const unsub2 = eventBus.on('wallet:disconnected', () => {
            this.setState({
                connected: false,
                address: null,
                loading: false
            });
        });

        const unsub3 = eventBus.on('wallet:changed', async (data) => {
            this.setState({ address: data.address });
            await this.loadPortfolioData();
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
        });
    }

    async checkWalletConnection() {
        if (walletService.isConnected()) {
            const address = walletService.getAddress();
            if (address) {
                this.setState({ connected: true, address });
                await this.loadPortfolioData();
                return;
            }
        }

        // Check if MetaMask has accounts
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    this.setState({ connected: true, address: accounts[0] });
                    await this.loadPortfolioData();
                    return;
                }
            } catch (error) {
                console.log('[Portfolio] Could not check accounts:', error.message);
            }
        }

        this.setState({ loading: false });
    }

    async loadPortfolioData() {
        const { address } = this.state;
        if (!address) {
            this.setState({ loading: false });
            return;
        }

        this.setState({ loading: true });

        try {
            const { mode, config, provider } = this.props;
            debug.log('[Portfolio] Loading data for:', address);
            const t0 = performance.now();

            // Create price oracle
            const priceOracle = new PriceOracle(mode, provider);
            const ethPrice = await priceOracle.getETHPrice();
            debug.log(`[Portfolio] ETH price: $${ethPrice.toFixed(2)}`);

            // Create adapter
            const dataAdapter = new DataAdapter(mode, config, provider);

            // Load all activity to filter for user
            const allActivity = await dataAdapter.getActivity();

            // Filter activity where user is sender or receiver
            const userActivity = allActivity.filter(item => {
                const itemSender = item.sender?.toLowerCase();
                const itemReceiver = item.receiver?.toLowerCase();
                const userAddr = address.toLowerCase();
                return itemSender === userAddr || itemReceiver === userAddr;
            });

            // Get first transaction timestamp for "member since"
            let memberSince = 'Recent';
            if (userActivity.length > 0) {
                const firstTx = userActivity[userActivity.length - 1]; // Activity is sorted newest first
                const date = new Date(firstTx.timestamp * 1000);
                memberSince = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            }

            // Get unique projects user has interacted with
            const uniqueProjects = new Set(
                userActivity
                    .filter(item => item.projectAddress)
                    .map(item => item.projectAddress.toLowerCase())
            );
            const totalProjects = uniqueProjects.size;

            // Get all instance addresses to query holdings
            const instanceAddresses = Array.from(uniqueProjects);

            // Get portfolio data from QueryService
            let portfolioData = {
                erc404Holdings: [],
                erc1155Holdings: [],
                vaultPositions: [],
                totalClaimable: '0'
            };

            if (instanceAddresses.length > 0) {
                try {
                    portfolioData = await queryService.getPortfolioData(address, instanceAddresses);
                } catch (error) {
                    debug.warn('[Portfolio] QueryService failed, using empty portfolio:', error.message);
                }
            }

            // Calculate portfolio value
            let totalTokenValue = 0;
            let totalStakedValue = 0;
            let totalNFTCount = 0;

            // Process ERC404 holdings
            const erc404Holdings = (portfolioData.erc404Holdings || []).filter(holding => {
                const hasTokens = holding.tokenBalance && holding.tokenBalance !== '0';
                const hasNFTs = holding.nftBalance && holding.nftBalance > 0;
                const hasStaked = holding.stakedBalance && holding.stakedBalance !== '0';
                return hasTokens || hasNFTs || hasStaked;
            });

            // Count NFTs and calculate values
            erc404Holdings.forEach(holding => {
                if (holding.nftBalance > 0) {
                    totalNFTCount += holding.nftBalance;
                }
                // Note: We don't have price data, so we can't calculate ETH value
                // For now, just track that we have holdings
            });

            // Process ERC1155 holdings
            const erc1155Holdings = (portfolioData.erc1155Holdings || []).filter(holding => {
                return holding.balances && holding.balances.some(b => b > 0);
            });

            erc1155Holdings.forEach(holding => {
                if (holding.balances) {
                    totalNFTCount += holding.balances.reduce((sum, b) => sum + b, 0);
                }
            });

            // Process vault positions (staking)
            const vaultPositions = (portfolioData.vaultPositions || []).filter(pos => {
                return pos.shares && pos.shares !== '0';
            });

            // Total claimable yield
            const totalClaimable = portfolioData.totalClaimable || '0';
            const claimableETH = parseFloat(ethers.utils.formatEther(totalClaimable));

            // Format holdings for display WITH position P&L calculation
            const holdings = await Promise.all(erc404Holdings.map(async (holding) => {
                // Calculate position P&L from transaction history
                let positionPnL = '—';
                let changePositive = null;

                try {
                    const pnl = await this.calculatePositionPnL(
                        holding.instance,
                        address,
                        userActivity,
                        provider,
                        config
                    );
                    if (pnl !== null) {
                        positionPnL = `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`;
                        changePositive = pnl > 0;
                    }
                } catch (error) {
                    debug.warn('[Portfolio] Failed to calculate P&L for', holding.name, error.message);
                }

                return {
                    name: holding.name || 'Unknown Project',
                    type: 'ERC404',
                    balance: this.formatBalance(holding.tokenBalance, 18),
                    value: '—', // Could calculate from curve price if needed
                    change24h: positionPnL,
                    changePositive,
                    acquired: '—',
                    address: holding.instance
                };
            }));

            // Add ERC1155 holdings (no P&L for editions)
            const erc1155FormattedHoldings = erc1155Holdings.map(holding => ({
                name: holding.name || 'Unknown Project',
                type: 'ERC1155',
                balance: `${holding.balances?.reduce((sum, b) => sum + b, 0) || 0} Editions`,
                value: '—',
                change24h: '—',
                changePositive: null,
                acquired: '—',
                address: holding.instance
            }));

            const allHoldings = holdings.concat(erc1155FormattedHoldings);

            // Format staking positions for display WITH share of pool calculation
            const stakingPositions = await Promise.all(vaultPositions.map(async (pos) => {
                const contributionETH = parseFloat(ethers.utils.formatEther(pos.contribution || '0'));
                const claimableETH = parseFloat(ethers.utils.formatEther(pos.claimable || '0'));
                const contributionUSD = contributionETH * ethPrice;
                const claimableUSD = claimableETH * ethPrice;

                // Calculate share of pool
                let shareOfPool = '—';
                try {
                    const vaultABI = await loadABI('UltraAlignmentVault');
                    const vaultContract = new ethers.Contract(pos.vault, vaultABI, provider);
                    const totalSupply = await vaultContract.totalSupply();

                    if (totalSupply && totalSupply.gt(0)) {
                        const userShares = ethers.BigNumber.from(pos.shares);
                        const percentage = userShares.mul(10000).div(totalSupply).toNumber() / 100;
                        shareOfPool = `${percentage.toFixed(2)}%`;
                    }
                } catch (error) {
                    debug.warn('[Portfolio] Failed to calculate share of pool:', error.message);
                }

                return {
                    name: pos.name || 'Unknown Vault',
                    type: pos.vaultType || 'Vault',
                    stakedAmount: '—', // Would need instance data
                    stakedValue: `${contributionETH.toFixed(4)} ETH`,
                    stakedValueUSD: `($${priceOracle.formatUSD(contributionUSD)})`,
                    shareOfPool,
                    unclaimedYield: `${claimableETH.toFixed(4)} ETH`,
                    unclaimedYieldUSD: `($${priceOracle.formatUSD(claimableUSD)})`,
                    vault: pos.vault,
                    shares: pos.shares
                };
            }));

            // Build NFT list from ERC404 holdings
            const nfts = [];
            erc404Holdings.forEach(holding => {
                if (holding.nftBalance > 0) {
                    for (let i = 0; i < Math.min(holding.nftBalance, 10); i++) {
                        nfts.push({
                            id: `${i + 1}`,
                            name: `${holding.name || 'NFT'} #${i + 1}`,
                            project: holding.name || 'Unknown',
                            value: '—'
                        });
                    }
                }
            });

            // Format activity for display
            const activityItems = userActivity.slice(0, 20).map(item => ({
                type: this.getActivityType(item),
                time: this.formatTimestamp(item.timestamp),
                description: item.text || this.formatActivityDescription(item)
            }));

            // Calculate total staked value
            let totalStakedETH = 0;
            stakingPositions.forEach(pos => {
                const match = pos.stakedValue.match(/([0-9.]+) ETH/);
                if (match) {
                    totalStakedETH += parseFloat(match[1]);
                }
            });

            // Calculate total portfolio value
            const totalPortfolioETH = totalStakedETH + claimableETH; // Note: token holdings don't have prices yet
            const totalPortfolioUSD = totalPortfolioETH * ethPrice;

            const t1 = performance.now();
            debug.log(`[Portfolio] ✓ Data loaded in ${(t1 - t0).toFixed(0)}ms:`, {
                holdings: allHoldings.length,
                staking: stakingPositions.length,
                nfts: nfts.length,
                activity: activityItems.length,
                totalETH: totalPortfolioETH.toFixed(4),
                ethPrice: `$${ethPrice.toFixed(2)}`
            });

            this.setState({
                loading: false,
                loadingStaking: false,
                loadingHoldings: false,
                loadingNFTs: false,
                loadingActivity: false,
                memberSince,
                totalItems: totalNFTCount,
                totalProjects,
                portfolioValue: {
                    total: `${totalPortfolioETH.toFixed(4)} ETH`,
                    totalUSD: priceOracle.formatUSD(totalPortfolioUSD),
                    tokenHoldings: `${allHoldings.length} tokens`,
                    nftValue: `${totalNFTCount} NFTs`,
                    stakedValue: `${totalStakedETH.toFixed(4)} ETH`,
                    stakedValueUSD: priceOracle.formatUSD(totalStakedETH * ethPrice),
                    unclaimedYield: `${claimableETH.toFixed(4)} ETH`,
                    unclaimedYieldUSD: priceOracle.formatUSD(claimableETH * ethPrice)
                },
                stakingPositions,
                holdings: allHoldings,
                nfts,
                activity: activityItems
            });

        } catch (error) {
            debug.error('[Portfolio] Failed to load data:', error);
            this.setState({
                loading: false,
                loadingStaking: false,
                loadingHoldings: false,
                loadingNFTs: false,
                loadingActivity: false,
                error: error.message
            });
        }
    }

    /**
     * Calculate position P&L from transaction history
     * Compares user's average entry price to current bonding curve price
     */
    async calculatePositionPnL(instanceAddress, userAddress, userActivity, provider, config) {
        try {
            // Filter transactions for this specific instance
            const instanceTxs = userActivity.filter(item =>
                item.projectAddress?.toLowerCase() === instanceAddress.toLowerCase() &&
                item.type === 'trade'
            );

            if (instanceTxs.length === 0) {
                return null; // No trades found
            }

            // Calculate average entry price from buys
            let totalETHSpent = 0;
            let totalTokensReceived = 0;

            instanceTxs.forEach(tx => {
                const isBuy = tx.receiver?.toLowerCase() === userAddress.toLowerCase();
                if (isBuy && tx.amount) {
                    // This is a buy - user received tokens
                    // Extract ETH spent and tokens received from activity description
                    // Format is typically: "Bought X tokens for Y ETH" or similar
                    const amountMatch = tx.amount.match(/([0-9.]+)K?/);
                    if (amountMatch) {
                        let tokens = parseFloat(amountMatch[1]);
                        if (tx.amount.includes('K')) tokens *= 1000;
                        totalTokensReceived += tokens;

                        // Try to extract ETH value from description
                        const ethMatch = tx.text?.match(/([0-9.]+)\s*ETH/);
                        if (ethMatch) {
                            totalETHSpent += parseFloat(ethMatch[1]);
                        }
                    }
                }
            });

            if (totalTokensReceived === 0 || totalETHSpent === 0) {
                return null; // Can't calculate P&L
            }

            // Calculate average entry price (ETH per token)
            const avgEntryPrice = totalETHSpent / totalTokensReceived;

            // Query current bonding curve price
            const erc404ABI = await loadABI('ERC404BondingInstance');
            const instanceContract = new ethers.Contract(instanceAddress, erc404ABI, provider);

            // Get current buy price for 1 token (1e18 wei)
            const oneToken = ethers.utils.parseEther('1');
            const currentPriceWei = await instanceContract.getBuyPrice(oneToken);
            const currentPrice = parseFloat(ethers.utils.formatEther(currentPriceWei));

            // Calculate percentage change
            const pnlPercent = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;

            debug.log(`[Portfolio] P&L for ${instanceAddress}:`, {
                avgEntry: avgEntryPrice.toFixed(6),
                current: currentPrice.toFixed(6),
                pnl: `${pnlPercent.toFixed(2)}%`
            });

            return pnlPercent;

        } catch (error) {
            debug.warn('[Portfolio] calculatePositionPnL failed:', error.message);
            return null;
        }
    }

    getActivityType(item) {
        if (item.type === 'transfer') return 'Transfer';
        if (item.type === 'trade') return 'Trade';
        if (item.type === 'mint') return 'Minted NFT';
        if (item.type === 'message') return 'Message';
        return 'Activity';
    }

    formatActivityDescription(item) {
        const { type, sender, receiver, amount, project } = item;
        const isSender = sender?.toLowerCase() === this.state.address?.toLowerCase();

        if (type === 'transfer') {
            return isSender
                ? `Sent ${amount || '?'} to ${this.truncateAddress(receiver)}`
                : `Received ${amount || '?'} from ${this.truncateAddress(sender)}`;
        }
        if (type === 'trade') {
            return `Traded ${amount || '?'} on ${project || 'project'}`;
        }
        if (type === 'mint') {
            return `Minted ${amount || '?'} from ${project || 'project'}`;
        }
        return item.text || 'Activity';
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'Recent';
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    formatBalance(balance, decimals = 18) {
        if (!balance || balance === '0') return '0';
        try {
            const formatted = ethers.utils.formatUnits(balance, decimals);
            const num = parseFloat(formatted);
            if (num < 0.01) return '< 0.01';
            if (num < 1) return num.toFixed(4);
            if (num < 1000) return num.toFixed(2);
            if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
            return `${(num / 1000000).toFixed(2)}M`;
        } catch (error) {
            return '0';
        }
    }

    handleTabClick = (tabName) => {
        this.setState({ activeTab: tabName });
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const {
            connected, address, loading, activeTab, error,
            memberSince, totalItems, totalProjects,
            portfolioValue, stakingPositions, holdings, nfts, activity
        } = this.state;

        return h(Layout, {
            currentPath: '/portfolio',
            children: h('div', { className: 'content' },
                // Error state
                error && h('div', { className: 'empty-state' },
                    h('div', { className: 'empty-state-title' }, 'Error Loading Portfolio'),
                    h('div', { className: 'empty-state-description' }, error)
                ),

                // Wallet not connected state
                !connected && !loading && !error && h('div', { className: 'empty-state' },
                    h('div', { className: 'empty-state-title' }, 'Connect Wallet'),
                    h('div', { className: 'empty-state-description' },
                        'Connect your wallet to view your portfolio'
                    )
                ),

                // Loading state
                loading && h('div', { className: 'empty-state' },
                    h('div', { className: 'empty-state-title' }, 'Loading Portfolio...'),
                    h('div', { className: 'empty-state-description' },
                        'Indexing your holdings and activity'
                    )
                ),

                // Connected state with data
                connected && !loading && !error && [
                    // Page Header
                    h('div', { className: 'page-header' },
                        h('div', { className: 'wallet-info' },
                            h('div', { className: 'wallet-avatar' }, address ? address.slice(2, 5).toUpperCase() : '0x'),
                            h('div', { className: 'wallet-details' },
                                h('div', { className: 'wallet-address' }, this.truncateAddress(address)),
                                h('div', { className: 'wallet-meta' },
                                    h('span', null, `Member since ${memberSince}`),
                                    h('span', null, '•'),
                                    h('span', null, `${totalItems} items`),
                                    h('span', null, '•'),
                                    h('span', null, `${totalProjects} projects`)
                                )
                            ),
                            h('div', { className: 'wallet-actions' },
                                h('button', { className: 'btn btn-secondary' }, 'Share Profile'),
                                h('button', { className: 'btn btn-secondary' }, 'Export Data')
                            )
                        )
                    ),

                    // Portfolio Value (ETH primary, USD secondary)
                    h('div', { className: 'portfolio-value' },
                        h('div', { className: 'portfolio-value-title' }, 'Total Portfolio Value'),
                        h('div', { className: 'portfolio-value-amount' }, portfolioValue.total),
                        portfolioValue.totalUSD && h('div', {
                            className: 'portfolio-value-usd',
                            style: {
                                fontSize: 'var(--font-size-h4)',
                                color: 'var(--text-secondary)',
                                marginTop: 'var(--space-2)'
                            }
                        }, portfolioValue.totalUSD),
                        h('div', { className: 'portfolio-breakdown' },
                            h('div', { className: 'breakdown-item' },
                                h('div', { className: 'breakdown-label' }, 'Token Holdings'),
                                h('div', { className: 'breakdown-value' }, portfolioValue.tokenHoldings)
                            ),
                            h('div', { className: 'breakdown-item' },
                                h('div', { className: 'breakdown-label' }, 'NFT Value'),
                                h('div', { className: 'breakdown-value' }, portfolioValue.nftValue)
                            ),
                            h('div', { className: 'breakdown-item' },
                                h('div', { className: 'breakdown-label' }, 'Staked Value'),
                                h('div', null,
                                    h('div', { className: 'breakdown-value' }, portfolioValue.stakedValue),
                                    portfolioValue.stakedValueUSD && h('div', {
                                        style: {
                                            fontSize: 'var(--font-size-caption)',
                                            color: 'var(--text-secondary)',
                                            marginTop: 'var(--space-1)'
                                        }
                                    }, portfolioValue.stakedValueUSD)
                                )
                            ),
                            h('div', { className: 'breakdown-item' },
                                h('div', { className: 'breakdown-label' }, 'Unclaimed Yield'),
                                h('div', null,
                                    h('div', { className: 'breakdown-value' }, portfolioValue.unclaimedYield),
                                    portfolioValue.unclaimedYieldUSD && h('div', {
                                        style: {
                                            fontSize: 'var(--font-size-caption)',
                                            color: 'var(--text-secondary)',
                                            marginTop: 'var(--space-1)'
                                        }
                                    }, portfolioValue.unclaimedYieldUSD)
                                )
                            )
                        )
                    ),

                    // Tabs
                    h('div', { className: 'tabs' },
                        h('button', {
                            className: `tab ${activeTab === 'staking' ? 'active' : ''}`,
                            onclick: () => this.handleTabClick('staking')
                        }, 'Staking'),
                        h('button', {
                            className: `tab ${activeTab === 'holdings' ? 'active' : ''}`,
                            onclick: () => this.handleTabClick('holdings')
                        }, 'Holdings'),
                        h('button', {
                            className: `tab ${activeTab === 'nfts' ? 'active' : ''}`,
                            onclick: () => this.handleTabClick('nfts')
                        }, 'NFTs'),
                        h('button', {
                            className: `tab ${activeTab === 'activity' ? 'active' : ''}`,
                            onclick: () => this.handleTabClick('activity')
                        }, 'Activity')
                    ),

                    // Staking Tab
                    h('div', {
                        className: `tab-content ${activeTab === 'staking' ? 'active' : ''}`
                    },
                        h('div', { className: 'section-title' }, 'Staking Positions'),
                        stakingPositions.length > 0 ? [
                            h('div', { className: 'staking-positions' },
                                ...stakingPositions.map(position =>
                                    h('div', { className: 'staking-card' },
                                        h('div', { className: 'staking-header' },
                                            h('div', { className: 'staking-project' },
                                                h('div', { className: 'staking-project-name' }, position.name),
                                                h('div', { className: 'staking-project-type' }, position.type)
                                            )
                                        ),
                                        h('div', { className: 'staking-stats' },
                                            h('div', { className: 'staking-stat' },
                                                h('div', { className: 'staking-stat-label' }, 'Staked Amount'),
                                                h('div', { className: 'staking-stat-value' }, position.stakedAmount)
                                            ),
                                            h('div', { className: 'staking-stat' },
                                                h('div', { className: 'staking-stat-label' }, 'Staked Value'),
                                                h('div', null,
                                                    h('div', { className: 'staking-stat-value' }, position.stakedValue),
                                                    position.stakedValueUSD && h('div', {
                                                        style: {
                                                            fontSize: 'var(--font-size-caption)',
                                                            color: 'var(--text-secondary)',
                                                            marginTop: 'var(--space-1)',
                                                            fontFamily: 'var(--font-mono)'
                                                        }
                                                    }, position.stakedValueUSD)
                                                )
                                            ),
                                            h('div', { className: 'staking-stat' },
                                                h('div', { className: 'staking-stat-label' }, 'Share of Pool'),
                                                h('div', { className: 'staking-stat-value' }, position.shareOfPool)
                                            ),
                                            h('div', { className: 'staking-stat' },
                                                h('div', { className: 'staking-stat-label' }, 'Unclaimed Yield'),
                                                h('div', null,
                                                    h('div', { className: 'staking-stat-value' }, position.unclaimedYield),
                                                    position.unclaimedYieldUSD && h('div', {
                                                        style: {
                                                            fontSize: 'var(--font-size-caption)',
                                                            color: 'var(--text-secondary)',
                                                            marginTop: 'var(--space-1)',
                                                            fontFamily: 'var(--font-mono)'
                                                        }
                                                    }, position.unclaimedYieldUSD)
                                                )
                                            )
                                        ),
                                        h('div', { className: 'staking-actions' },
                                            h('button', { className: 'btn btn-primary' }, 'Claim Yield'),
                                            h('button', { className: 'btn btn-secondary' }, 'Unstake'),
                                            h('button', { className: 'btn btn-secondary' }, 'Add More')
                                        )
                                    )
                                )
                            ),
                            h('button', { className: 'btn btn-primary btn-full' },
                                `Claim All Yield (${portfolioValue.unclaimedYield} ETH)`
                            )
                        ] : h('div', { className: 'empty-state' },
                            h('div', { className: 'empty-state-title' }, 'No Staking Positions'),
                            h('div', { className: 'empty-state-description' },
                                'You don\'t have any active staking positions yet.'
                            )
                        )
                    ),

                    // Holdings Tab
                    h('div', {
                        className: `tab-content ${activeTab === 'holdings' ? 'active' : ''}`
                    },
                        h('div', { className: 'section-title' }, 'Token Holdings'),
                        h('div', { className: 'filters' },
                            h('select', { className: 'filter-select' },
                                h('option', null, 'All Projects'),
                                h('option', null, 'ERC404'),
                                h('option', null, 'ERC1155')
                            ),
                            h('select', { className: 'filter-select' },
                                h('option', null, 'Sort by Value'),
                                h('option', null, 'Sort by Amount'),
                                h('option', null, 'Sort by Date')
                            )
                        ),
                        holdings.length > 0 ? h('div', { className: 'holdings-table' },
                            h('div', { className: 'holdings-table-header' },
                                h('div', null, 'Project'),
                                h('div', null, 'Balance'),
                                h('div', null, 'Value'),
                                h('div', null, '24h Change'),
                                h('div', null, 'Acquired')
                            ),
                            ...holdings.map(holding =>
                                h('div', { className: 'holdings-table-row' },
                                    h('div', { className: 'holdings-project' },
                                        h('div', { className: 'holdings-project-name' }, holding.name),
                                        h('div', { className: 'holdings-project-type' }, holding.type)
                                    ),
                                    h('div', { className: 'holdings-value' }, holding.balance),
                                    h('div', { className: 'holdings-value' }, holding.value),
                                    h('div', {
                                        className: 'holdings-value',
                                        style: holding.changePositive !== null
                                            ? { color: holding.changePositive ? '#00ff00' : '#ff0000' }
                                            : {}
                                    }, holding.change24h),
                                    h('div', { className: 'holdings-value' }, holding.acquired)
                                )
                            )
                        ) : h('div', { className: 'empty-state' },
                            h('div', { className: 'empty-state-title' }, 'No Holdings'),
                            h('div', { className: 'empty-state-description' },
                                'You don\'t own any tokens yet.'
                            )
                        )
                    ),

                    // NFTs Tab
                    h('div', {
                        className: `tab-content ${activeTab === 'nfts' ? 'active' : ''}`
                    },
                        h('div', { className: 'section-title' }, 'NFT Collection'),
                        h('div', { className: 'filters' },
                            h('select', { className: 'filter-select' },
                                h('option', null, 'All Projects'),
                                h('option', null, 'ERC404'),
                                h('option', null, 'ERC721'),
                                h('option', null, 'ERC1155')
                            ),
                            h('select', { className: 'filter-select' },
                                h('option', null, 'Sort by Value'),
                                h('option', null, 'Sort by Recent'),
                                h('option', null, 'Sort by Rarity')
                            )
                        ),
                        nfts.length > 0 ? [
                            h('div', { className: 'nft-grid' },
                                ...nfts.map(nft =>
                                    h('div', { className: 'nft-card' },
                                        h('div', { className: 'nft-image' }, `#${nft.id}`),
                                        h('div', { className: 'nft-info' },
                                            h('div', { className: 'nft-name' }, nft.name),
                                            h('div', { className: 'nft-project' }, nft.project),
                                            h('div', { className: 'nft-value' }, `Est. ${nft.value}`)
                                        )
                                    )
                                )
                            ),
                            h('button', { className: 'btn btn-secondary btn-full' }, 'Load More')
                        ] : h('div', { className: 'empty-state' },
                            h('div', { className: 'empty-state-title' }, 'No NFTs'),
                            h('div', { className: 'empty-state-description' },
                                'You don\'t own any NFTs yet.'
                            )
                        )
                    ),

                    // Activity Tab
                    h('div', {
                        className: `tab-content ${activeTab === 'activity' ? 'active' : ''}`
                    },
                        h('div', { className: 'section-title' }, 'Recent Activity'),
                        h('div', { className: 'filters' },
                            h('select', { className: 'filter-select' },
                                h('option', null, 'All Activity'),
                                h('option', null, 'Buys'),
                                h('option', null, 'Sells'),
                                h('option', null, 'Stakes'),
                                h('option', null, 'Claims')
                            ),
                            h('select', { className: 'filter-select' },
                                h('option', null, 'Last 30 Days'),
                                h('option', null, 'Last 7 Days'),
                                h('option', null, 'Last 24 Hours'),
                                h('option', null, 'All Time')
                            )
                        ),
                        activity.length > 0 ? [
                            h('div', { className: 'activity-list' },
                                ...activity.map(item =>
                                    h('div', { className: 'activity-item' },
                                        h('div', { className: 'activity-header' },
                                            h('div', { className: 'activity-type' }, item.type),
                                            h('div', { className: 'activity-time' }, item.time)
                                        ),
                                        h('div', { className: 'activity-description' }, item.description)
                                    )
                                )
                            ),
                            h('button', { className: 'btn btn-secondary btn-full' }, 'Load More Activity')
                        ] : h('div', { className: 'empty-state' },
                            h('div', { className: 'empty-state-title' }, 'No Activity'),
                            h('div', { className: 'empty-state-description' },
                                'No recent activity to display.'
                            )
                        )
                    )
                ]
            )
        });
    }
}

export default Portfolio;
