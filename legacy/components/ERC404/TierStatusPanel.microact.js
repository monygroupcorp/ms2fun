/**
 * TierStatusPanel - Microact Version
 *
 * Shows detailed tier configuration and access information.
 * Allows password entry for tier access.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class TierStatusPanel extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            error: null,
            tierSummary: null,
            tierDetails: [],
            userTierInfo: null,
            passwordInput: '',
            checkingAccess: false,
            accessResult: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadData();

        const unsub1 = eventBus.on('account:changed', () => this.loadData());
        const unsub2 = eventBus.on('wallet:connected', () => this.loadData());
        const unsub3 = eventBus.on('wallet:disconnected', () => {
            this.setState({ loading: false, userTierInfo: null });
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
        });
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const tierSummary = await this.adapter.getTierConfigSummary().catch(e => {
                console.warn('[TierStatusPanel] getTierConfigSummary failed:', e);
                return null;
            });

            if (!tierSummary || tierSummary.totalTiers === 0) {
                this.setState({
                    loading: false,
                    tierSummary: null,
                    tierDetails: []
                });
                return;
            }

            const tierDetails = [];
            for (let i = 0; i < tierSummary.totalTiers; i++) {
                const [config, volumeCap, unlockTime] = await Promise.all([
                    this.adapter.tierConfig(i).catch(() => null),
                    this.adapter.getTierVolumeCap(i).catch(() => '0'),
                    this.adapter.getTierUnlockTime(i).catch(() => 0)
                ]);

                tierDetails.push({
                    index: i,
                    volumeCap,
                    unlockTime,
                    isActive: config?.isActive || false
                });
            }

            const walletAddress = walletService.getAddress();
            let userTierInfo = null;
            if (walletAddress) {
                userTierInfo = await this.adapter.getUserTierInfo(walletAddress).catch(() => null);
            }

            this.setState({
                loading: false,
                tierSummary,
                tierDetails,
                userTierInfo
            });
        } catch (error) {
            console.error('[TierStatusPanel] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load tier data'
            });
        }
    }

    async handlePasswordCheck() {
        const { passwordInput } = this.state;
        const walletAddress = walletService.getAddress();

        if (!walletAddress) {
            this.setState({ error: 'Please connect your wallet' });
            return;
        }

        if (!passwordInput) {
            this.setState({ error: 'Please enter a password' });
            return;
        }

        try {
            this.setState({ checkingAccess: true, error: null, accessResult: null });

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const passwordHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(passwordInput));

            const hasAccess = await this.adapter.canAccessTier(walletAddress, passwordHash);

            let unlockedTier = null;
            if (hasAccess) {
                unlockedTier = await this.adapter.tierByPasswordHash(passwordHash).catch(() => null);
            }

            this.setState({
                checkingAccess: false,
                accessResult: {
                    hasAccess,
                    unlockedTier,
                    passwordHash
                }
            });
        } catch (error) {
            console.error('[TierStatusPanel] Password check error:', error);
            this.setState({
                checkingAccess: false,
                error: error.message || 'Failed to check password'
            });
        }
    }

    handlePasswordInput(e) {
        this.setState({ passwordInput: e.target.value, accessResult: null, error: null });
    }

    handlePasswordKeyPress(e) {
        if (e.key === 'Enter') {
            this.handlePasswordCheck();
        }
    }

    formatDate(timestamp) {
        if (!timestamp || timestamp === 0) return 'No restriction';
        const date = new Date(timestamp * 1000);
        const now = Date.now();
        if (date.getTime() < now) {
            return 'Unlocked';
        }
        return date.toLocaleString();
    }

    formatVolumeCap(cap) {
        const num = parseFloat(cap || '0');
        if (num === 0) return 'Unlimited';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(2);
    }

    isConnected() {
        return !!walletService.getAddress();
    }

    renderUserAccess(userInfo) {
        if (!userInfo) {
            return h('div', { className: 'user-access-section' },
                h('div', { className: 'access-status no-access' },
                    h('span', { className: 'status-icon' }, 'x'),
                    h('span', { className: 'status-text' }, 'No tier access')
                )
            );
        }

        const hasAccess = userInfo.hasAccess;
        const currentTier = userInfo.currentTier;
        const volume = parseFloat(userInfo.volumePurchased || '0');

        return h('div', { className: 'user-access-section' },
            h('div', { className: `access-status ${hasAccess ? 'has-access' : 'no-access'}` },
                h('span', { className: 'status-icon' }, hasAccess ? '>' : 'x'),
                h('span', { className: 'status-text' },
                    hasAccess ? `Tier ${currentTier} Access` : 'No Access'
                )
            ),
            h('div', { className: 'user-volume' },
                h('span', { className: 'volume-label' }, 'Your Volume:'),
                h('span', { className: 'volume-value' }, this.formatVolumeCap(volume.toString()))
            )
        );
    }

    renderTierCard(tier, currentTier, userInfo) {
        const isCurrentTier = tier.index === currentTier;
        const isUnlocked = userInfo?.currentTier >= tier.index;
        const now = Math.floor(Date.now() / 1000);
        const isTimeUnlocked = tier.unlockTime === 0 || tier.unlockTime <= now;

        return h('div', {
            className: `tier-card ${isCurrentTier ? 'current' : ''} ${isUnlocked ? 'unlocked' : 'locked'}`,
            key: `tier-${tier.index}`
        },
            h('div', { className: 'tier-header' },
                h('span', { className: 'tier-number' }, `Tier ${tier.index}`),
                isCurrentTier && h('span', { className: 'current-badge' }, 'Current'),
                isUnlocked && h('span', { className: 'unlocked-badge' }, 'Unlocked')
            ),
            h('div', { className: 'tier-details' },
                h('div', { className: 'tier-detail' },
                    h('span', { className: 'detail-label' }, 'Volume Cap'),
                    h('span', { className: 'detail-value' }, this.formatVolumeCap(tier.volumeCap))
                ),
                h('div', { className: 'tier-detail' },
                    h('span', { className: 'detail-label' }, 'Time Lock'),
                    h('span', { className: `detail-value ${isTimeUnlocked ? 'unlocked' : ''}` },
                        this.formatDate(tier.unlockTime)
                    )
                ),
                h('div', { className: 'tier-detail' },
                    h('span', { className: 'detail-label' }, 'Status'),
                    h('span', { className: `detail-value ${tier.isActive ? 'active' : 'inactive'}` },
                        tier.isActive ? 'Active' : 'Inactive'
                    )
                )
            )
        );
    }

    renderAccessResult(result) {
        if (result.hasAccess) {
            return h('div', { className: 'access-result success' },
                h('span', { className: 'result-icon' }, '>'),
                h('span', { className: 'result-text' }, `Password valid! Unlocks Tier ${result.unlockedTier}`)
            );
        }

        return h('div', { className: 'access-result failure' },
            h('span', { className: 'result-icon' }, 'x'),
            h('span', { className: 'result-text' }, 'Invalid password')
        );
    }

    renderPasswordSection() {
        const { passwordInput, checkingAccess, accessResult } = this.state;

        return h('div', { className: 'password-section' },
            h('h4', null, 'Password Access'),
            h('p', { className: 'password-hint' }, 'Some tiers may be unlocked with a password'),
            h('div', { className: 'password-input-row' },
                h('input', {
                    type: 'password',
                    className: 'password-input',
                    placeholder: 'Enter password...',
                    value: passwordInput,
                    onInput: this.bind(this.handlePasswordInput),
                    onKeyPress: this.bind(this.handlePasswordKeyPress),
                    disabled: checkingAccess
                }),
                h('button', {
                    className: 'check-btn',
                    onClick: this.bind(this.handlePasswordCheck),
                    disabled: checkingAccess || !passwordInput
                }, checkingAccess ? 'Checking...' : 'Check')
            ),
            accessResult && this.renderAccessResult(accessResult)
        );
    }

    render() {
        const { loading, error, tierSummary, tierDetails, userTierInfo } = this.state;

        if (loading) {
            return h('div', { className: 'tier-status-panel loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading tier info...')
            );
        }

        if (!tierSummary || tierSummary.totalTiers === 0) {
            return h('div', { className: 'tier-status-panel no-tiers marble-bg' },
                h('div', { className: 'panel-header' },
                    h('h3', null, 'Access Tiers')
                ),
                h('p', { className: 'no-tiers-message' }, 'This project has no tier restrictions. Everyone can participate.')
            );
        }

        const walletConnected = this.isConnected();

        return h('div', { className: 'tier-status-panel marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Access Tiers'),
                h('span', { className: 'tier-count' },
                    `${tierSummary.totalTiers} Tier${tierSummary.totalTiers > 1 ? 's' : ''}`
                )
            ),

            error && h('div', { className: 'error-banner' }, error),

            walletConnected
                ? this.renderUserAccess(userTierInfo)
                : h('div', { className: 'connect-prompt' },
                    h('p', null, 'Connect wallet to see your tier access')
                ),

            h('div', { className: 'tier-list' },
                h('h4', null, 'Tier Configuration'),
                ...tierDetails.map(tier =>
                    this.renderTierCard(tier, tierSummary.currentTier, userTierInfo)
                )
            ),

            walletConnected && this.renderPasswordSection()
        );
    }
}

export default TierStatusPanel;
