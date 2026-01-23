/**
 * BondingProgressSection Component
 * Shows bonding curve visualization, progress bar, and stats during bonding phase.
 * Shows Dextools iframe after liquidity deployment.
 */

import { Component } from '../../core/Component.js';
import BondingCurve from '../BondingCurve/BondingCurve.js';

export class BondingProgressSection extends Component {
    constructor(adapter, projectId) {
        super();
        this.adapter = adapter;
        this.projectId = projectId;
        this.bondingCurve = null;
        this.state = {
            loading: true,
            hasLiquidity: false,
            liquidityPool: null,
            bondingStatus: null,
            supplyInfo: null,
            phase: 'pre-open'
        };
    }

    async onMount() {
        await this.loadData();
        this.setTimeout(() => this.setupBondingCurve(), 100);
    }

    async loadData() {
        try {
            this.setState({ loading: true });

            const [bondingStatus, supplyInfo, liquidityPool] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.getSupplyInfo().catch(() => null),
                this.adapter.liquidityPool().catch(() => null)
            ]);

            const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';
            const phase = this.calculatePhase(bondingStatus, hasLiquidity);

            this.setState({
                loading: false,
                bondingStatus,
                supplyInfo,
                liquidityPool,
                hasLiquidity,
                phase
            });
        } catch (error) {
            console.error('[BondingProgressSection] Error loading data:', error);
            this.setState({ loading: false });
        }
    }

    calculatePhase(status, hasLiquidity) {
        if (hasLiquidity) return 'deployed';
        if (!status) return 'pre-open';

        const now = Math.floor(Date.now() / 1000);
        if (status.maturityTime && now >= status.maturityTime) return 'matured';
        if (status.isActive && status.openTime && now >= status.openTime) return 'bonding';
        if (status.isActive) return 'pre-open';
        return 'pre-open';
    }

    setupBondingCurve() {
        if (this.state.hasLiquidity) return;

        const container = this.element?.querySelector('[data-ref="bonding-curve"]');
        if (container && !this.bondingCurve) {
            this.bondingCurve = new BondingCurve();
            this.bondingCurve.mount(container);
        }
    }

    getProgressPercent() {
        const { supplyInfo } = this.state;
        if (!supplyInfo) return 0;
        const current = parseFloat(supplyInfo.currentBondingSupply) || 0;
        const max = parseFloat(supplyInfo.maxBondingSupply) || 1;
        return Math.min((current / max) * 100, 100);
    }

    formatNumber(num) {
        const n = parseFloat(num) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
        return n.toFixed(2);
    }

    getPhaseBadge() {
        const badges = {
            'pre-open': { text: 'Pre-Open', class: 'phase-pre-open' },
            'bonding': { text: 'Bonding Active', class: 'phase-bonding' },
            'matured': { text: 'Matured', class: 'phase-matured' },
            'deployed': { text: 'Liquidity Deployed', class: 'phase-deployed' }
        };
        return badges[this.state.phase] || badges['pre-open'];
    }

    render() {
        if (this.state.loading) {
            return `<div class="bonding-progress-section loading"><div class="spinner"></div></div>`;
        }

        const { hasLiquidity, liquidityPool, bondingStatus, supplyInfo } = this.state;

        if (hasLiquidity) {
            return this.renderDextools(liquidityPool);
        }

        return this.renderBondingProgress(bondingStatus, supplyInfo);
    }

    renderDextools(poolAddress) {
        // Dextools embed URL format
        const dextoolsUrl = `https://www.dextools.io/widget-chart/en/ether/pe-light/${poolAddress}?theme=dark&chartType=1&chartResolution=30&drawingToolbars=false`;

        return `
            <div class="bonding-progress-section dextools-view">
                <div class="dextools-container">
                    <iframe
                        src="${dextoolsUrl}"
                        frameborder="0"
                        allow="clipboard-write"
                        allowfullscreen
                    ></iframe>
                </div>
                <div class="dextools-fallback">
                    <a href="https://www.dextools.io/app/en/ether/pair-explorer/${poolAddress}" target="_blank" rel="noopener">
                        View on Dextools
                    </a>
                </div>
            </div>
        `;
    }

    renderBondingProgress(status, supply) {
        const progress = this.getProgressPercent();
        const badge = this.getPhaseBadge();
        const currentSupply = supply?.currentBondingSupply || '0';
        const maxSupply = supply?.maxBondingSupply || '0';
        const reserve = status?.currentReserve || '0';

        return `
            <div class="bonding-progress-section">
                <div class="phase-badge ${badge.class}">${badge.text}</div>

                <div class="bonding-curve-container" data-ref="bonding-curve">
                    <!-- BondingCurve component mounts here -->
                </div>

                <div class="progress-bar-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-label">${progress.toFixed(1)}% filled</div>
                </div>

                <div class="bonding-stats">
                    <div class="stat">
                        <span class="stat-value">${parseFloat(reserve).toFixed(4)} ETH</span>
                        <span class="stat-label">Raised</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">${this.formatNumber(currentSupply)} / ${this.formatNumber(maxSupply)}</span>
                        <span class="stat-label">Tokens</span>
                    </div>
                </div>
            </div>
        `;
    }

    unmount() {
        if (this.bondingCurve) {
            this.bondingCurve.unmount();
            this.bondingCurve = null;
        }
        super.unmount();
    }
}

export default BondingProgressSection;
