import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';

/**
 * StakingSection Component
 *
 * Simplified staking UI for the Token tab.
 * Allows users to stake/unstake tokens and claim rewards.
 */
export class StakingSection extends Component {
    constructor(adapter) {
        super();
        this.adapter = adapter;
        this.state = {
            loading: true,
            stakingEnabled: false,
            userStaked: '0',
            claimableRewards: '0',
            totalStaked: '0',
            txPending: false,
            error: null,
            success: null
        };

        // Form values stored outside state to avoid re-renders
        this._formValues = {
            stakeAmount: '',
            unstakeAmount: ''
        };
    }

    async onMount() {
        await this.loadData();
        this.setupSubscriptions();
    }

    onUnmount() {
        // Subscriptions are automatically cleaned up via Component.subscribe()
    }

    setupSubscriptions() {
        this.subscribe('wallet:connected', () => this.loadData());
        this.subscribe('wallet:changed', () => this.loadData());
        this.subscribe('wallet:disconnected', () => {
            this.setState({
                userStaked: '0',
                claimableRewards: '0'
            });
        });
        this.subscribe('transaction:confirmed', () => this.loadData());
    }

    /**
     * Check if wallet is connected
     * @returns {boolean}
     */
    isConnected() {
        return walletService.isConnected();
    }

    /**
     * Load staking data from the adapter
     */
    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Check if staking is enabled
            const stakingEnabled = await this.adapter.stakingEnabled().catch(() => false);

            if (!stakingEnabled) {
                this.setState({
                    loading: false,
                    stakingEnabled: false
                });
                return;
            }

            // Get global staking stats
            const stakingStats = await this.adapter.getStakingStats().catch(e => {
                console.warn('[StakingSection] getStakingStats failed:', e);
                return null;
            });

            const totalStaked = stakingStats?.totalStaked || '0';

            // Get user staking info if connected
            let userStaked = '0';
            let claimableRewards = '0';

            if (this.isConnected()) {
                const walletAddress = walletService.getAddress();

                const userInfo = await this.adapter.getUserStakingInfo
                    ? this.adapter.getUserStakingInfo(walletAddress).catch(() => null)
                    : this.adapter.getStakingInfo(walletAddress).catch(() => null);

                if (userInfo) {
                    userStaked = userInfo.stakedAmount || '0';
                    claimableRewards = userInfo.pendingRewards || '0';
                }

                // Also try to get pending rewards separately if available
                const pendingRewards = await this.adapter.calculatePendingRewards(walletAddress).catch(() => null);
                if (pendingRewards) {
                    claimableRewards = pendingRewards;
                }
            }

            this.setState({
                loading: false,
                stakingEnabled: true,
                totalStaked,
                userStaked,
                claimableRewards
            });
        } catch (error) {
            console.error('[StakingSection] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load staking data'
            });
        }
    }

    /**
     * Handle stake action
     */
    async handleStake() {
        const amount = this._formValues.stakeAmount;

        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            // Convert to wei
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(amount, 18).toString();

            await this.adapter.stake(amountWei);

            this._formValues.stakeAmount = '';
            this.setState({ txPending: false, success: 'Successfully staked tokens' });
            await this.loadData();

            // Clear success message after 3 seconds
            this.setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('[StakingSection] Stake error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Staking failed'
            });
        }
    }

    /**
     * Handle unstake action
     */
    async handleUnstake() {
        const amount = this._formValues.unstakeAmount;

        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(amount, 18).toString();

            await this.adapter.unstake(amountWei);

            this._formValues.unstakeAmount = '';
            this.setState({ txPending: false, success: 'Successfully unstaked tokens' });
            await this.loadData();

            this.setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('[StakingSection] Unstake error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Unstaking failed'
            });
        }
    }

    /**
     * Handle claim rewards action
     */
    async handleClaim() {
        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        const rewards = parseFloat(this.state.claimableRewards || '0');
        if (rewards <= 0) {
            this.setState({ error: 'No rewards to claim' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            await this.adapter.claimStakerRewards();

            this.setState({ txPending: false, success: 'Successfully claimed rewards' });
            await this.loadData();

            this.setTimeout(() => {
                this.setState({ success: null });
            }, 3000);
        } catch (error) {
            console.error('[StakingSection] Claim error:', error);
            this.setState({
                txPending: false,
                error: error.message || 'Claiming rewards failed'
            });
        }
    }

    /**
     * Handle input change
     */
    handleInputChange(field, value) {
        this._formValues[field] = value;
        this.setState({ error: null });
    }

    /**
     * Set max stake amount
     */
    async handleMaxStake() {
        if (!this.isConnected()) return;

        try {
            const walletAddress = walletService.getAddress();
            const balance = await this.adapter.getTokenBalance(walletAddress).catch(() => '0');
            this._formValues.stakeAmount = balance;
            this.update();
        } catch (error) {
            console.warn('[StakingSection] Failed to get max stake amount:', error);
        }
    }

    /**
     * Set max unstake amount
     */
    handleMaxUnstake() {
        this._formValues.unstakeAmount = this.state.userStaked || '0';
        this.update();
    }

    /**
     * Format number for display
     */
    formatNumber(num) {
        const n = parseFloat(num);
        if (isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(4);
    }

    /**
     * Escape HTML for safe display
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMListeners();
    }

    setupDOMListeners() {
        const container = this.element;
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
                    this.handleClaim();
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

    render() {
        if (this.state.loading) {
            return `
                <div class="staking-section loading">
                    <div class="loading-spinner"></div>
                    <p>Loading staking info...</p>
                </div>
            `;
        }

        if (!this.state.stakingEnabled) {
            return `
                <div class="staking-section disabled">
                    <div class="panel-header">
                        <h3>Staking</h3>
                        <span class="status-badge disabled">Not Available</span>
                    </div>
                    <p class="disabled-message">Staking not yet enabled</p>
                </div>
            `;
        }

        const { totalStaked, userStaked, claimableRewards, txPending, error, success } = this.state;
        const connected = this.isConnected();

        return `
            <div class="staking-section">
                <div class="panel-header">
                    <h3>Staking</h3>
                    <span class="status-badge enabled">Active</span>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}
                ${success ? `<div class="success-banner">${this.escapeHtml(success)}</div>` : ''}

                <div class="staking-global-stat">
                    <span class="stat-label">Total Staked</span>
                    <span class="stat-value">${this.formatNumber(totalStaked)}</span>
                </div>

                ${connected ? this.renderConnectedSection(userStaked, claimableRewards, txPending) : `
                    <div class="connect-prompt">
                        <p>Connect wallet to stake</p>
                    </div>
                `}
            </div>
        `;
    }

    renderConnectedSection(userStaked, claimableRewards, txPending) {
        const stakedAmount = parseFloat(userStaked || '0');
        const rewards = parseFloat(claimableRewards || '0');

        return `
            <div class="staking-user-section">
                <div class="staking-user-stats">
                    <div class="stat-item">
                        <span class="stat-label">Your Staked</span>
                        <span class="stat-value">${this.formatNumber(stakedAmount)}</span>
                    </div>
                    <div class="stat-item highlight">
                        <span class="stat-label">Claimable Rewards</span>
                        <span class="stat-value rewards">${this.formatNumber(rewards)}</span>
                    </div>
                </div>

                <div class="staking-actions">
                    <div class="action-group">
                        <label>Stake</label>
                        <div class="input-row">
                            <input
                                type="number"
                                class="stake-input"
                                placeholder="0.0"
                                value="${this._formValues.stakeAmount}"
                                data-action="stake-amount"
                                ${txPending ? 'disabled' : ''}
                            />
                            <button class="max-btn" data-action="max-stake" ${txPending ? 'disabled' : ''}>MAX</button>
                        </div>
                        <button class="action-btn stake-btn" data-action="stake" ${txPending ? 'disabled' : ''}>
                            ${txPending ? 'Processing...' : 'Stake'}
                        </button>
                    </div>

                    <div class="action-group">
                        <label>Unstake</label>
                        <div class="input-row">
                            <input
                                type="number"
                                class="unstake-input"
                                placeholder="0.0"
                                value="${this._formValues.unstakeAmount}"
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
}
