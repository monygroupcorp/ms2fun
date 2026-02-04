import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';

/**
 * BondingStatusPanel Component
 *
 * Displays bonding curve status, progress, and liquidity information.
 * Shows current phase, supply progress, and tier access.
 */
export class BondingStatusPanel extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            loading: true,
            error: null,
            bondingStatus: null,
            supplyInfo: null,
            liquidityInfo: null,
            tierSummary: null,
            userTierInfo: null
        };
    }

    async onMount() {
        await this.loadData();
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();

            // Load all bonding-related data in parallel
            const [bondingStatus, supplyInfo, liquidityInfo, tierSummary] = await Promise.all([
                this.adapter.getBondingStatus().catch(e => {
                    console.warn('[BondingStatusPanel] getBondingStatus failed:', e);
                    return null;
                }),
                this.adapter.getSupplyInfo().catch(e => {
                    console.warn('[BondingStatusPanel] getSupplyInfo failed:', e);
                    return null;
                }),
                this.adapter.getLiquidityInfo().catch(e => {
                    console.warn('[BondingStatusPanel] getLiquidityInfo failed:', e);
                    return null;
                }),
                this.adapter.getTierConfigSummary().catch(e => {
                    console.warn('[BondingStatusPanel] getTierConfigSummary failed:', e);
                    return null;
                })
            ]);

            // Load user tier info if wallet connected
            let userTierInfo = null;
            if (walletAddress) {
                userTierInfo = await this.adapter.getUserTierInfo(walletAddress).catch(e => {
                    console.warn('[BondingStatusPanel] getUserTierInfo failed:', e);
                    return null;
                });
            }

            this.setState({
                loading: false,
                bondingStatus,
                supplyInfo,
                liquidityInfo,
                tierSummary,
                userTierInfo
            });
        } catch (error) {
            console.error('[BondingStatusPanel] Error loading data:', error);
            this.setState({
                loading: false,
                error: error.message || 'Failed to load bonding status'
            });
        }
    }

    /**
     * Get human-readable phase name
     */
    getPhaseName(phase) {
        const phases = {
            0: 'Not Started',
            1: 'Early Bonding',
            2: 'Active Bonding',
            3: 'Matured',
            4: 'Liquidity Deployed'
        };
        return phases[phase] || `Phase ${phase}`;
    }

    /**
     * Get phase badge class
     */
    getPhaseClass(phase, hasLiquidity) {
        if (hasLiquidity) return 'phase-deployed';
        if (phase >= 3) return 'phase-matured';
        if (phase >= 1) return 'phase-active';
        return 'phase-pending';
    }

    /**
     * Calculate supply progress percentage
     */
    getSupplyProgress() {
        const { supplyInfo } = this.state;
        if (!supplyInfo) return 0;

        const total = parseFloat(supplyInfo.totalSupply) || 0;
        const max = parseFloat(supplyInfo.maxSupply) || 1;
        return Math.min((total / max) * 100, 100);
    }

    /**
     * Format timestamp to readable date
     */
    formatDate(timestamp) {
        if (!timestamp || timestamp === 0) return 'Not set';
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    }

    /**
     * Format time remaining
     */
    formatTimeRemaining(timestamp) {
        if (!timestamp || timestamp === 0) return '';
        const now = Math.floor(Date.now() / 1000);
        const remaining = timestamp - now;

        if (remaining <= 0) return 'Now';

        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="bonding-status-panel loading">
                    <div class="loading-spinner"></div>
                    <p>Loading bonding status...</p>
                </div>
            `;
        }

        if (this.state.error) {
            return `
                <div class="bonding-status-panel error">
                    <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                </div>
            `;
        }

        const { bondingStatus, supplyInfo, liquidityInfo, tierSummary, userTierInfo } = this.state;
        const progress = this.getSupplyProgress();
        const phase = bondingStatus?.currentPhase || 0;
        const hasLiquidity = bondingStatus?.hasLiquidity || false;
        const phaseClass = this.getPhaseClass(phase, hasLiquidity);

        return `
            <div class="bonding-status-panel marble-bg">
                <div class="panel-header">
                    <h3>Bonding Status</h3>
                    <span class="phase-badge ${phaseClass}">
                        ${hasLiquidity ? 'Liquidity Deployed' : this.getPhaseName(phase)}
                    </span>
                </div>

                <div class="status-grid">
                    ${this.renderSupplyProgress(supplyInfo, progress)}
                    ${this.renderBondingTimes(bondingStatus)}
                    ${this.renderLiquidityInfo(liquidityInfo, hasLiquidity)}
                    ${this.renderTierInfo(tierSummary, userTierInfo)}
                </div>
            </div>
        `;
    }

    renderSupplyProgress(supplyInfo, progress) {
        if (!supplyInfo) return '';

        const total = parseFloat(supplyInfo.totalSupply) || 0;
        const max = parseFloat(supplyInfo.maxSupply) || 0;
        const bonding = parseFloat(supplyInfo.bondingSupply) || 0;

        return `
            <div class="status-section supply-section">
                <h4>Supply Progress</h4>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-label">${progress.toFixed(1)}% of max supply</div>
                </div>
                <div class="supply-stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Supply</span>
                        <span class="stat-value">${this.formatNumber(total)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Max Supply</span>
                        <span class="stat-value">${this.formatNumber(max)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Bonding Supply</span>
                        <span class="stat-value">${this.formatNumber(bonding)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderBondingTimes(bondingStatus) {
        if (!bondingStatus) return '';

        const now = Math.floor(Date.now() / 1000);
        const isActive = bondingStatus.isActive;
        const openTime = bondingStatus.openTime || 0;
        const maturityTime = bondingStatus.maturityTime || 0;

        let timeStatus = '';
        if (!isActive) {
            timeStatus = 'Bonding Inactive';
        } else if (openTime > now) {
            timeStatus = `Opens in ${this.formatTimeRemaining(openTime)}`;
        } else if (maturityTime > now) {
            timeStatus = `Matures in ${this.formatTimeRemaining(maturityTime)}`;
        } else {
            timeStatus = 'Matured';
        }

        return `
            <div class="status-section times-section">
                <h4>Timeline</h4>
                <div class="time-status ${isActive ? 'active' : 'inactive'}">
                    ${timeStatus}
                </div>
                <div class="time-details">
                    <div class="time-item">
                        <span class="time-label">Open Time</span>
                        <span class="time-value">${this.formatDate(openTime)}</span>
                    </div>
                    <div class="time-item">
                        <span class="time-label">Maturity Time</span>
                        <span class="time-value">${this.formatDate(maturityTime)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderLiquidityInfo(liquidityInfo, hasLiquidity) {
        if (!liquidityInfo) {
            return `
                <div class="status-section liquidity-section">
                    <h4>Liquidity</h4>
                    <div class="liquidity-status ${hasLiquidity ? 'deployed' : 'pending'}">
                        ${hasLiquidity ? 'Deployed' : 'Not Yet Deployed'}
                    </div>
                </div>
            `;
        }

        const tokenReserve = parseFloat(liquidityInfo.tokenReserve) || 0;
        const ethReserve = parseFloat(liquidityInfo.ethReserve) || 0;
        const lpBalance = parseFloat(liquidityInfo.lpTokenBalance) || 0;
        const poolAddress = liquidityInfo.liquidityPool;

        return `
            <div class="status-section liquidity-section">
                <h4>Liquidity</h4>
                <div class="liquidity-status ${hasLiquidity ? 'deployed' : 'pending'}">
                    ${hasLiquidity ? 'Deployed' : 'Not Yet Deployed'}
                </div>
                ${hasLiquidity ? `
                    <div class="liquidity-stats">
                        <div class="stat-item">
                            <span class="stat-label">Token Reserve</span>
                            <span class="stat-value">${this.formatNumber(tokenReserve)}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">ETH Reserve</span>
                            <span class="stat-value">${ethReserve.toFixed(4)} ETH</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">LP Tokens</span>
                            <span class="stat-value">${this.formatNumber(lpBalance)}</span>
                        </div>
                        ${poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000' ? `
                            <div class="stat-item pool-address">
                                <span class="stat-label">Pool</span>
                                <span class="stat-value address">${this.truncateAddress(poolAddress)}</span>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderTierInfo(tierSummary, userTierInfo) {
        if (!tierSummary || tierSummary.totalTiers === 0) {
            return `
                <div class="status-section tier-section">
                    <h4>Access Tiers</h4>
                    <div class="no-tiers">No tier restrictions</div>
                </div>
            `;
        }

        const currentTier = tierSummary.currentTier || 0;
        const totalTiers = tierSummary.totalTiers || 0;
        const userTier = userTierInfo?.currentTier || 0;
        const userHasAccess = userTierInfo?.hasAccess || false;

        return `
            <div class="status-section tier-section">
                <h4>Access Tiers</h4>
                <div class="tier-overview">
                    <div class="tier-current">
                        <span class="tier-label">Current Tier</span>
                        <span class="tier-value">${currentTier} / ${totalTiers}</span>
                    </div>
                    ${userTierInfo ? `
                        <div class="tier-user ${userHasAccess ? 'has-access' : 'no-access'}">
                            <span class="tier-label">Your Access</span>
                            <span class="tier-value">
                                ${userHasAccess ? `Tier ${userTier}` : 'No Access'}
                            </span>
                        </div>
                    ` : ''}
                </div>
                ${userTierInfo && userTierInfo.volumePurchased ? `
                    <div class="tier-volume">
                        <span class="volume-label">Your Volume</span>
                        <span class="volume-value">${this.formatNumber(parseFloat(userTierInfo.volumePurchased))}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toFixed(2);
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
