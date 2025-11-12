/**
 * PerformanceIndicator
 * 
 * Optional visual indicator showing scroll FPS and quick access to recommendations.
 * Only visible in dev mode or with ?performance=true query parameter.
 */

import { Component } from '../../core/Component.js';

export class PerformanceIndicator extends Component {
    constructor() {
        super();
        this.fps = 60;
        this.isVisible = false;
        this.updateInterval = null;
    }

    async onMount() {
        // Only show if performance monitoring is enabled
        const urlParams = new URLSearchParams(window.location.search);
        const queryParamEnabled = urlParams.get('performance') === 'true';
        const localStorageEnabled = localStorage.getItem('ms2fun-performance-monitoring') === 'true';
        const isDevMode = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        const showIndicator = queryParamEnabled || localStorageEnabled || isDevMode;

        if (!showIndicator) {
            return;
        }

        this.isVisible = true;
        this.render();

        // Start updating FPS
        this.startUpdates();

        // Make clickable to show recommendations
        const indicator = this.element.querySelector('.performance-indicator');
        if (indicator) {
            indicator.addEventListener('click', () => {
                this.showRecommendations();
            });
        }

        // Add toggle button
        const toggleBtn = this.element.querySelector('.performance-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMonitoring();
            });
        }
    }

    onUnmount() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    render() {
        if (!this.isVisible) {
            return '';
        }

        const statusColor = this.fps >= 55 ? '#2ecc71' : this.fps >= 45 ? '#f39c12' : '#e74c3c';
        const statusText = this.fps >= 55 ? 'Good' : this.fps >= 45 ? 'Fair' : 'Poor';
        const isMonitoringEnabled = localStorage.getItem('ms2fun-performance-monitoring') === 'true' ||
                                   new URLSearchParams(window.location.search).get('performance') === 'true';

        return `
            <div class="performance-indicator" style="
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
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background: ${statusColor};
                            display: inline-block;
                        "></span>
                        <span>${this.fps} FPS</span>
                        <span style="color: #95a5a6; font-size: 12px;">(${statusText})</span>
                    </div>
                    <button class="performance-toggle" style="
                        background: ${isMonitoringEnabled ? '#e74c3c' : '#2ecc71'};
                        border: none;
                        color: white;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 10px;
                        cursor: pointer;
                        font-weight: bold;
                    " title="${isMonitoringEnabled ? 'Disable monitoring' : 'Enable monitoring'}">
                        ${isMonitoringEnabled ? 'OFF' : 'ON'}
                    </button>
                </div>
                <div style="
                    font-size: 11px;
                    color: #95a5a6;
                    text-align: center;
                ">Click for details</div>
            </div>
        `;
    }

    async startUpdates() {
        const { scrollPerformanceMonitor } = await import('../../services/ScrollPerformanceMonitor.js');
        
        this.updateInterval = setInterval(() => {
            const metrics = scrollPerformanceMonitor.getMetrics();
            if (metrics.isMonitoring) {
                this.fps = metrics.currentFPS;
                this.update();
            }
        }, 1000); // Update every second
    }

    async showRecommendations() {
        // Import and trigger report generation
        const { performanceReporter } = await import('../../utils/PerformanceReporter.js');
        await performanceReporter.generateReport();
        
        // Scroll console into view if possible
        console.log('%c💡 Scroll up in the console to see the full performance report!', 'color: #3498db; font-weight: bold;');
    }

    async toggleMonitoring() {
        if (window.togglePerformanceMonitoring) {
            const currentState = localStorage.getItem('ms2fun-performance-monitoring') === 'true' ||
                               new URLSearchParams(window.location.search).get('performance') === 'true';
            await window.togglePerformanceMonitoring(!currentState);
            
            // Update the indicator
            this.update();
        } else {
            console.warn('Performance monitoring toggle not available yet. Try again in a moment.');
        }
    }
}

