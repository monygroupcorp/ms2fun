/**
 * PerformanceReporter
 * 
 * Automatically generates and logs easy-to-read performance reports to the console.
 * No manual commands needed - just open the console to see the report.
 */

class PerformanceReporter {
    constructor() {
        this.reportInterval = null;
        this.hasReportedInitial = false;
        this.lastScrollTime = 0;
    }

    /**
     * Start automatic reporting
     */
    start() {
        // Report immediately after a short delay (to allow page to load)
        setTimeout(() => {
            this.generateReport();
            this.hasReportedInitial = true;
        }, 2000);

        // Set up scroll-based reporting
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            this.lastScrollTime = Date.now();
            
            // Clear existing timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Generate report after scrolling stops (2 seconds of no scrolling)
            scrollTimeout = setTimeout(() => {
                if (Date.now() - this.lastScrollTime >= 2000) {
                    this.generateReport();
                }
            }, 2000);
        }, { passive: true });
    }

    /**
     * Generate and log performance report
     */
    async generateReport() {
        // Import dependencies dynamically to avoid circular dependencies
        const { scrollPerformanceMonitor } = await import('../services/ScrollPerformanceMonitor.js');
        const { performanceAnalyzer } = await import('../services/PerformanceAnalyzer.js');
        const { performanceRecommendations } = await import('./PerformanceRecommendations.js');

        // Run analysis
        const analysisResults = await performanceAnalyzer.analyze();
        const scrollMetrics = scrollPerformanceMonitor.getMetrics();
        const scrollIssues = scrollPerformanceMonitor.getIssues();

        // Add scroll issues to analysis results
        analysisResults.scrollIssues = scrollIssues;

        // Generate recommendations
        const recommendations = performanceRecommendations.generateRecommendations(
            analysisResults,
            scrollMetrics
        );

        // Log report
        this.logReport(scrollMetrics, recommendations, analysisResults);
    }

    /**
     * Log formatted report to console
     */
    logReport(scrollMetrics, recommendations, analysisResults) {
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #4a90e2; font-weight: bold; font-size: 14px;');
        console.log('%c🚀 PERFORMANCE REPORT', 'color: #4a90e2; font-weight: bold; font-size: 16px;');
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #4a90e2; font-weight: bold; font-size: 14px;');
        console.log('');

        // Scroll Performance Summary
        if (scrollMetrics.isMonitoring) {
            const fpsColor = scrollMetrics.currentFPS >= 55 ? '#2ecc71' : scrollMetrics.currentFPS >= 45 ? '#f39c12' : '#e74c3c';
            console.log('%c📊 SCROLL PERFORMANCE', 'color: #34495e; font-weight: bold; font-size: 14px;');
            console.log(`%c  Frame Rate: ${scrollMetrics.currentFPS} FPS (target: ${scrollMetrics.targetFPS} FPS)`, `color: ${fpsColor};`);
            if (scrollMetrics.frameDrops > 0) {
                console.log(`%c  Frame Drops: ${scrollMetrics.frameDrops} in last 5 seconds`, 'color: #e74c3c;');
            }
            if (scrollMetrics.avgScrollHandlerTime > 0) {
                console.log(`%c  Avg Scroll Handler Time: ${scrollMetrics.avgScrollHandlerTime.toFixed(2)}ms`, 
                    scrollMetrics.avgScrollHandlerTime > 10 ? 'color: #e74c3c;' : 'color: #2ecc71;');
            }
            if (scrollMetrics.longTasks > 0) {
                console.log(`%c  Long Tasks: ${scrollMetrics.longTasks} detected`, 'color: #e74c3c;');
            }
            console.log('');
        }

        // Top Recommendations
        const topRecommendations = recommendations.slice(0, 5);
        if (topRecommendations.length > 0) {
            console.log('%c🎯 TOP RECOMMENDATIONS', 'color: #34495e; font-weight: bold; font-size: 14px;');
            console.log('');

            topRecommendations.forEach((rec, index) => {
                const severityColor = rec.severity === 'high' ? '#e74c3c' : rec.severity === 'medium' ? '#f39c12' : '#3498db';
                const severityIcon = rec.severity === 'high' ? '🔴' : rec.severity === 'medium' ? '🟡' : '🔵';

                console.log(`%c${index + 1}. ${severityIcon} ${rec.title}`, `color: ${severityColor}; font-weight: bold;`);
                console.log(`   Category: ${rec.category}`);
                console.log(`   ${rec.description}`);
                console.log(`   %cWhy: ${rec.why}`, 'color: #7f8c8d; font-style: italic;');
                
                if (rec.estimatedImprovement) {
                    console.log(`   %cExpected Improvement: ${rec.estimatedImprovement}`, 'color: #27ae60;');
                }

                if (rec.file) {
                    console.log(`   %cFile to modify: ${rec.file}`, 'color: #9b59b6;');
                }

                if (rec.fix && typeof rec.fix === 'string' && rec.fix.length < 500) {
                    console.log(`   %cFix:`, 'color: #16a085; font-weight: bold;');
                    console.log(`%c${rec.fix}`, 'color: #16a085; font-family: monospace; font-size: 11px;');
                } else if (rec.fix) {
                    console.log(`   %cFix: See detailed fix in recommendation object`, 'color: #16a085;');
                }

                console.log('');
            });
        } else {
            console.log('%c✅ No major performance issues detected!', 'color: #2ecc71; font-weight: bold;');
            console.log('');
        }

        // Issue Summary
        const highIssues = recommendations.filter(r => r.severity === 'high').length;
        const mediumIssues = recommendations.filter(r => r.severity === 'medium').length;
        const lowIssues = recommendations.filter(r => r.severity === 'low').length;

        if (highIssues > 0 || mediumIssues > 0 || lowIssues > 0) {
            console.log('%c📋 ISSUE SUMMARY', 'color: #34495e; font-weight: bold; font-size: 14px;');
            if (highIssues > 0) {
                console.log(`%c  High Priority: ${highIssues}`, 'color: #e74c3c; font-weight: bold;');
            }
            if (mediumIssues > 0) {
                console.log(`%c  Medium Priority: ${mediumIssues}`, 'color: #f39c12;');
            }
            if (lowIssues > 0) {
                console.log(`%c  Low Priority: ${lowIssues}`, 'color: #3498db;');
            }
            console.log('');
        }

        // Detailed Analysis (collapsed)
        console.groupCollapsed('%c🔍 DETAILED ANALYSIS', 'color: #7f8c8d; font-weight: bold;');
        console.log('Scroll Metrics:', scrollMetrics);
        console.log('CSS Issues:', analysisResults.cssIssues);
        console.log('Rendering Issues:', analysisResults.renderingIssues);
        console.log('Resource Issues:', analysisResults.resourceIssues);
        console.log('All Recommendations:', recommendations);
        console.groupEnd();

        console.log('%c═══════════════════════════════════════════════════════════', 'color: #4a90e2; font-weight: bold; font-size: 14px;');
        console.log('%c💡 Tip: Scroll the page to trigger automatic re-analysis', 'color: #7f8c8d; font-style: italic;');
        console.log('');
    }

    /**
     * Stop automatic reporting
     */
    stop() {
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
    }
}

// Export singleton instance
export const performanceReporter = new PerformanceReporter();
export default performanceReporter;

