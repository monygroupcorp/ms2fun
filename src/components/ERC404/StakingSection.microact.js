/**
 * StakingSection - Microact Version
 *
 * Simplified staking UI for the Token tab.
 * Allows users to stake/unstake tokens and claim rewards.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class StakingSection extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            stakingEnabled: false,
            userStaked: '0',
            claimableRewards: '0',
            totalStaked: '0',
            txPending: false,
            error: null,
            success: null,
            stakeAmount: '',
            unstakeAmount: ''
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub2 = eventBus.on('wallet:changed', () => this.loadData());
        const unsub3 = eventBus.on('wallet:disconnected', () => {
            this.setState({ userStaked: '0', claimableRewards: '0' });
        });
        const unsub4 = eventBus.on('transaction:confirmed', () => this.loadData());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    isConnected() {
        return walletService.isConnected();
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const stakingEnabled = await this.adapter.stakingEnabled().catch(() => false);

            if (!stakingEnabled) {
                this.setState({ loading: false, stakingEnabled: false });
                return;
            }

            const stakingStats = await this.adapter.getStakingStats().catch(() => null);
            const totalStaked = stakingStats?.totalStaked || '0';

            let userStaked = '0';
            let claimableRewards = '0';

            if (this.isConnected()) {
                const walletAddress = walletService.getAddress();

                const userInfo = await (this.adapter.getUserStakingInfo
                    ? this.adapter.getUserStakingInfo(walletAddress).catch(() => null)
                    : this.adapter.getStakingInfo(walletAddress).catch(() => null));

                if (userInfo) {
                    userStaked = userInfo.stakedAmount || '0';
                    claimableRewards = userInfo.pendingRewards || '0';
                }

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
            this.setState({ loading: false, error: error.message || 'Failed to load staking data' });
        }
    }

    async handleStake() {
        const { stakeAmount, txPending } = this.state;

        if (txPending) return;

        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(stakeAmount, 18).toString();

            await this.adapter.stake(amountWei);

            this.setState({ txPending: false, success: 'Successfully staked tokens', stakeAmount: '' });
            await this.loadData();

            setTimeout(() => this.setState({ success: null }), 3000);
        } catch (error) {
            console.error('[StakingSection] Stake error:', error);
            this.setState({ txPending: false, error: error.message || 'Staking failed' });
        }
    }

    async handleUnstake() {
        const { unstakeAmount, txPending } = this.state;

        if (txPending) return;

        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) {
            this.setState({ error: 'Please enter a valid amount' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const amountWei = ethers.utils.parseUnits(unstakeAmount, 18).toString();

            await this.adapter.unstake(amountWei);

            this.setState({ txPending: false, success: 'Successfully unstaked tokens', unstakeAmount: '' });
            await this.loadData();

            setTimeout(() => this.setState({ success: null }), 3000);
        } catch (error) {
            console.error('[StakingSection] Unstake error:', error);
            this.setState({ txPending: false, error: error.message || 'Unstaking failed' });
        }
    }

    async handleClaim() {
        const { claimableRewards, txPending } = this.state;

        if (txPending) return;

        if (!this.isConnected()) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        const rewards = parseFloat(claimableRewards || '0');
        if (rewards <= 0) {
            this.setState({ error: 'No rewards to claim' });
            return;
        }

        try {
            this.setState({ txPending: true, error: null, success: null });

            await this.adapter.claimStakerRewards();

            this.setState({ txPending: false, success: 'Successfully claimed rewards' });
            await this.loadData();

            setTimeout(() => this.setState({ success: null }), 3000);
        } catch (error) {
            console.error('[StakingSection] Claim error:', error);
            this.setState({ txPending: false, error: error.message || 'Claiming rewards failed' });
        }
    }

    handleStakeInputChange(e) {
        this.setState({ stakeAmount: e.target.value, error: null });
    }

    handleUnstakeInputChange(e) {
        this.setState({ unstakeAmount: e.target.value, error: null });
    }

    async handleMaxStake() {
        if (!this.isConnected()) return;

        try {
            const walletAddress = walletService.getAddress();
            const balance = await this.adapter.getTokenBalance(walletAddress).catch(() => '0');
            this.setState({ stakeAmount: balance });
        } catch (error) {
            console.warn('[StakingSection] Failed to get max stake amount:', error);
        }
    }

    handleMaxUnstake() {
        this.setState({ unstakeAmount: this.state.userStaked || '0' });
    }

    formatNumber(num) {
        const n = parseFloat(num);
        if (isNaN(n)) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(4);
    }

    render() {
        const { loading, stakingEnabled, totalStaked, userStaked, claimableRewards, txPending, error, success, stakeAmount, unstakeAmount } = this.state;
        const connected = this.isConnected();

        if (loading) {
            return h('div', { className: 'staking-section loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading staking info...')
            );
        }

        if (!stakingEnabled) {
            return h('div', { className: 'staking-section disabled' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Staking'),
                    h('span', { className: 'status-badge disabled' }, 'Not Available')
                ),
                h('p', { className: 'disabled-message' }, 'Staking not yet enabled')
            );
        }

        const stakedAmount = parseFloat(userStaked || '0');
        const rewards = parseFloat(claimableRewards || '0');

        return h('div', { className: 'staking-section' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Staking'),
                h('span', { className: 'status-badge enabled' }, 'Active')
            ),

            error && h('div', { className: 'error-banner' }, error),
            success && h('div', { className: 'success-banner' }, success),

            h('div', { className: 'staking-global-stat' },
                h('span', { className: 'stat-label' }, 'Total Staked'),
                h('span', { className: 'stat-value' }, this.formatNumber(totalStaked))
            ),

            connected ? h('div', { className: 'staking-user-section' },
                h('div', { className: 'staking-user-stats' },
                    h('div', { className: 'stat-item' },
                        h('span', { className: 'stat-label' }, 'Your Staked'),
                        h('span', { className: 'stat-value' }, this.formatNumber(stakedAmount))
                    ),
                    h('div', { className: 'stat-item highlight' },
                        h('span', { className: 'stat-label' }, 'Claimable Rewards'),
                        h('span', { className: 'stat-value rewards' }, this.formatNumber(rewards))
                    )
                ),

                h('div', { className: 'staking-actions' },
                    h('div', { className: 'action-group' },
                        h('label', null, 'Stake'),
                        h('div', { className: 'input-row' },
                            h('input', {
                                type: 'number',
                                className: 'stake-input',
                                placeholder: '0.0',
                                value: stakeAmount,
                                onInput: this.bind(this.handleStakeInputChange),
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
                            disabled: txPending
                        }, txPending ? 'Processing...' : 'Stake')
                    ),

                    h('div', { className: 'action-group' },
                        h('label', null, 'Unstake'),
                        h('div', { className: 'input-row' },
                            h('input', {
                                type: 'number',
                                className: 'unstake-input',
                                placeholder: '0.0',
                                value: unstakeAmount,
                                onInput: this.bind(this.handleUnstakeInputChange),
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
                        onClick: this.bind(this.handleClaim),
                        disabled: txPending || rewards <= 0
                    }, txPending ? 'Processing...' : `Claim Rewards (${this.formatNumber(rewards)})`)
                )
            ) : h('div', { className: 'connect-prompt' },
                h('p', null, 'Connect wallet to stake')
            )
        );
    }
}

export default StakingSection;
