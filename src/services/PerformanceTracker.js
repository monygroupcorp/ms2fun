/**
 * PerformanceTracker
 * 
 * Lightweight, always-on performance monitoring that tracks Core Web Vitals
 * and scroll performance continuously. Zero impact on user experience.
 */

class PerformanceTracker {
    constructor() {
        this.metrics = {
            coreWebVitals: {
                lcp: null, // Largest Contentful Paint
                fid: null, // First Input Delay
                cls: null, // Cumulative Layout Shift
                fcp: null, // First Contentful Paint
                ttfb: null // Time to First Byte
            },
            scrollPerformance: {
                avgFPS: null,
                frameDrops: 0,
                lastUpdate: null
            },
            resourceTiming: [],
            navigationTiming: null
        };

        this.observers = [];
        this.isTracking = false;

        // Bind methods
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
    }

    /**
     * Start tracking performance metrics
     */
    start() {
        if (this.isTracking) {
            return;
        }

        this.isTracking = true;

        // Track Core Web Vitals
        this.trackCoreWebVitals();

        // Track navigation timing
        this.trackNavigationTiming();

        // Track resource timing
        this.trackResourceTiming();
    }

    /**
     * Track Core Web Vitals
     */
    trackCoreWebVitals() {
        if (!('PerformanceObserver' in window)) {
            return;
        }

        // Track LCP (Largest Contentful Paint)
        try {
            const lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const lastEntry = entries[entries.length - 1];
                this.metrics.coreWebVitals.lcp = lastEntry.renderTime || lastEntry.loadTime;
            });
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            this.observers.push(lcpObserver);
        } catch (e) {
            // LCP observer not supported
        }

        // Track FID (First Input Delay)
        try {
            const fidObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    if (!this.metrics.coreWebVitals.fid) {
                        this.metrics.coreWebVitals.fid = entry.processingStart - entry.startTime;
                    }
                });
            });
            fidObserver.observe({ entryTypes: ['first-input'] });
            this.observers.push(fidObserver);
        } catch (e) {
            // FID observer not supported
        }

        // Track CLS (Cumulative Layout Shift)
        try {
            let clsValue = 0;
            const clsObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    if (!entry.hadRecentInput) {
                        clsValue += entry.value;
                    }
                });
                this.metrics.coreWebVitals.cls = clsValue;
            });
            clsObserver.observe({ entryTypes: ['layout-shift'] });
            this.observers.push(clsObserver);
        } catch (e) {
            // CLS observer not supported
        }

        // Track FCP (First Contentful Paint)
        try {
            const paintObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    if (entry.name === 'first-contentful-paint' && !this.metrics.coreWebVitals.fcp) {
                        this.metrics.coreWebVitals.fcp = entry.startTime;
                    }
                });
            });
            paintObserver.observe({ entryTypes: ['paint'] });
            this.observers.push(paintObserver);
        } catch (e) {
            // Paint observer not supported
        }
    }

    /**
     * Track navigation timing
     */
    trackNavigationTiming() {
        if ('performance' in window && 'getEntriesByType' in performance) {
            const navigationEntries = performance.getEntriesByType('navigation');
            if (navigationEntries.length > 0) {
                const nav = navigationEntries[0];
                this.metrics.navigationTiming = {
                    domContentLoaded: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
                    loadComplete: nav.loadEventEnd - nav.loadEventStart,
                    domInteractive: nav.domInteractive - nav.fetchStart,
                    ttfb: nav.responseStart - nav.requestStart
                };
                this.metrics.coreWebVitals.ttfb = this.metrics.navigationTiming.ttfb;
            }
        }
    }

    /**
     * Track resource timing
     */
    trackResourceTiming() {
        if (!('PerformanceObserver' in window)) {
            return;
        }

        try {
            const resourceObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    // Only track significant resources
                    if (entry.transferSize > 10000) { // > 10KB
                        this.metrics.resourceTiming.push({
                            name: entry.name,
                            type: entry.initiatorType,
                            size: entry.transferSize,
                            duration: entry.duration,
                            startTime: entry.startTime
                        });
                    }
                });
            });
            resourceObserver.observe({ entryTypes: ['resource'] });
            this.observers.push(resourceObserver);
        } catch (e) {
            // Resource observer not supported
        }
    }

    /**
     * Update scroll performance metrics
     */
    updateScrollMetrics(scrollMetrics) {
        if (scrollMetrics && scrollMetrics.isMonitoring) {
            this.metrics.scrollPerformance = {
                avgFPS: scrollMetrics.currentFPS,
                frameDrops: scrollMetrics.frameDrops,
                lastUpdate: Date.now()
            };
        }
    }

    /**
     * Get all metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            isTracking: this.isTracking
        };
    }

    /**
     * Get Core Web Vitals summary
     */
    getCoreWebVitalsSummary() {
        const cwv = this.metrics.coreWebVitals;
        const summary = {};

        if (cwv.lcp !== null) {
            summary.lcp = {
                value: cwv.lcp,
                rating: cwv.lcp < 2500 ? 'good' : cwv.lcp < 4000 ? 'needs-improvement' : 'poor'
            };
        }

        if (cwv.fid !== null) {
            summary.fid = {
                value: cwv.fid,
                rating: cwv.fid < 100 ? 'good' : cwv.fid < 300 ? 'needs-improvement' : 'poor'
            };
        }

        if (cwv.cls !== null) {
            summary.cls = {
                value: cwv.cls,
                rating: cwv.cls < 0.1 ? 'good' : cwv.cls < 0.25 ? 'needs-improvement' : 'poor'
            };
        }

        if (cwv.fcp !== null) {
            summary.fcp = {
                value: cwv.fcp,
                rating: cwv.fcp < 1800 ? 'good' : cwv.fcp < 3000 ? 'needs-improvement' : 'poor'
            };
        }

        if (cwv.ttfb !== null) {
            summary.ttfb = {
                value: cwv.ttfb,
                rating: cwv.ttfb < 800 ? 'good' : cwv.ttfb < 1800 ? 'needs-improvement' : 'poor'
            };
        }

        return summary;
    }

    /**
     * Check if performance is degraded
     */
    isPerformanceDegraded() {
        const summary = this.getCoreWebVitalsSummary();
        
        // Check if any metric is "poor"
        return Object.values(summary).some(metric => metric.rating === 'poor');
    }

    /**
     * Stop tracking
     */
    stop() {
        if (!this.isTracking) {
            return;
        }

        this.isTracking = false;

        // Disconnect all observers
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (e) {
                // Ignore errors
            }
        });

        this.observers = [];
    }

    /**
     * Reset metrics
     */
    reset() {
        this.metrics = {
            coreWebVitals: {
                lcp: null,
                fid: null,
                cls: null,
                fcp: null,
                ttfb: null
            },
            scrollPerformance: {
                avgFPS: null,
                frameDrops: 0,
                lastUpdate: null
            },
            resourceTiming: [],
            navigationTiming: null
        };
    }
}

// Export singleton instance
export const performanceTracker = new PerformanceTracker();
export default performanceTracker;

