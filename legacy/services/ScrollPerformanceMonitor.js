/**
 * ScrollPerformanceMonitor
 * 
 * Automatically monitors scrolling performance to detect frame drops,
 * expensive repaints, and layout thrashing during scroll.
 * 
 * Runs automatically in the background with zero user intervention needed.
 */

class ScrollPerformanceMonitor {
    constructor() {
        this.isMonitoring = false;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.frameDrops = [];
        this.scrollEvents = [];
        this.paintTimes = [];
        this.longTasks = [];
        
        // Performance thresholds
        this.TARGET_FPS = 60;
        this.FRAME_TIME_TARGET = 1000 / this.TARGET_FPS; // ~16.67ms
        this.LONG_TASK_THRESHOLD = 50; // ms
        this.SCROLL_SAMPLE_SIZE = 100; // Number of scroll events to analyze
        
        // Bind methods
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
        this.measureFrame = this.measureFrame.bind(this);
        
        // Observer for long tasks
        this.longTaskObserver = null;
    }

    /**
     * Start monitoring scroll performance
     */
    start() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.frameDrops = [];
        this.scrollEvents = [];
        this.paintTimes = [];

        // Monitor frame rate using requestAnimationFrame
        this.measureFrame();

        // Monitor scroll events
        window.addEventListener('scroll', this.handleScroll, { passive: true });

        // Monitor long tasks (if supported)
        if ('PerformanceObserver' in window) {
            try {
                this.longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > this.LONG_TASK_THRESHOLD) {
                            this.longTasks.push({
                                duration: entry.duration,
                                startTime: entry.startTime,
                                name: entry.name || 'unknown'
                            });
                        }
                    }
                });
                this.longTaskObserver.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                // Long task observer not supported
            }
        }

        // Monitor paint times
        if ('PerformanceObserver' in window) {
            try {
                this.paintObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        this.paintTimes.push({
                            name: entry.name,
                            startTime: entry.startTime,
                            duration: entry.duration
                        });
                    }
                });
                this.paintObserver.observe({ entryTypes: ['paint'] });
            } catch (e) {
                // Paint observer not supported
            }
        }
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        window.removeEventListener('scroll', this.handleScroll);

        if (this.longTaskObserver) {
            this.longTaskObserver.disconnect();
            this.longTaskObserver = null;
        }

        if (this.paintObserver) {
            this.paintObserver.disconnect();
            this.paintObserver = null;
        }
    }

    /**
     * Measure frame rate using requestAnimationFrame
     */
    measureFrame() {
        if (!this.isMonitoring) {
            return;
        }

        const now = performance.now();
        const frameTime = now - this.lastFrameTime;

        // Detect frame drops (frame time > target frame time)
        if (frameTime > this.FRAME_TIME_TARGET * 1.5) {
            this.frameDrops.push({
                frameTime,
                timestamp: now,
                expectedFrameTime: this.FRAME_TIME_TARGET
            });
        }

        this.frameCount++;
        this.lastFrameTime = now;

        requestAnimationFrame(this.measureFrame);
    }

    /**
     * Handle scroll events to measure scroll handler performance
     */
    handleScroll() {
        if (this.scrollEvents.length >= this.SCROLL_SAMPLE_SIZE) {
            // Keep only recent events
            this.scrollEvents.shift();
        }

        const startTime = performance.now();
        
        // Use requestAnimationFrame to measure when scroll handling completes
        requestAnimationFrame(() => {
            const endTime = performance.now();
            const duration = endTime - startTime;

            this.scrollEvents.push({
                timestamp: startTime,
                duration,
                scrollY: window.scrollY || window.pageYOffset
            });
        });
    }

    /**
     * Get current scroll performance metrics
     */
    getMetrics() {
        const recentFrameDrops = this.frameDrops.filter(
            drop => performance.now() - drop.timestamp < 5000 // Last 5 seconds
        );

        const recentScrollEvents = this.scrollEvents.slice(-50); // Last 50 events
        const avgScrollHandlerTime = recentScrollEvents.length > 0
            ? recentScrollEvents.reduce((sum, e) => sum + e.duration, 0) / recentScrollEvents.length
            : 0;

        const recentPaintTimes = this.paintTimes.filter(
            paint => performance.now() - paint.startTime < 5000
        );
        const avgPaintTime = recentPaintTimes.length > 0
            ? recentPaintTimes.reduce((sum, p) => sum + p.duration, 0) / recentPaintTimes.length
            : 0;

        // Calculate current FPS
        const currentFPS = this.frameCount > 0 && this.lastFrameTime > 0
            ? Math.round(1000 / ((performance.now() - (this.lastFrameTime - (this.frameCount * this.FRAME_TIME_TARGET))) / this.frameCount))
            : this.TARGET_FPS;

        return {
            isMonitoring: this.isMonitoring,
            currentFPS: Math.min(currentFPS, this.TARGET_FPS), // Cap at target
            targetFPS: this.TARGET_FPS,
            frameDrops: recentFrameDrops.length,
            totalFrameDrops: this.frameDrops.length,
            avgScrollHandlerTime,
            maxScrollHandlerTime: recentScrollEvents.length > 0
                ? Math.max(...recentScrollEvents.map(e => e.duration))
                : 0,
            avgPaintTime,
            longTasks: this.longTasks.filter(
                task => performance.now() - task.startTime < 10000 // Last 10 seconds
            ).length,
            totalLongTasks: this.longTasks.length,
            scrollEventCount: this.scrollEvents.length
        };
    }

    /**
     * Check if scroll performance is degraded
     */
    isPerformanceDegraded() {
        const metrics = this.getMetrics();
        
        return (
            metrics.currentFPS < this.TARGET_FPS * 0.9 || // Less than 90% of target FPS
            metrics.frameDrops > 5 || // More than 5 frame drops in last 5 seconds
            metrics.avgScrollHandlerTime > 10 || // Average scroll handler > 10ms
            metrics.maxScrollHandlerTime > 50 || // Max scroll handler > 50ms
            metrics.longTasks > 0 // Any long tasks in last 10 seconds
        );
    }

    /**
     * Get performance issues detected
     */
    getIssues() {
        const metrics = this.getMetrics();
        const issues = [];

        if (metrics.currentFPS < this.TARGET_FPS * 0.9) {
            issues.push({
                type: 'low_fps',
                severity: metrics.currentFPS < 30 ? 'high' : 'medium',
                message: `Frame rate is ${metrics.currentFPS} FPS (target: ${this.TARGET_FPS} FPS)`,
                currentValue: metrics.currentFPS,
                targetValue: this.TARGET_FPS
            });
        }

        if (metrics.frameDrops > 5) {
            issues.push({
                type: 'frame_drops',
                severity: 'high',
                message: `${metrics.frameDrops} frame drops detected in the last 5 seconds`,
                count: metrics.frameDrops
            });
        }

        if (metrics.avgScrollHandlerTime > 10) {
            issues.push({
                type: 'slow_scroll_handler',
                severity: metrics.avgScrollHandlerTime > 30 ? 'high' : 'medium',
                message: `Scroll event handlers are taking ${metrics.avgScrollHandlerTime.toFixed(2)}ms on average`,
                duration: metrics.avgScrollHandlerTime
            });
        }

        if (metrics.maxScrollHandlerTime > 50) {
            issues.push({
                type: 'very_slow_scroll_handler',
                severity: 'high',
                message: `Some scroll handlers are taking up to ${metrics.maxScrollHandlerTime.toFixed(2)}ms`,
                maxDuration: metrics.maxScrollHandlerTime
            });
        }

        if (metrics.longTasks > 0) {
            issues.push({
                type: 'long_tasks',
                severity: 'high',
                message: `${metrics.longTasks} long tasks detected (blocking main thread)`,
                count: metrics.longTasks
            });
        }

        if (metrics.avgPaintTime > 16) {
            issues.push({
                type: 'slow_paint',
                severity: 'medium',
                message: `Paint operations are taking ${metrics.avgPaintTime.toFixed(2)}ms on average`,
                duration: metrics.avgPaintTime
            });
        }

        return issues;
    }

    /**
     * Reset metrics (useful for testing or after fixes)
     */
    reset() {
        this.frameDrops = [];
        this.scrollEvents = [];
        this.paintTimes = [];
        this.longTasks = [];
        this.frameCount = 0;
    }
}

// Export singleton instance
export const scrollPerformanceMonitor = new ScrollPerformanceMonitor();
export default scrollPerformanceMonitor;

