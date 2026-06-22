import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';

/**
 * TierStatusPanel Component
 *
 * Shows detailed tier configuration and access information.
 * Allows password entry for tier access.
 */
export class TierStatusPanel extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
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

    async onMount() {
        await this.loadData();
        this.setupSubscriptions();
    }

    onUnmount() {
        if (this._unsubscribers) {
            this._unsubscribers.forEach(unsub => unsub());
        }
    }

    setupSubscriptions() {
        this._unsubscribers = [
            eventBus.on('account:changed', () => this.loadData()),
            eventBus.on('wallet:connected', () => this.loadData()),
            eventBus.on('wallet:disconnected', () => this.setState({ loading: false }))
        ];
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            // Get tier summary
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

            // Load details for each tier
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

            // Load user tier info if wallet connected
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

            // Hash the password (keccak256)
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            const passwordHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(passwordInput));

            // Check if user can access with this password
            const hasAccess = await this.adapter.canAccessTier(walletAddress, passwordHash);

            // Get which tier this password unlocks
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

    handlePasswordInput(value) {
        this.setState({ passwordInput: value, accessResult: null, error: null });
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

    render() {
        if (this.state.loading) {
            return `
                <div class="tier-status-panel loading">
                    <div class="loading-spinner"></div>
                    <p>Loading tier info...</p>
                </div>
            `;
        }

        const { tierSummary, tierDetails, userTierInfo, error, accessResult } = this.state;

        if (!tierSummary || tierSummary.totalTiers === 0) {
            return `
                <div class="tier-status-panel no-tiers marble-bg">
                    <div class="panel-header">
                        <h3>Access Tiers</h3>
                    </div>
                    <p class="no-tiers-message">This project has no tier restrictions. Everyone can participate.</p>
                </div>
            `;
        }

        const walletConnected = !!walletService.getAddress();

        return `
            <div class="tier-status-panel marble-bg">
                <div class="panel-header">
                    <h3>Access Tiers</h3>
                    <span class="tier-count">${tierSummary.totalTiers} Tier${tierSummary.totalTiers > 1 ? 's' : ''}</span>
                </div>

                ${error ? `<div class="error-banner">${this.escapeHtml(error)}</div>` : ''}

                ${walletConnected ? this.renderUserAccess(userTierInfo) : `
                    <div class="connect-prompt">
                        <p>Connect wallet to see your tier access</p>
                    </div>
                `}

                <div class="tier-list">
                    <h4>Tier Configuration</h4>
                    ${tierDetails.map(tier => this.renderTierCard(tier, tierSummary.currentTier, userTierInfo)).join('')}
                </div>

                ${walletConnected ? this.renderPasswordSection(accessResult) : ''}
            </div>
        `;
    }

    renderUserAccess(userInfo) {
        if (!userInfo) {
            return `
                <div class="user-access-section">
                    <div class="access-status no-access">
                        <span class="status-icon">x</span>
                        <span class="status-text">No tier access</span>
                    </div>
                </div>
            `;
        }

        const hasAccess = userInfo.hasAccess;
        const currentTier = userInfo.currentTier;
        const volume = parseFloat(userInfo.volumePurchased || '0');

        return `
            <div class="user-access-section">
                <div class="access-status ${hasAccess ? 'has-access' : 'no-access'}">
                    <span class="status-icon">${hasAccess ? '>' : 'x'}</span>
                    <span class="status-text">
                        ${hasAccess ? `Tier ${currentTier} Access` : 'No Access'}
                    </span>
                </div>
                <div class="user-volume">
                    <span class="volume-label">Your Volume:</span>
                    <span class="volume-value">${this.formatVolumeCap(volume.toString())}</span>
                </div>
            </div>
        `;
    }

    renderTierCard(tier, currentTier, userInfo) {
        const isCurrentTier = tier.index === currentTier;
        const isUnlocked = userInfo?.currentTier >= tier.index;
        const now = Math.floor(Date.now() / 1000);
        const isTimeUnlocked = tier.unlockTime === 0 || tier.unlockTime <= now;

        return `
            <div class="tier-card ${isCurrentTier ? 'current' : ''} ${isUnlocked ? 'unlocked' : 'locked'}">
                <div class="tier-header">
                    <span class="tier-number">Tier ${tier.index}</span>
                    ${isCurrentTier ? '<span class="current-badge">Current</span>' : ''}
                    ${isUnlocked ? '<span class="unlocked-badge">Unlocked</span>' : ''}
                </div>
                <div class="tier-details">
                    <div class="tier-detail">
                        <span class="detail-label">Volume Cap</span>
                        <span class="detail-value">${this.formatVolumeCap(tier.volumeCap)}</span>
                    </div>
                    <div class="tier-detail">
                        <span class="detail-label">Time Lock</span>
                        <span class="detail-value ${isTimeUnlocked ? 'unlocked' : ''}">${this.formatDate(tier.unlockTime)}</span>
                    </div>
                    <div class="tier-detail">
                        <span class="detail-label">Status</span>
                        <span class="detail-value ${tier.isActive ? 'active' : 'inactive'}">
                            ${tier.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    renderPasswordSection(accessResult) {
        const { passwordInput, checkingAccess } = this.state;

        return `
            <div class="password-section">
                <h4>Password Access</h4>
                <p class="password-hint">Some tiers may be unlocked with a password</p>
                <div class="password-input-row">
                    <input
                        type="password"
                        class="password-input"
                        placeholder="Enter password..."
                        value="${this.escapeHtml(passwordInput)}"
                        data-action="password-input"
                        ${checkingAccess ? 'disabled' : ''}
                    />
                    <button class="check-btn" data-action="check-password" ${checkingAccess || !passwordInput ? 'disabled' : ''}>
                        ${checkingAccess ? 'Checking...' : 'Check'}
                    </button>
                </div>
                ${accessResult ? this.renderAccessResult(accessResult) : ''}
            </div>
        `;
    }

    renderAccessResult(result) {
        if (result.hasAccess) {
            return `
                <div class="access-result success">
                    <span class="result-icon">></span>
                    <span class="result-text">Password valid! Unlocks Tier ${result.unlockedTier}</span>
                </div>
            `;
        }

        return `
            <div class="access-result failure">
                <span class="result-icon">x</span>
                <span class="result-text">Invalid password</span>
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
            if (action === 'check-password') {
                this.handlePasswordCheck();
            }
        });

        container.addEventListener('input', (e) => {
            if (e.target.dataset.action === 'password-input') {
                this.handlePasswordInput(e.target.value);
            }
        });

        container.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.dataset.action === 'password-input') {
                this.handlePasswordCheck();
            }
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
