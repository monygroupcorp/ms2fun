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
            navigationTiming: null,
            longTasks: [], // Detailed long task information
            resourceBlockers: [] // Resources that block rendering
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

        // Track long tasks
        this.trackLongTasks();
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
     * Track resource timing with detailed analysis
     */
    trackResourceTiming() {
        if (!('PerformanceObserver' in window)) {
            return;
        }

        try {
            const resourceObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    // Track all resources > 5KB (lowered threshold for better visibility)
                    if (entry.transferSize > 5000) {
                        const resourceInfo = {
                            name: entry.name,
                            type: entry.initiatorType,
                            size: entry.transferSize,
                            duration: entry.duration,
                            startTime: entry.startTime,
                            // Calculate blocking time (time before resource is available)
                            blockingTime: entry.duration - (entry.responseEnd - entry.requestStart),
                            // Check if it's a render-blocking resource
                            isRenderBlocking: this.isRenderBlockingResource(entry),
                            // Resource URL for identification
                            url: entry.name
                        };
                        
                        this.metrics.resourceTiming.push(resourceInfo);
                        
                        // Track render-blocking resources separately
                        if (resourceInfo.isRenderBlocking && resourceInfo.duration > 50) {
                            this.metrics.resourceBlockers.push(resourceInfo);
                        }
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
     * Check if a resource is render-blocking
     */
    isRenderBlockingResource(entry) {
        // Scripts and stylesheets are typically render-blocking
        const blockingTypes = ['script', 'stylesheet', 'font'];
        return blockingTypes.includes(entry.initiatorType) || 
               entry.name.includes('.js') || 
               entry.name.includes('.css');
    }

    /**
     * Track long tasks with detailed information
     */
    trackLongTasks() {
        if (!('PerformanceObserver' in window)) {
            return;
        }

        try {
            const longTaskObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                entries.forEach(entry => {
                    // Capture detailed long task information
                    const longTaskInfo = {
                        duration: entry.duration,
                        startTime: entry.startTime,
                        name: entry.name || 'unknown',
                        // Try to identify the source
                        source: this.identifyTaskSource(entry),
                        // Attribution (if available) - contains detailed source info
                        attribution: entry.attribution || [],
                        // Full entry for debugging (sanitized to avoid circular refs)
                        fullEntry: this.sanitizeEntry(entry)
                    };
                    
                    // Log to console immediately for visibility with detailed attribution
                    const attributionDetails = entry.attribution && entry.attribution.length > 0 
                        ? entry.attribution.map(attr => ({
                            containerSrc: attr.containerSrc,
                            containerName: attr.containerName,
                            containerType: attr.containerType,
                            containerId: attr.containerId,
                            name: attr.name,
                            entryType: attr.entryType
                        }))
                        : [];
                    
                    console.warn(`⚠️ Long Task Detected: ${longTaskInfo.duration.toFixed(2)}ms`, {
                        source: longTaskInfo.source,
                        attributionDetails: attributionDetails,
                        fullEntry: longTaskInfo.fullEntry
                    });
                    
                    // If attribution shows containerSrc, log it prominently
                    if (attributionDetails.length > 0 && attributionDetails[0].containerSrc) {
                        const src = attributionDetails[0].containerSrc;
                        const filename = src.split('/').pop().split('?')[0];
                        console.warn(`   📍 Likely caused by: ${filename} (${src})`);
                    }
                    
                    this.metrics.longTasks.push(longTaskInfo);
                });
            });
            
            // Observe long tasks (tasks > 50ms)
            // Note: buffered flag is not supported with entryTypes, so we'll catch tasks going forward
            try {
                longTaskObserver.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                // Some browsers don't support entryTypes, try type instead
                try {
                    longTaskObserver.observe({ type: 'longtask', buffered: true });
                } catch (e2) {
                    console.warn('Long task observer setup failed:', e2.message);
                    return;
                }
            }
            this.observers.push(longTaskObserver);
        } catch (e) {
            // Long task observer not supported
            console.warn('Long task observer not supported:', e.message);
        }
    }

    /**
     * Sanitize entry for safe logging (remove circular references)
     */
    sanitizeEntry(entry) {
        try {
            return {
                duration: entry.duration,
                startTime: entry.startTime,
                name: entry.name,
                entryType: entry.entryType,
                // Extract attribution details safely
                attributionDetails: entry.attribution ? entry.attribution.map(attr => ({
                    name: attr.name,
                    entryType: attr.entryType,
                    startTime: attr.startTime,
                    duration: attr.duration,
                    containerSrc: attr.containerSrc,
                    containerName: attr.containerName,
                    containerId: attr.containerId,
                    containerType: attr.containerType
                })) : []
            };
        } catch (e) {
            return { error: 'Could not sanitize entry', message: e.message };
        }
    }

    /**
     * Try to identify the source of a long task
     */
    identifyTaskSource(entry) {
        // Check attribution for script URL (most reliable)
        if (entry.attribution && entry.attribution.length > 0) {
            const attribution = entry.attribution[0];
            
            // Check container source (script URL) - this is the most useful
            if (attribution.containerSrc) {
                const url = attribution.containerSrc;
                // Extract filename from URL for cleaner display
                const filename = url.split('/').pop().split('?')[0];
                // Return both filename and full URL
                return `Script: ${filename} (${url})`;
            }
            
            // Check container name
            if (attribution.containerName) {
                return `Container: ${attribution.containerName}`;
            }
            
            // Check container type - if window, try to get more info
            if (attribution.containerType) {
                if (attribution.containerType === 'window') {
                    // Window-level task - could be from script execution
                    // Check if there's a name that might help identify it
                    if (attribution.name) {
                        return `Window Task: ${attribution.name}`;
                    }
                    // Check if there's entryType that might help
                    if (attribution.entryType) {
                        return `Window Task (${attribution.entryType})`;
                    }
                    return `Window-level task (check attribution for details)`;
                }
                return `Type: ${attribution.containerType}`;
            }
        }
        
        // Try to identify from name
        if (entry.name) {
            // Check if it's a CDN script
            if (entry.name.includes('cdn') || entry.name.includes('jsdelivr') || entry.name.includes('cloudflare')) {
                return `CDN Script: ${entry.name}`;
            }
            // Check if it's a local script
            if (entry.name.includes('.js')) {
                return `Script: ${entry.name}`;
            }
            return `Named Task: ${entry.name}`;
        }
        
        return 'Unknown source (check console warnings for full details)';
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
        // Filter long tasks to recent ones (last 10 seconds)
        const recentLongTasks = this.metrics.longTasks.filter(
            task => performance.now() - task.startTime < 10000
        );
        
        // Filter resource blockers to recent ones
        const recentBlockers = this.metrics.resourceBlockers.filter(
            blocker => performance.now() - blocker.startTime < 10000
        );
        
        return {
            ...this.metrics,
            longTasks: recentLongTasks,
            resourceBlockers: recentBlockers,
            totalLongTasks: this.metrics.longTasks.length,
            totalResourceBlockers: this.metrics.resourceBlockers.length,
            isTracking: this.isTracking
        };
    }

    /**
     * Get resource loading summary
     */
    getResourceSummary() {
        const resources = this.metrics.resourceTiming;
        const summary = {
            total: resources.length,
            totalSize: resources.reduce((sum, r) => sum + (r.size || 0), 0),
            totalDuration: resources.reduce((sum, r) => sum + (r.duration || 0), 0),
            blockers: this.metrics.resourceBlockers.length,
            byType: {},
            slowest: []
        };
        
        // Group by type
        resources.forEach(resource => {
            const type = resource.type || 'unknown';
            if (!summary.byType[type]) {
                summary.byType[type] = {
                    count: 0,
                    totalSize: 0,
                    totalDuration: 0
                };
            }
            summary.byType[type].count++;
            summary.byType[type].totalSize += resource.size || 0;
            summary.byType[type].totalDuration += resource.duration || 0;
        });
        
        // Get slowest resources
        summary.slowest = [...resources]
            .sort((a, b) => (b.duration || 0) - (a.duration || 0))
            .slice(0, 10)
            .map(r => ({
                name: r.name,
                duration: r.duration,
                size: r.size,
                type: r.type
            }));
        
        return summary;
    }

    /**
     * Get long task summary
     */
    getLongTaskSummary() {
        const recentTasks = this.metrics.longTasks.filter(
            task => performance.now() - task.startTime < 10000
        );
        
        const summary = {
            count: recentTasks.length,
            totalDuration: recentTasks.reduce((sum, t) => sum + t.duration, 0),
            averageDuration: recentTasks.length > 0 
                ? recentTasks.reduce((sum, t) => sum + t.duration, 0) / recentTasks.length 
                : 0,
            bySource: {},
            tasks: recentTasks
        };
        
        // Group by source
        recentTasks.forEach(task => {
            const source = task.source || 'unknown';
            if (!summary.bySource[source]) {
                summary.bySource[source] = {
                    count: 0,
                    totalDuration: 0
                };
            }
            summary.bySource[source].count++;
            summary.bySource[source].totalDuration += task.duration;
        });
        
        return summary;
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
            navigationTiming: null,
            longTasks: [],
            resourceBlockers: []
        };
    }
}

// Export singleton instance
export const performanceTracker = new PerformanceTracker();
export default performanceTracker;

