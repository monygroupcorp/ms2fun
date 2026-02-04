import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';

/**
 * StakingInterface Component
 *
 * Allows users to stake/unstake tokens and claim rewards.
 * Only displays if staking is enabled for the project.
 */
export class StakingInterface extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            loading: true,
            error: null,
            stakingEnabled: false,
            stakingStats: null,
            userStakingInfo: null,
            pendingRewards: '0',
            tokenBalance: '0',
            stakeAmount: '',
            unstakeAmount: '',
            txPending: false
        };
        this._rewardsInterval = null;
    }

    async onMount() {
        await this.loadData();
        this.setupSubscriptions();
        this.startRewardsPolling();
    }

    onUnmount() {
        if (this._rewardsInterval) {
            clearInterval(this._rewardsInterval);
            this._rewardsInterval = null;
        }
        if (this._unsubscribers) {
            this._unsubscribers.forEach(unsub => unsub());
        }
    }

    setupSubscriptions() {
        this._unsubscribers = [
            eventBus.on('transaction:confirmed', () => this.loadData()),
            eventBus.on('account:changed', () => this.loadData()),
            eventBus.on('wallet:connected', () => this.loadData()),
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false }))
        ];
    }

    startRewardsPolling() {
        // Poll pending rewards every 30 seconds for live updates
        this._rewardsInterval = setInterval(() => {
            this.updatePendingRewards();
        }, 30000);
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Check if staking is enabled
            const stakingEnabled = await this.adapter.stakingEnabled().catch(() => false);

            if (!stakingEnabled) {
                this.setState({ loading: false, stakingEnabled: false });
                return;
            }

            const walletAddress = walletService.getAddress();

            // Load staking stats
            const stakingStats = await this.adapter.getStakingStats().catch(e => {
                console.warn('[StakingInterface] getStakingStats failed:', e);
                return null;
            });

            // Load user data if wallet connected
            let userStakingInfo = null;
            let pendingRewards = '0';
            let tokenBalance = '0';

            if (walletAddress) {
                [userStakingInfo, pendingRewards, tokenBalance] = await Promise.all([
                    this.adapter.getStakingInfo(walletAddress).catch(() => null),
                    this.adapter.calculatePendingRewards(walletAddress).catch(() => '0'),
                    this.adapter.getTokenBalance(walletAddress).catch(() => '0')
                ]);
            }

            this.setState({
                loading: false,
                stakingEnabled: true,
                stakingStats,
                userStakingInfo,
                pendingRewards,
                tokenBalance
            });
        } catch (error) {
            console.error('[StakingInterface] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load staking data'
            });
        }
    }

    async updatePendingRewards() {
        const walletAddress = walletService.getAddress();
        if (!walletAddress || !this.state.stakingEnabled) return;

        try {
            const pendingRewards = await this.adapter.calculatePendingRewards(walletAddress);
            this.setState({ pendingRewards });
        } catch (error) {
            console.warn('[StakingInterface] Failed to update pending rewards:', error);
        }
    }

    async handleStake() {
        const { stakeAmount, tokenBalance } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        const amount = parseFloat(stakeAmount);
        const balance = parseFloat(tokenBalance);

        if (amount > balance) {
            this.setState({ error: 'Insufficient token balance' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            // Convert to wei (tokens use 18 decimals like ETH in ERC404)
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(stakeAmount, 18).toString();

            await this.adapter.stake(amountWei);

            this.setState({ stakeAmount: '', txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[StakingInterface] Stake error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Staking failed'
            });
        }
    }

    async handleUnstake() {
        const { unstakeAmount, userStakingInfo } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        const amount = parseFloat(unstakeAmount);
        const staked = parseFloat(userStakingInfo?.stakedAmount || '0');

        if (amount > staked) {
            this.setState({ error: 'Insufficient staked balance' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(unstakeAmount, 18).toString();

            await this.adapter.unstake(amountWei);

            this.setState({ unstakeAmount: '', txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[StakingInterface] Unstake error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Unstaking failed'
            });
        }
    }

    async handleClaimRewards() {
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        const rewards = parseFloat(this.state.pendingRewards || '0');
        if (rewards <= 0) {
            this.setState({ error: 'No rewards to claim' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null });

            await this.adapter.claimStakerRewards();

            this.setState({ txPending: false });
            await this.loadData();
        } catch (error) {
            console.error('[StakingInterface] Claim rewards error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Claiming rewards failed'
            });
        }
    }

    handleInputChange(field, value) {
        this.setState({ [field]: value, error: null });
    }

    handleMaxStake() {
        this.setState({ stakeAmount: this.state.tokenBalance });
    }

    handleMaxUnstake() {
        const staked = this.state.userStakingInfo?.stakedAmount || '0';
        this.setState({ unstakeAmount: staked });
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="staking-interface loading">
                    <div class="loading-spinner"></div>
                    <p>Loading staking info...</p>
                </div>
            `;
        }

        if (!this.state.stakingEnabled) {
            return `
                <div class="staking-interface disabled marble-bg">
                    <div class="panel-header">
                        <h3>Staking</h3>
                        <span class="status-badge disabled">Not Available</span>
                    </div>
                    <p class="disabled-message">Staking is not enabled for this project.</p>
                </div>
            `;
        }

        const { stakingStats, userStakingInfo, pendingRewards, tokenBalance, txPending, error } = this.state;
        const walletConnected = !!walletService.getAddress();

        return `
            <div class="staking-interface marble-bg">
                <div class="panel-header">
                    <h3>Staking</h3>
                    <span class="status-badge enabled">Active</span>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                ${this.renderGlobalStats(stakingStats)}

                ${walletConnected ? this.renderUserSection(userStakingInfo, pendingRewards, tokenBalance, txPending) : `
                    <div class="connect-prompt">
                        <p>Connect your wallet to stake tokens</p>
                    </div>
                `}
            </div>
        `;
    }

    renderGlobalStats(stats) {
        if (!stats) return '';

        return `
            <div class="staking-stats-section">
                <h4>Protocol Stats</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Total Staked</span>
                        <span class="stat-value">${this.formatNumber(parseFloat(stats.totalStaked || '0'))}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Total Stakers</span>
                        <span class="stat-value">${stats.totalStakers || 0}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Reward Rate</span>
                        <span class="stat-value">${parseFloat(stats.rewardRate || '0').toFixed(6)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderUserSection(userInfo, pendingRewards, tokenBalance, txPending) {
        const stakedAmount = parseFloat(userInfo?.stakedAmount || '0');
        const rewards = parseFloat(pendingRewards || '0');
        const balance = parseFloat(tokenBalance || '0');

        return `
            <div class="user-staking-section">
                <h4>Your Position</h4>
                <div class="user-stats">
                    <div class="stat-item">
                        <span class="stat-label">Staked</span>
                        <span class="stat-value">${this.formatNumber(stakedAmount)}</span>
                    </div>
                    <div class="stat-item highlight">
                        <span class="stat-label">Pending Rewards</span>
                        <span class="stat-value rewards">${this.formatNumber(rewards)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Available to Stake</span>
                        <span class="stat-value">${this.formatNumber(balance)}</span>
                    </div>
                </div>

                <div class="staking-actions">
                    <div class="action-group">
                        <label>Stake Tokens</label>
                        <div class="input-row">
                            <input
                                type="number"
                                class="stake-input"
                                placeholder="0.0"
                                value="${this.state.stakeAmount}"
                                data-action="stake-amount"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="max-btn" data-action="max-stake" ${txPending ? 'disabled' : ''}>MAX</button>
                        </div>
                        <button class="action-btn stake-btn" data-action="stake" ${txPending || balance <= 0 ? 'disabled' : ''}>
                            ${txPending ? 'Processing...' : 'Stake'}
                        </button>
                    </div>

                    <div class="action-group">
                        <label>Unstake Tokens</label>
                        <div class="input-row">
                            <input
                                type="number"
                                class="unstake-input"
                                placeholder="0.0"
                                value="${this.state.unstakeAmount}"
                                data-action="unstake-amount"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="max-btn" data-action="max-unstake" ${txPending ? 'disabled' : ''}>MAX</button>
                        </div>
                        <button class="action-btn unstake-btn" data-action="unstake" ${txPending || stakedAmount <= 0 ? 'disabled' : ''}>
                            ${txPending ? 'Processing...' : 'Unstake'}
                        </button>
                    </div>
                </div>

                <div class="claim-section">
                    <button class="action-btn claim-btn" data-action="claim" ${txPending || rewards <= 0 ? 'disabled' : ''}>
                        ${txPending ? 'Processing...' : `Claim Rewards (${this.formatNumber(rewards)})`}
                    </button>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMListeners();
    }

    setupDOMListeners() {
        const container = this._element;
        if (!container) return;

        container.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            switch (action) {
                case 'stake':
                    this.handleStake();
                    break;
                case 'unstake':
                    this.handleUnstake();
                    break;
                case 'claim':
                    this.handleClaimRewards();
                    break;
                case 'max-stake':
                    this.handleMaxStake();
                    break;
                case 'max-unstake':
                    this.handleMaxUnstake();
                    break;
            }
        });

        container.addEventListener('input', (e) => {
            const action = e.target.dataset.action;
            if (action === 'stake-amount') {
                this.handleInputChange('stakeAmount', e.target.value);
            } else if (action === 'unstake-amount') {
                this.handleInputChange('unstakeAmount', e.target.value);
            }
        });
    }

    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(4);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
