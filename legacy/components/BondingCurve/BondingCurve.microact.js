/**
 * BondingCurve - Microact Version
 *
 * Displays a bonding curve chart (canvas) or DEXTools iframe when liquidity is deployed.
 * Integrates with tradingStore for price and contract data.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class BondingCurve extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
        this.state = {
            currentPrice: 0,
            totalBondingSupply: 0,
            totalMessages: 0,
            totalNFTs: 0,
            dataReady: false,
            contractEthBalance: 0,
            liquidityPool: null,
            chainId: null
        };
        this.resizeHandler = null;
        this.priceUpdated = false;
        this.contractDataUpdated = false;
    }

    async didMount() {
        try {
            // Fetch network ID from switch.json
            const response = await fetch('/EXEC404/switch.json');
            const config = await response.json();
            this.setState({ chainId: config.network });

            // Check liquidity pool status
            const contractData = this.store.selectContractData();
            const liquidityPool = contractData?.liquidityPool;
            this.setState({ liquidityPool });

            // Subscribe to contract data updates
            const unsub1 = eventBus.on('contractData:updated', () => {
                const contractData = this.store.selectContractData();
                const newLiquidityPool = contractData?.liquidityPool;

                if (newLiquidityPool !== this.state.liquidityPool) {
                    this.setState({ liquidityPool: newLiquidityPool });
                }
            });

            const unsub2 = eventBus.on('price:updated', () => {
                this.priceUpdated = true;
                this.checkAndUpdateState();
            });

            const unsub3 = eventBus.on('contractData:updated', () => {
                this.contractDataUpdated = true;
                this.checkAndUpdateState();
            });

            this.registerCleanup(() => {
                unsub1();
                unsub2();
                unsub3();
            });

            // Get initial values from store
            const currentPrice = this.store.selectPrice();
            const initialContractData = this.store.selectContractData();
            if (currentPrice) this.priceUpdated = true;
            if (initialContractData) this.contractDataUpdated = true;
            this.checkAndUpdateState();

            // Set up resize handler
            this.resizeHandler = () => {
                requestAnimationFrame(() => this.drawCurve());
            };
            window.addEventListener('resize', this.resizeHandler);
            this.registerCleanup(() => {
                window.removeEventListener('resize', this.resizeHandler);
            });

            // Initial draw after mount
            setTimeout(() => this.drawCurve(), 0);

        } catch (error) {
            console.error('[BondingCurve] Error initializing:', error);
        }
    }

    isLiquidityDeployed() {
        return this.state.liquidityPool &&
            this.state.liquidityPool !== '0x0000000000000000000000000000000000000000';
    }

    checkAndUpdateState() {
        if (this.isLiquidityDeployed()) return;

        if (this.priceUpdated && this.contractDataUpdated) {
            const currentPrice = this.store.selectPrice();
            const contractData = this.store.selectContractData();

            this.setState({
                currentPrice,
                totalBondingSupply: contractData.totalBondingSupply,
                totalMessages: contractData.totalMessages,
                totalNFTs: contractData.totalNFTs,
                dataReady: true,
                contractEthBalance: contractData.contractEthBalance
            });

            if (!this.isLiquidityDeployed()) {
                this.drawCurve();
            }
        }
    }

    getNetworkName(chainId) {
        const networks = {
            1: 'ether',
            5: 'goerli',
        };
        return networks[chainId] || 'ether';
    }

    drawCurve() {
        if (!this.element) return;
        const canvas = this.element.querySelector('#curveChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Always draw the base curve
        this.drawBaseCurve(ctx, canvas);

        // Only draw data-dependent elements if data is ready
        if (this.state.dataReady) {
            this.drawDataElements(ctx, canvas);
        } else {
            this.drawPlaceholderLabels(ctx);
        }
    }

    drawBaseCurve(ctx, canvas) {
        const curveColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--bonding-curve-color')
            .trim() || '#764ba2';
        ctx.strokeStyle = curveColor;
        ctx.lineWidth = 2;

        const curve = (x) => {
            const paddedX = 0.1 + (x * 0.8);
            return Math.pow(paddedX, 3.5);
        };

        const points = this.calculateCurvePoints(canvas, curve);
        this.drawCurvePath(ctx, points);
    }

    drawDataElements(ctx, canvas) {
        const curve = (x) => {
            const paddedX = 0.1 + (x * 0.8);
            return Math.pow(paddedX, 3.5);
        };

        const maxPrice = 0.08;
        const { currentPrice } = this.state;
        const priceValue = currentPrice?.current || 0;
        const currentPosition = Math.max(0.1, Math.min(0.9,
            Math.pow(priceValue / maxPrice, 1 / 3.5)));

        const points = this.calculateCurvePoints(canvas, curve);
        this.drawCurrentPosition(ctx, points, currentPosition);
        this.drawLabels(ctx);
    }

    drawPlaceholderLabels(ctx) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText('Loading price data...', 10, 20);
        ctx.fillText('Loading supply data...', 10, 40);
        ctx.fillText('Loading NFT data...', 10, 60);
    }

    calculateCurvePoints(canvas, curve) {
        const points = [];
        const numPoints = 100;

        for (let i = 0; i <= numPoints; i++) {
            const x = i / numPoints;
            const y = curve(x);

            const canvasX = x * canvas.width * 0.8 + canvas.width * 0.1;
            const canvasY = canvas.height * 0.9 - y * canvas.height * 0.8;

            points.push({ x: canvasX, y: canvasY });
        }

        return points;
    }

    drawCurvePath(ctx, points) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }

        ctx.stroke();
    }

    drawCurrentPosition(ctx, points, currentPosition) {
        const segmentSize = 0.05;
        const startIndex = Math.floor((currentPosition - segmentSize / 2) * points.length);
        const endIndex = Math.floor((currentPosition + segmentSize / 2) * points.length);

        if (startIndex >= 0 && endIndex < points.length) {
            const curveColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--bonding-curve-color')
                .trim() || '#764ba2';
            ctx.beginPath();
            ctx.strokeStyle = curveColor;
            ctx.lineWidth = 4;

            ctx.moveTo(points[startIndex].x, points[startIndex].y);
            for (let i = startIndex; i <= endIndex; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();

            // Draw indicator dot
            const centerIndex = Math.floor((startIndex + endIndex) / 2);
            const centerPoint = points[centerIndex];

            ctx.beginPath();
            ctx.arc(centerPoint.x, centerPoint.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#FF0000';
            ctx.fill();
        }
    }

    drawLabels(ctx) {
        const { currentPrice, totalBondingSupply, totalMessages, totalNFTs, contractEthBalance } = this.state;
        const priceValue = currentPrice?.current || 0;

        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText(`${priceValue.toFixed(4)} ETH / EXEC`, 10, 20);
        ctx.fillText(`Total Supply: ${totalBondingSupply?.toLocaleString() || 0} EXEC`, 10, 40);
        ctx.fillText(`Total Messages: ${totalMessages?.toLocaleString() || 0}`, 10, 60);
        ctx.fillText(`Total NFTs: ${totalNFTs?.toLocaleString() || 0}`, 10, 80);
        ctx.fillText(`Contract ETH Balance: ${contractEthBalance || 0}`, 10, 100);
    }

    render() {
        const { liquidityPool, chainId } = this.state;

        if (this.isLiquidityDeployed()) {
            // Render DEXTools iframe
            const networkName = this.getNetworkName(chainId);
            const chartUrl = `https://www.dextools.io/widget-chart/en/${networkName}/pe-light/${liquidityPool}?theme=dark&chartType=2&chartResolution=30&drawingToolbars=false`;

            return h('div', { className: 'bonding-curve marble-bg' },
                h('iframe', {
                    id: 'dextools-widget',
                    title: '$EXEC DEXTools Trading Chart',
                    width: '100%',
                    height: '100%',
                    src: chartUrl,
                    style: 'border: none;'
                })
            );
        }

        // Render canvas for bonding curve
        return h('div', { className: 'bonding-curve marble-bg' },
            h('canvas', { id: 'curveChart' })
        );
    }
}

export default BondingCurve;
