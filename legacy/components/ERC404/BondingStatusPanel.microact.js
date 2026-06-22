/**
 * BondingStatusPanel - Microact Version
 *
 * Displays bonding curve status, progress, and liquidity information.
 * Shows current phase, supply progress, and tier access.
 */

import { Component, h } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class BondingStatusPanel extends Component {
    constructor(props = {}) {
        super(props);
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

    get adapter() {
        return this.props.adapter;
    }

    get projectId() {
        return this.props.projectId;
    }

    async didMount() {
        await this.loadData();
    }

    async loadData() {
        try {
            this.setState({ loading: true, error: null });

            const walletAddress = walletService.getAddress();

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

    getPhaseClass(phase, hasLiquidity) {
        if (hasLiquidity) return 'phase-deployed';
        if (phase >= 3) return 'phase-matured';
        if (phase >= 1) return 'phase-active';
        return 'phase-pending';
    }

    getSupplyProgress() {
        const { supplyInfo } = this.state;
        if (!supplyInfo) return 0;

        const total = parseFloat(supplyInfo.totalSupply) || 0;
        const max = parseFloat(supplyInfo.maxSupply) || 1;
        return Math.min((total / max) * 100, 100);
    }

    formatDate(timestamp) {
        if (!timestamp || timestamp === 0) return 'Not set';
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    }

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

    renderSupplyProgress(supplyInfo, progress) {
        if (!supplyInfo) return null;

        const total = parseFloat(supplyInfo.totalSupply) || 0;
        const max = parseFloat(supplyInfo.maxSupply) || 0;
        const bonding = parseFloat(supplyInfo.bondingSupply) || 0;

        return h('div', { className: 'status-section supply-section' },
            h('h4', null, 'Supply Progress'),
            h('div', { className: 'progress-container' },
                h('div', { className: 'progress-bar' },
                    h('div', { className: 'progress-fill', style: `width: ${progress}%` })
                ),
                h('div', { className: 'progress-label' }, `${progress.toFixed(1)}% of max supply`)
            ),
            h('div', { className: 'supply-stats' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Total Supply'),
                    h('span', { className: 'stat-value' }, this.formatNumber(total))
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Max Supply'),
                    h('span', { className: 'stat-value' }, this.formatNumber(max))
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Bonding Supply'),
                    h('span', { className: 'stat-value' }, this.formatNumber(bonding))
                )
            )
        );
    }

    renderBondingTimes(bondingStatus) {
        if (!bondingStatus) return null;

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

        return h('div', { className: 'status-section times-section' },
            h('h4', null, 'Timeline'),
            h('div', { className: `time-status ${isActive ? 'active' : 'inactive'}` }, timeStatus),
            h('div', { className: 'time-details' },
                h('div', { className: 'time-item' },
                    h('span', { className: 'time-label' }, 'Open Time'),
                    h('span', { className: 'time-value' }, this.formatDate(openTime))
                ),
                h('div', { className: 'time-item' },
                    h('span', { className: 'time-label' }, 'Maturity Time'),
                    h('span', { className: 'time-value' }, this.formatDate(maturityTime))
                )
            )
        );
    }

    renderLiquidityInfo(liquidityInfo, hasLiquidity) {
        if (!liquidityInfo) {
            return h('div', { className: 'status-section liquidity-section' },
                h('h4', null, 'Liquidity'),
                h('div', { className: `liquidity-status ${hasLiquidity ? 'deployed' : 'pending'}` },
                    hasLiquidity ? 'Deployed' : 'Not Yet Deployed'
                )
            );
        }

        const tokenReserve = parseFloat(liquidityInfo.tokenReserve) || 0;
        const ethReserve = parseFloat(liquidityInfo.ethReserve) || 0;
        const lpBalance = parseFloat(liquidityInfo.lpTokenBalance) || 0;
        const poolAddress = liquidityInfo.liquidityPool;
        const hasPool = poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000';

        return h('div', { className: 'status-section liquidity-section' },
            h('h4', null, 'Liquidity'),
            h('div', { className: `liquidity-status ${hasLiquidity ? 'deployed' : 'pending'}` },
                hasLiquidity ? 'Deployed' : 'Not Yet Deployed'
            ),
            hasLiquidity && h('div', { className: 'liquidity-stats' },
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'Token Reserve'),
                    h('span', { className: 'stat-value' }, this.formatNumber(tokenReserve))
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'ETH Reserve'),
                    h('span', { className: 'stat-value' }, `${ethReserve.toFixed(4)} ETH`)
                ),
                h('div', { className: 'stat-item' },
                    h('span', { className: 'stat-label' }, 'LP Tokens'),
                    h('span', { className: 'stat-value' }, this.formatNumber(lpBalance))
                ),
                hasPool && h('div', { className: 'stat-item pool-address' },
                    h('span', { className: 'stat-label' }, 'Pool'),
                    h('span', { className: 'stat-value address' }, this.truncateAddress(poolAddress))
                )
            )
        );
    }

    renderTierInfo(tierSummary, userTierInfo) {
        if (!tierSummary || tierSummary.totalTiers === 0) {
            return h('div', { className: 'status-section tier-section' },
                h('h4', null, 'Access Tiers'),
                h('div', { className: 'no-tiers' }, 'No tier restrictions')
            );
        }

        const currentTier = tierSummary.currentTier || 0;
        const totalTiers = tierSummary.totalTiers || 0;
        const userTier = userTierInfo?.currentTier || 0;
        const userHasAccess = userTierInfo?.hasAccess || false;

        return h('div', { className: 'status-section tier-section' },
            h('h4', null, 'Access Tiers'),
            h('div', { className: 'tier-overview' },
                h('div', { className: 'tier-current' },
                    h('span', { className: 'tier-label' }, 'Current Tier'),
                    h('span', { className: 'tier-value' }, `${currentTier} / ${totalTiers}`)
                ),
                userTierInfo && h('div', { className: `tier-user ${userHasAccess ? 'has-access' : 'no-access'}` },
                    h('span', { className: 'tier-label' }, 'Your Access'),
                    h('span', { className: 'tier-value' },
                        userHasAccess ? `Tier ${userTier}` : 'No Access'
                    )
                )
            ),
            userTierInfo && userTierInfo.volumePurchased && h('div', { className: 'tier-volume' },
                h('span', { className: 'volume-label' }, 'Your Volume'),
                h('span', { className: 'volume-value' }, this.formatNumber(parseFloat(userTierInfo.volumePurchased)))
            )
        );
    }

    render() {
        const { loading, error, bondingStatus, supplyInfo, liquidityInfo, tierSummary, userTierInfo } = this.state;

        if (loading) {
            return h('div', { className: 'bonding-status-panel loading' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading bonding status...')
            );
        }

        if (error) {
            return h('div', { className: 'bonding-status-panel error' },
                h('p', { className: 'error-message' }, error)
            );
        }

        const progress = this.getSupplyProgress();
        const phase = bondingStatus?.currentPhase || 0;
        const hasLiquidity = bondingStatus?.hasLiquidity || false;
        const phaseClass = this.getPhaseClass(phase, hasLiquidity);

        return h('div', { className: 'bonding-status-panel marble-bg' },
            h('div', { className: 'panel-header' },
                h('h3', null, 'Bonding Status'),
                h('span', { className: `phase-badge ${phaseClass}` },
                    hasLiquidity ? 'Liquidity Deployed' : this.getPhaseName(phase)
                )
            ),

            h('div', { className: 'status-grid' },
                this.renderSupplyProgress(supplyInfo, progress),
                this.renderBondingTimes(bondingStatus),
                this.renderLiquidityInfo(liquidityInfo, hasLiquidity),
                this.renderTierInfo(tierSummary, userTierInfo)
            )
        );
    }
}

export default BondingStatusPanel;
