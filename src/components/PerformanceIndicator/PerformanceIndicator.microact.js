/**
 * PerformanceIndicator - Microact Version
 *
 * Optional visual indicator showing scroll FPS and quick access to recommendations.
 * Only visible in dev mode or with ?performance=true query parameter.
 */

import { Component, h } from '../../core/microact-setup.js';

export class PerformanceIndicator extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            fps: 60,
            isVisible: false,
            isMonitoringEnabled: false
        };
        this.updateInterval = null;
    }

    async didMount() {
        // Only show if performance monitoring is enabled
        const urlParams = new URLSearchParams(window.location.search);
        const queryParamEnabled = urlParams.get('performance') === 'true';
        const localStorageEnabled = localStorage.getItem('ms2fun-performance-monitoring') === 'true';
        const isDevMode = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        const showIndicator = queryParamEnabled || localStorageEnabled || isDevMode;

        if (!showIndicator) {
            return;
        }

        this.setState({
            isVisible: true,
            isMonitoringEnabled: queryParamEnabled || localStorageEnabled
        });

        // Start updating FPS
        this.startUpdates();
    }

    willUnmount() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    async startUpdates() {
        const { scrollPerformanceMonitor } = await import('../../services/ScrollPerformanceMonitor.js');

        this.updateInterval = setInterval(() => {
            const metrics = scrollPerformanceMonitor.getMetrics();
            if (metrics.isMonitoring) {
                this.setState({ fps: metrics.currentFPS });
            }
        }, 1000);

        this.registerCleanup(() => {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
            }
        });
    }

    async handleIndicatorClick() {
        // Import and trigger report generation
        const { performanceReporter } = await import('../../utils/PerformanceReporter.js');
        await performanceReporter.generateReport();

        console.log('%c💡 Scroll up in the console to see the full performance report!', 'color: #3498db; font-weight: bold;');
    }

    async handleToggleClick(e) {
        e.stopPropagation();
        if (window.togglePerformanceMonitoring) {
            const newState = !this.state.isMonitoringEnabled;
            await window.togglePerformanceMonitoring(newState);
            this.setState({ isMonitoringEnabled: newState });
        } else {
            console.warn('Performance monitoring toggle not available yet. Try again in a moment.');
        }
    }

    render() {
        const { fps, isVisible, isMonitoringEnabled } = this.state;

        if (!isVisible) {
            return h('div', { className: 'performance-indicator-hidden' });
        }

        const statusColor = fps >= 55 ? '#2ecc71' : fps >= 45 ? '#f39c12' : '#e74c3c';
        const statusText = fps >= 55 ? 'Good' : fps >= 45 ? 'Fair' : 'Poor';

        return h('div', {
            className: 'performance-indicator',
            style: `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 14px;
                z-index: 10000;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: all 0.2s ease;
                min-width: 180px;
            `,
            onClick: this.bind(this.handleIndicatorClick)
        },
            h('div', {
                style: 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;'
            },
                h('div', { style: 'display: flex; align-items: center; gap: 8px;' },
                    h('span', {
                        style: `
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background: ${statusColor};
                            display: inline-block;
                        `
                    }),
                    h('span', null, `${fps} FPS`),
                    h('span', { style: 'color: #95a5a6; font-size: 12px;' }, `(${statusText})`)
                ),
                h('button', {
                    className: 'performance-toggle',
                    style: `
                        background: ${isMonitoringEnabled ? '#e74c3c' : '#2ecc71'};
                        border: none;
                        color: white;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 10px;
                        cursor: pointer;
                        font-weight: bold;
                    `,
                    title: isMonitoringEnabled ? 'Disable monitoring' : 'Enable monitoring',
                    onClick: this.bind(this.handleToggleClick)
                }, isMonitoringEnabled ? 'OFF' : 'ON')
            ),
            h('div', {
                style: 'font-size: 11px; color: #95a5a6; text-align: center;'
            }, 'Click for details')
        );
    }
}

export default PerformanceIndicator;
