/**
 * BondingProgressSection - Microact Version
 *
 * Clean bonding curve visualization with stats during bonding phase.
 * Shows Dextools iframe after liquidity deployment.
 */

import { Component, h } from '../../core/microact-setup.js';
import { createTradeEventCache } from '../../utils/tradeEventCache.js';
import { aggregateCandles } from '../../utils/candleAggregator.js';

export class BondingProgressSection extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            loading: true,
            hasLiquidity: false,
            liquidityPool: null,
            phase: 'pre-open',
            currentPrice: 0,
            currentSupply: 0,
            maxSupply: 0,
            ethRaised: 0,
            progress: 0,
            openTime: null,
            maturityTime: null,
            timeUntilOpen: null,
            timeUntilMaturity: null
        };
        this.canvas = null;
        this.resizeHandler = null;
        this.refreshInterval = null;
        this.tradeCache = null;
        this.candles = [];
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadData();

        // Setup canvas after re-render settles
        // Use requestAnimationFrame to ensure DOM is painted
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this.setupCanvas());
        });

        // Initialize trade event cache for candle chart
        this.initTradeCache();

        // Refresh data periodically
        this.refreshInterval = setInterval(() => this.loadData(), 30000);
        this.registerCleanup(() => {
            if (this.refreshInterval) clearInterval(this.refreshInterval);
            if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        });
    }

    async initTradeCache() {
        try {
            const provider = this.adapter.provider;
            const address = this.adapter.contractAddress;
            if (!provider || !address || provider.isMock) return;

            this.tradeCache = await createTradeEventCache(address, provider);
            const events = await this.tradeCache.fetchNewest();
            if (events.length) {
                this.candles = aggregateCandles(events);
                this.canvas = this._el?.querySelector('.bonding-canvas');
                if (this.canvas) this.drawChart();
            }

            // Background backfill one older chunk
            this.tradeCache.fetchOlderChunk().then(events => {
                if (events.length) {
                    this.candles = aggregateCandles(events);
                    this.canvas = this._el?.querySelector('.bonding-canvas');
                    if (this.canvas) this.drawChart();
                }
            });
        } catch (e) {
            console.warn('[BondingProgressSection] Trade cache init failed:', e);
        }
    }

    async loadData() {
        try {
            const [bondingStatus, supplyInfo, liquidityPool] = await Promise.all([
                this.adapter.getBondingStatus().catch(() => null),
                this.adapter.getSupplyInfo().catch(() => null),
                this.adapter.liquidityPool().catch(() => null)
            ]);

            const hasLiquidity = liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000';

            const currentSupply = parseFloat(supplyInfo?.currentBondingSupply || 0);
            const maxSupply = parseFloat(supplyInfo?.maxBondingSupply || 1);
            const progress = maxSupply > 0 ? (currentSupply / maxSupply) * 100 : 0;

            let currentPrice = 0;
            try {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                const oneToken = ethers.utils.parseUnits('1', 18).toString();
                const costWei = await this.adapter.calculateCost(oneToken);
                currentPrice = parseFloat(ethers.utils.formatEther(costWei)) || 0;
            } catch (e) {
                console.warn('[BondingProgressSection] Error getting price:', e);
            }

            const ethRaised = parseFloat(bondingStatus?.currentReserve || 0);

            const now = Math.floor(Date.now() / 1000);
            const openTime = bondingStatus?.openTime ? parseInt(bondingStatus.openTime) : null;
            const maturityTime = bondingStatus?.maturityTime ? parseInt(bondingStatus.maturityTime) : null;

            let timeUntilOpen = null;
            let timeUntilMaturity = null;

            if (openTime && now < openTime) timeUntilOpen = openTime - now;
            if (maturityTime && now < maturityTime) timeUntilMaturity = maturityTime - now;

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

            if (!hasLiquidity) {
                // Refresh trade events if cache exists
                if (this.tradeCache) {
                    this.tradeCache.fetchNewest().then(events => {
                        if (events.length) this.candles = aggregateCandles(events);
                    }).catch(() => {});
                }

                // Re-acquire canvas after state update triggers re-render
                requestAnimationFrame(() => {
                    this.canvas = this._el?.querySelector('.bonding-canvas');
                    if (this.canvas) this.drawChart();
                });
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

        this.canvas = this._el?.querySelector('.bonding-canvas');
        if (this.canvas) {
            this.drawChart();

            if (!this.resizeHandler) {
                this.resizeHandler = () => {
                    this.canvas = this._el?.querySelector('.bonding-canvas');
                    if (this.canvas) requestAnimationFrame(() => this.drawChart());
                };
                window.addEventListener('resize', this.resizeHandler);
            }
        }
    }

    drawChart() {
        if (this.candles.length > 0) {
            this.drawCandleChart();
        }
    }

    drawCandleChart() {
        if (!this.canvas) return;

        const ctx = this.canvas.getContext('2d');
        const rect = this.canvas.getBoundingClientRect();

        // Skip drawing if canvas is hidden (e.g. inactive tab) — prevents wiping to 0x0
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 15, right: 75, bottom: 20, left: 10 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        const candles = this.candles;

        ctx.clearRect(0, 0, width, height);

        // Price range with padding
        const allPrices = candles.flatMap(c => [c.high, c.low]);
        let minPrice = Math.min(...allPrices);
        let maxPrice = Math.max(...allPrices);
        const priceRange = maxPrice - minPrice || maxPrice * 0.1 || 0.001;
        minPrice -= priceRange * 0.1;
        maxPrice += priceRange * 0.1;

        const scaleY = (price) =>
            padding.top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;

        // Grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight * i) / 4;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        // Candles
        const slotWidth = chartWidth / candles.length;
        const bodyWidth = Math.max(1, slotWidth * 0.6);

        candles.forEach((candle, i) => {
            const cx = padding.left + (i + 0.5) * slotWidth;
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? '#34c759' : '#ff3b30';

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, scaleY(candle.high));
            ctx.lineTo(cx, scaleY(candle.low));
            ctx.stroke();

            // Body — minimum 4px so single-trade candles are visible
            const bodyTop = scaleY(Math.max(candle.open, candle.close));
            const bodyBot = scaleY(Math.min(candle.open, candle.close));
            const bodyH = Math.max(bodyBot - bodyTop, 4);
            const bodyY = bodyBot - bodyTop < 4
                ? bodyTop - 2  // center the minimum-height body on the price
                : bodyTop;

            if (candle.trades === 0) {
                // Empty interval — faint narrow bar at carry-forward price
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.fillRect(cx - bodyWidth / 4, bodyY, bodyWidth / 2, bodyH);
            } else {
                ctx.fillStyle = color;
                ctx.fillRect(cx - bodyWidth / 2, bodyY, bodyWidth, bodyH);
            }
        });

        // Current price dashed line
        const currentPrice = candles[candles.length - 1].close;
        const priceY = scaleY(currentPrice);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, priceY);
        ctx.lineTo(padding.left + chartWidth, priceY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price axis labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'left';
        const labelX = padding.left + chartWidth + 4;

        for (let i = 0; i <= 4; i++) {
            const price = minPrice + (maxPrice - minPrice) * ((4 - i) / 4);
            const y = padding.top + (chartHeight * i) / 4;
            ctx.fillText(this.formatPrice(price), labelX, y + 3);
        }

        // Current price label (highlighted)
        ctx.fillStyle = '#34c759';
        ctx.fillText(this.formatPrice(currentPrice), labelX, priceY + 3);
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
            'pre-open': { label: 'Pre-Open', color: '#8e8e93', bg: 'rgba(142, 142, 147, 0.15)' },
            'bonding': { label: 'Bonding Active', color: '#34c759', bg: 'rgba(52, 199, 89, 0.15)' },
            'matured': { label: 'Matured', color: '#ff9500', bg: 'rgba(255, 149, 0, 0.15)' },
            'deployed': { label: 'Liquidity Deployed', color: '#5856d6', bg: 'rgba(88, 86, 214, 0.15)' }
        };
        return configs[this.state.phase] || configs['pre-open'];
    }

    render() {
        const { loading, hasLiquidity, liquidityPool } = this.state;

        if (loading) {
            return h('div', { className: 'bonding-section loading' },
                h('div', { className: 'loading-spinner' })
            );
        }

        if (hasLiquidity) {
            const dextoolsUrl = `https://www.dextools.io/widget-chart/en/ether/pe-light/${liquidityPool}?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false`;

            return h('div', { className: 'bonding-section dextools-view' },
                h('div', { className: 'dextools-header' },
                    h('span', { className: 'phase-badge deployed' }, 'Liquidity Deployed'),
                    h('a', {
                        href: `https://www.dextools.io/app/en/ether/pair-explorer/${liquidityPool}`,
                        target: '_blank',
                        rel: 'noopener',
                        className: 'dextools-link'
                    }, 'Open in Dextools')
                ),
                h('div', { className: 'dextools-embed' },
                    h('iframe', { src: dextoolsUrl, frameborder: '0', allowfullscreen: true })
                )
            );
        }

        const { phase, currentPrice, currentSupply, maxSupply, ethRaised, progress, timeUntilOpen, timeUntilMaturity } = this.state;
        const phaseConfig = this.getPhaseConfig();
        const timeDisplay = phase === 'pre-open' ? this.formatTime(timeUntilOpen) :
                           phase === 'bonding' ? this.formatTime(timeUntilMaturity) : null;

        return h('div', { className: 'bonding-section' },
            h('div', { className: 'bonding-header' },
                h('span', {
                    className: 'phase-badge',
                    style: `background: ${phaseConfig.bg}; color: ${phaseConfig.color}`
                }, phaseConfig.label),
                timeDisplay && h('span', { className: 'time-remaining' },
                    `${phase === 'pre-open' ? 'Opens in' : 'Matures in'} ${timeDisplay}`
                )
            ),

            h('div', { className: 'bonding-chart' },
                h('canvas', { className: 'bonding-canvas' })
            ),

            h('div', { className: 'bonding-progress' },
                h('div', { className: 'progress-track' },
                    h('div', { className: 'progress-fill', style: `width: ${progress}%` })
                ),
                h('div', { className: 'progress-labels' },
                    h('span', null, '0%'),
                    h('span', { className: 'progress-current' }, `${progress.toFixed(1)}% filled`),
                    h('span', null, '100%')
                )
            ),

            h('div', { className: 'bonding-stats' },
                h('div', { className: 'stat-card' },
                    h('div', { className: 'stat-value' }, this.formatPrice(currentPrice)),
                    h('div', { className: 'stat-label' }, 'ETH / Token')
                ),
                h('div', { className: 'stat-card' },
                    h('div', { className: 'stat-value' }, this.formatEth(ethRaised)),
                    h('div', { className: 'stat-label' }, 'ETH Raised')
                ),
                h('div', { className: 'stat-card' },
                    h('div', { className: 'stat-value' }, this.formatNumber(currentSupply)),
                    h('div', { className: 'stat-label' }, 'Tokens Sold')
                ),
                h('div', { className: 'stat-card' },
                    h('div', { className: 'stat-value' }, this.formatNumber(maxSupply - currentSupply)),
                    h('div', { className: 'stat-label' }, 'Remaining')
                )
            )
        );
    }
}

export default BondingProgressSection;
