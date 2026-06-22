/**
 * BondingProgressSection Component
 * Clean bonding curve visualization with stats during bonding phase.
 * Shows Dextools iframe after liquidity deployment.
 */

import { Component } from '../../core/Component.js';

export class BondingProgressSection extends Component {
    constructor(adapter, projectId) {
        super();
        this.adapter = adapter;
        this.projectId = projectId;
        this.canvas = null;
        this.resizeHandler = null;
        this.state = {
            loading: true,
            hasLiquidity: false,
            liquidityPool: null,
            phase: 'pre-open',
            // Bonding data
            currentPrice: 0,
            currentSupply: 0,
            maxSupply: 0,
            ethRaised: 0,
            progress: 0,
            // Timing
            openTime: null,
            maturityTime: null,
            timeUntilOpen: null,
            timeUntilMaturity: null
        };
    }

    async onMount() {
        await this.loadData();
        this.setTimeout(() => this.setupCanvas(), 100);

        // Refresh data periodically
        this._refreshInterval = setInterval(() => this.loadData(), 30000);
    }

    async loadData() {
        try {
            const [bondingStatus, supplyInfo, liquidityPool] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.getSupplyInfo().catch(() => null),
                this.adapter.liquidityPool().catch(() => null)
            ]);

            const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';

            // Calculate supply values
            const currentSupply = parseFloat(supplyInfo?.currentBondingSupply || 0);
            const maxSupply = parseFloat(supplyInfo?.maxBondingSupply || 1);
            const progress = maxSupply > 0 ? (currentSupply / maxSupply) * 100 : 0;

            // Get current price by calculating cost for 1 token
            let currentPrice = 0;
            try {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                const oneToken = ethers.utils.parseUnits('1', 18).toString();
                const costWei = await this.adapter.calculateCost(oneToken);
                currentPrice = parseFloat(ethers.utils.formatEther(costWei)) || 0;
            } catch (e) {
                console.warn('[BondingProgressSection] Error getting price:', e);
            }

            // ETH raised comes from bondingStatus.currentReserve
            const ethRaised = parseFloat(bondingStatus?.currentReserve || 0);

            // Calculate timing
            const now = Math.floor(Date.now() / 1000);
            const openTime = bondingStatus?.openTime ? parseInt(bondingStatus.openTime) : null;
            const maturityTime = bondingStatus?.maturityTime ? parseInt(bondingStatus.maturityTime) : null;

            let timeUntilOpen = null;
            let timeUntilMaturity = null;

            if (openTime && now < openTime) {
                timeUntilOpen = openTime - now;
            }
            if (maturityTime && now < maturityTime) {
                timeUntilMaturity = maturityTime - now;
            }

            // Determine phase
            const phase = this.calculatePhase(bondingStatus, hasLiquidity, now, openTime, maturityTime);

            this.setState({
                loading: false,
                hasLiquidity,
                liquidityPool,
                phase,
                currentPrice,
                currentSupply,
                maxSupply,
                ethRaised,
                progress: Math.min(progress, 100),
                openTime,
                maturityTime,
                timeUntilOpen,
                timeUntilMaturity
            });

            // Redraw curve with new data
            if (!hasLiquidity && this.canvas) {
                this.drawCurve();
            }
        } catch (error) {
            console.error('[BondingProgressSection] Error loading data:', error);
            this.setState({ loading: false });
        }
    }

    calculatePhase(status, hasLiquidity, now, openTime, maturityTime) {
        if (hasLiquidity) return 'deployed';
        if (!status) return 'pre-open';
        if (maturityTime && now >= maturityTime) return 'matured';
        if (status.isActive && openTime && now >= openTime) return 'bonding';
        return 'pre-open';
    }

    setupCanvas() {
        if (this.state.hasLiquidity) return;

        this.canvas = this.element?.querySelector('.bonding-canvas');
        if (this.canvas) {
            this.drawCurve();

            // Handle resize
            this.resizeHandler = () => {
                requestAnimationFrame(() => this.drawCurve());
            };
            window.addEventListener('resize', this.resizeHandler);
        }
    }

    drawCurve() {
        if (!this.canvas) return;

        const ctx = this.canvas.getContext('2d');
        const rect = this.canvas.getBoundingClientRect();

        // Set canvas size for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        this.drawGrid(ctx, padding, chartWidth, chartHeight);

        // Draw curve
        this.drawBondingCurve(ctx, padding, chartWidth, chartHeight);

        // Draw current position
        this.drawCurrentPosition(ctx, padding, chartWidth, chartHeight);

        // Draw axes labels
        this.drawAxesLabels(ctx, padding, chartWidth, chartHeight);
    }

    drawGrid(ctx, padding, chartWidth, chartHeight) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;

        // Horizontal lines
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight * i) / 4;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        // Vertical lines
        for (let i = 0; i <= 4; i++) {
            const x = padding.left + (chartWidth * i) / 4;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();
        }
    }

    drawBondingCurve(ctx, padding, chartWidth, chartHeight) {
        // Bonding curve: price = k * supply^n (exponential)
        const curve = (x) => Math.pow(x, 2.5);

        // Draw filled area under curve
        const gradient = ctx.createLinearGradient(
            padding.left, padding.top + chartHeight,
            padding.left, padding.top
        );
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.0)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.2)');

        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartHeight);

        const steps = 100;
        for (let i = 0; i <= steps; i++) {
            const x = i / steps;
            const y = curve(x);
            const canvasX = padding.left + x * chartWidth;
            const canvasY = padding.top + chartHeight - y * chartHeight;
            ctx.lineTo(canvasX, canvasY);
        }

        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw curve line
        ctx.beginPath();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;

        for (let i = 0; i <= steps; i++) {
            const x = i / steps;
            const y = curve(x);
            const canvasX = padding.left + x * chartWidth;
            const canvasY = padding.top + chartHeight - y * chartHeight;

            if (i === 0) {
                ctx.moveTo(canvasX, canvasY);
            } else {
                ctx.lineTo(canvasX, canvasY);
            }
        }
        ctx.stroke();
    }

    drawCurrentPosition(ctx, padding, chartWidth, chartHeight) {
        const { progress } = this.state;
        const x = progress / 100;
        const y = Math.pow(x, 2.5);

        const canvasX = padding.left + x * chartWidth;
        const canvasY = padding.top + chartHeight - y * chartHeight;

        // Draw vertical line to position
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(52, 199, 89, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(canvasX, padding.top + chartHeight);
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw horizontal line to position
        ctx.beginPath();
        ctx.moveTo(padding.left, canvasY);
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();

        // Draw position dot with glow
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 199, 89, 0.3)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#34c759';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
    }

    drawAxesLabels(ctx, padding, chartWidth, chartHeight) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px system-ui, sans-serif';

        // X-axis label
        ctx.textAlign = 'center';
        ctx.fillText('Supply', padding.left + chartWidth / 2, padding.top + chartHeight + 20);

        // Y-axis label
        ctx.save();
        ctx.translate(12, padding.top + chartHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Price', 0, 0);
        ctx.restore();

        // Progress marker
        const { progress } = this.state;
        if (progress > 0) {
            const x = padding.left + (progress / 100) * chartWidth;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#34c759';
            ctx.fillText(`${progress.toFixed(1)}%`, x, padding.top + chartHeight + 12);
        }
    }

    formatNumber(num) {
        const n = parseFloat(num) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString();
    }

    formatPrice(price) {
        const p = parseFloat(price) || 0;
        if (p === 0) return '0';
        if (p >= 1) return p.toFixed(4);
        if (p >= 0.0001) return p.toFixed(6);
        if (p >= 0.00000001) return p.toFixed(10);
        // For extremely small values, use scientific notation
        return p.toExponential(4);
    }

    formatEth(amount) {
        const a = parseFloat(amount) || 0;
        if (a === 0) return '0';
        if (a >= 1000) return (a / 1000).toFixed(2) + 'K';
        if (a >= 1) return a.toFixed(2);
        if (a >= 0.01) return a.toFixed(4);
        return a.toFixed(6);
    }

    formatTime(seconds) {
        if (!seconds || seconds <= 0) return null;

        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    getPhaseConfig() {
        const configs = {
            'pre-open': {
                label: 'Pre-Open',
                color: '#8e8e93',
                bg: 'rgba(142, 142, 147, 0.15)'
            },
            'bonding': {
                label: 'Bonding Active',
                color: '#34c759',
                bg: 'rgba(52, 199, 89, 0.15)'
            },
            'matured': {
                label: 'Matured',
                color: '#ff9500',
                bg: 'rgba(255, 149, 0, 0.15)'
            },
            'deployed': {
                label: 'Liquidity Deployed',
                color: '#5856d6',
                bg: 'rgba(88, 86, 214, 0.15)'
            }
        };
        return configs[this.state.phase] || configs['pre-open'];
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="bonding-section loading">
                    <div class="loading-spinner"></div>
                </div>
            `;
        }

        const { hasLiquidity, liquidityPool } = this.state;

        if (hasLiquidity) {
            return this.renderDextools(liquidityPool);
        }

        return this.renderBondingView();
    }

    renderDextools(poolAddress) {
        const dextoolsUrl = `https://www.dextools.io/widget-chart/en/ether/pe-light/${poolAddress}?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false`;

        return `
            <div class="bonding-section dextools-view">
                <div class="dextools-header">
                    <span class="phase-badge deployed">Liquidity Deployed</span>
                    <a href="https://www.dextools.io/app/en/ether/pair-explorer/${poolAddress}"
                       target="_blank" rel="noopener" class="dextools-link">
                        Open in Dextools
                    </a>
                </div>
                <div class="dextools-embed">
                    <iframe src="${dextoolsUrl}" frameborder="0" allowfullscreen></iframe>
                </div>
            </div>
        `;
    }

    renderBondingView() {
        const {
            phase, currentPrice, currentSupply, maxSupply,
            ethRaised, progress, timeUntilOpen, timeUntilMaturity
        } = this.state;

        const phaseConfig = this.getPhaseConfig();
        const timeDisplay = phase === 'pre-open' ? this.formatTime(timeUntilOpen) :
                           phase === 'bonding' ? this.formatTime(timeUntilMaturity) : null;

        return `
            <div class="bonding-section">
                <div class="bonding-header">
                    <span class="phase-badge" style="background: ${phaseConfig.bg}; color: ${phaseConfig.color}">
                        ${phaseConfig.label}
                    </span>
                    ${timeDisplay ? `
                        <span class="time-remaining">
                            ${phase === 'pre-open' ? 'Opens in' : 'Matures in'} ${timeDisplay}
                        </span>
                    ` : ''}
                </div>

                <div class="bonding-chart">
                    <canvas class="bonding-canvas"></canvas>
                </div>

                <div class="bonding-progress">
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-labels">
                        <span>0%</span>
                        <span class="progress-current">${progress.toFixed(1)}% filled</span>
                        <span>100%</span>
                    </div>
                </div>

                <div class="bonding-stats">
                    <div class="stat-card">
                        <div class="stat-value">${this.formatPrice(currentPrice)}</div>
                        <div class="stat-label">ETH / Token</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.formatEth(ethRaised)}</div>
                        <div class="stat-label">ETH Raised</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.formatNumber(currentSupply)}</div>
                        <div class="stat-label">Tokens Sold</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.formatNumber(maxSupply - currentSupply)}</div>
                        <div class="stat-label">Remaining</div>
                    </div>
                </div>
            </div>
        `;
    }

    unmount() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
        }
        super.unmount();
    }
}

export default BondingProgressSection;
