/**
 * StakingInterface - Microact Version
 *
 * Allows users to stake/unstake tokens and claim rewards.
 * Only displays if staking is enabled for the project.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class StakingInterface extends Component {
    constructor(props = {}) {
        super(props);
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

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('transaction:confirmed', () => this.loadData());
        const unsub2 = eventBus.on('account:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub4 = eventBus.on('wallet:disconnected', () => this.setState({ loading: false }));

        // Start rewards polling
        this._rewardsInterval = setInterval(() => {
            this.updatePendingRewards();
        }, 30000);

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            if (this._rewardsInterval) {
                clearInterval(this._rewardsInterval);
                this._rewardsInterval = null;
            }
        });
    }

    isConnected() {
        return !!walletService.getAddress();
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const stakingEnabled = await this.adapter.stakingEnabled().catch(() => false);

            if (!stakingEnabled) {
                this.setState({ loading: false, stakingEnabled: false });
                return;
            }

            const walletAddress = walletService.getAddress();

            const stakingStats = await this.adapter.getStakingStats().catch(e => {
                console.warn('[StakingInterface] getStakingStats failed:', e);
                return null;
            });

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

    handleStakeAmountChange(e) {
        this.setState({ stakeAmount: e.target.value, error: null });
    }

    handleUnstakeAmountChange(e) {
        this.setState({ unstakeAmount: e.target.value, error: null });
    }

    handleMaxStake() {
        this.setState({ stakeAmount: this.state.tokenBalance });
    }

    handleMaxUnstake() {
        const staked = this.state.userStakingInfo?.stakedAmount || '0';
        this.setState({ unstakeAmount: staked });
    }

    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(4);
    }

    renderGlobalStats(stats) {
        if (!stats) return null;

        return h('div', { className: 'staking-stats-section' },
            h('h4', null, 'Protocol Stats'),
            h('div', { className: 'stats-grid' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Total Staked'),
                    h('span', { className: 'stat-value' }, this.formatNumber(parseFloat(stats.totalStaked || '0')))
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Total Stakers'),
                    h('span', { className: 'stat-value' }, stats.totalStakers || 0)
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Reward Rate'),
                    h('span', { className: 'stat-value' }, parseFloat(stats.rewardRate || '0').toFixed(6))
                )
            )
        );
    }

    renderUserSection() {
        const { userStakingInfo, pendingRewards, tokenBalance, txPending, stakeAmount, unstakeAmount } = this.state;
        const stakedAmount = parseFloat(userStakingInfo?.stakedAmount || '0');
        const rewards = parseFloat(pendingRewards || '0');
        const balance = parseFloat(tokenBalance || '0');

        return h('div', { className: 'user-staking-section' },
            h('h4', null, 'Your Position'),
            h('div', { className: 'user-stats' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Staked'),
                    h('span', { className: 'stat-value' }, this.formatNumber(stakedAmount))
                ),
                h('div', { className: 'stat-item highlight' },
                    h('span', { className: 'stat-label' }, 'Pending Rewards'),
                    h('span', { className: 'stat-value rewards' }, this.formatNumber(rewards))
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Available to Stake'),
                    h('span', { className: 'stat-value' }, this.formatNumber(balance))
                )
            ),

            h('div', { className: 'staking-actions' },
                h('div', { className: 'action-group' },
                    h('label', null, 'Stake Tokens'),
                    h('div', { className: 'input-row' },
                        h('input', {
                            type: 'number',
                            className: 'stake-input',
                            placeholder: '0.0',
                            value: stakeAmount,
                            onInput: this.bind(this.handleStakeAmountChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'max-btn',
                            onClick: this.bind(this.handleMaxStake),
                            disabled: txPending
                        }, 'MAX')
                    ),
                    h('button', {
                        className: 'action-btn stake-btn',
                        onClick: this.bind(this.handleStake),
                        disabled: txPending || balance <= 0
                    }, txPending ? 'Processing...' : 'Stake')
                ),

                h('div', { className: 'action-group' },
                    h('label', null, 'Unstake Tokens'),
                    h('div', { className: 'input-row' },
                        h('input', {
                            type: 'number',
                            className: 'unstake-input',
                            placeholder: '0.0',
                            value: unstakeAmount,
                            onInput: this.bind(this.handleUnstakeAmountChange),
                            disabled: txPending
                        }),
                        h('button', {
                            className: 'max-btn',
                            onClick: this.bind(this.handleMaxUnstake),
                            disabled: txPending
                        }, 'MAX')
                    ),
                    h('button', {
                        className: 'action-btn unstake-btn',
                        onClick: this.bind(this.handleUnstake),
                        disabled: txPending || stakedAmount <= 0
                    }, txPending ? 'Processing...' : 'Unstake')
                )
            ),

            h('div', { className: 'claim-section' },
                h('button', {
                    className: 'action-btn claim-btn',
                    onClick: this.bind(this.handleClaimRewards),
                    disabled: txPending || rewards <= 0
                }, txPending ? 'Processing...' : `Claim Rewards (${this.formatNumber(rewards)})`)
            )
        );
    }

    render() {
        const { loading, stakingEnabled, stakingStats, error } = this.state;
        const walletConnected = this.isConnected();

        if (loading) {
            return h('div', { className: 'staking-interface loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading staking info...')
            );
        }

        if (!stakingEnabled) {
            return h('div', { className: 'staking-interface disabled marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Staking'),
                    h('span', { className: 'status-badge disabled' }, 'Not Available')
                ),
                h('p', { className: 'disabled-message' }, 'Staking is not enabled for this project.')
            );
        }

        return h('div', { className: 'staking-interface marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Staking'),
                h('span', { className: 'status-badge enabled' }, 'Active')
            ),

            error && h('div', { className: 'error-banner' }, error),

            this.renderGlobalStats(stakingStats),

            walletConnected
                ? this.renderUserSection()
                : h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect your wallet to stake tokens')
                )
        );
    }
}

export default StakingInterface;
