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
        const { performanceTracker } = await import('../services/PerformanceTracker.js');

        // Run analysis
        const analysisResults = await performanceAnalyzer.analyze();
        const scrollMetrics = scrollPerformanceMonitor.getMetrics();
        const scrollIssues = scrollPerformanceMonitor.getIssues();
        const trackerMetrics = performanceTracker.getMetrics();
        const resourceSummary = performanceTracker.getResourceSummary();
        const longTaskSummary = performanceTracker.getLongTaskSummary();

        // Add scroll issues to analysis results
        analysisResults.scrollIssues = scrollIssues;

        // Generate recommendations
        const recommendations = performanceRecommendations.generateRecommendations(
            analysisResults,
            scrollMetrics
        );

        // Log report
        this.logReport(scrollMetrics, recommendations, analysisResults, trackerMetrics, resourceSummary, longTaskSummary);
    }

    /**
     * Log formatted report to console
     */
    logReport(scrollMetrics, recommendations, analysisResults, trackerMetrics = null, resourceSummary = null, longTaskSummary = null) {
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

        // Long Tasks Breakdown
        if (longTaskSummary && longTaskSummary.count > 0) {
            console.log('%c⏱️  LONG TASKS BREAKDOWN', 'color: #34495e; font-weight: bold; font-size: 14px;');
            console.log(`%c  Total: ${longTaskSummary.count} long tasks (${longTaskSummary.totalDuration.toFixed(2)}ms total)`, 'color: #e74c3c;');
            console.log(`%c  Average Duration: ${longTaskSummary.averageDuration.toFixed(2)}ms`, 'color: #e74c3c;');
            
            // Show breakdown by source
            const sources = Object.keys(longTaskSummary.bySource);
            if (sources.length > 0) {
                console.log(`%c  By Source:`, 'color: #7f8c8d;');
                sources.forEach(source => {
                    const sourceData = longTaskSummary.bySource[source];
                    console.log(`    - ${source}: ${sourceData.count} tasks, ${sourceData.totalDuration.toFixed(2)}ms total`);
                });
            }
            
            // Show top 3 longest tasks with detailed info
            if (longTaskSummary.tasks.length > 0) {
                const topTasks = [...longTaskSummary.tasks]
                    .sort((a, b) => b.duration - a.duration)
                    .slice(0, 3);
                console.log(`%c  Longest Tasks:`, 'color: #7f8c8d;');
                topTasks.forEach((task, idx) => {
                    console.log(`    ${idx + 1}. ${task.duration.toFixed(2)}ms - ${task.source || task.name}`);
                    // Show attribution details if available
                    if (task.attribution && task.attribution.length > 0) {
                        task.attribution.forEach((attr, attrIdx) => {
                            if (attr.containerSrc) {
                                const filename = attr.containerSrc.split('/').pop().split('?')[0];
                                console.log(`       └─ Script: ${filename}`);
                                console.log(`       └─ Full URL: ${attr.containerSrc}`);
                            }
                            if (attr.containerName) {
                                console.log(`       └─ Container: ${attr.containerName}`);
                            }
                            if (attr.containerType) {
                                console.log(`       └─ Type: ${attr.containerType}`);
                            }
                            if (attr.name) {
                                console.log(`       └─ Name: ${attr.name}`);
                            }
                            if (attr.entryType) {
                                console.log(`       └─ Entry Type: ${attr.entryType}`);
                            }
                        });
                    }
                });
            }
            console.log('');
            console.log('%c💡 Tip: Check console warnings (⚠️) for detailed long task information', 'color: #3498db; font-style: italic;');
            console.log('%c💡 Tip: Run performanceTracker.getMetrics().longTasks in console for full details', 'color: #3498db; font-style: italic;');
            console.log('');
        }

        // Resource Loading Analysis
        if (resourceSummary && resourceSummary.total > 0) {
            console.log('%c📦 RESOURCE LOADING', 'color: #34495e; font-weight: bold; font-size: 14px;');
            console.log(`%c  Total Resources: ${resourceSummary.total}`, 'color: #34495e;');
            console.log(`%c  Total Size: ${(resourceSummary.totalSize / 1024).toFixed(2)} KB`, 'color: #34495e;');
            console.log(`%c  Total Load Time: ${resourceSummary.totalDuration.toFixed(2)}ms`, 'color: #34495e;');
            
            if (resourceSummary.blockers > 0) {
                console.log(`%c  Render-Blocking Resources: ${resourceSummary.blockers}`, 'color: #e74c3c; font-weight: bold;');
            }
            
            // Show resources by type
            const types = Object.keys(resourceSummary.byType);
            if (types.length > 0) {
                console.log(`%c  By Type:`, 'color: #7f8c8d;');
                types.forEach(type => {
                    const typeData = resourceSummary.byType[type];
                    const avgDuration = typeData.totalDuration / typeData.count;
                    console.log(`    - ${type}: ${typeData.count} files, ${(typeData.totalSize / 1024).toFixed(2)} KB, ${avgDuration.toFixed(2)}ms avg`);
                });
            }
            
            // Show slowest resources
            if (resourceSummary.slowest.length > 0) {
                console.log(`%c  Slowest Resources:`, 'color: #7f8c8d;');
                resourceSummary.slowest.slice(0, 5).forEach((resource, idx) => {
                    const fileName = resource.name.split('/').pop() || resource.name;
                    const sizeKB = (resource.size / 1024).toFixed(2);
                    console.log(`    ${idx + 1}. ${resource.duration.toFixed(2)}ms - ${fileName} (${sizeKB} KB, ${resource.type})`);
                });
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
        
        if (trackerMetrics) {
            console.log('Performance Tracker Metrics:', trackerMetrics);
        }
        
        if (resourceSummary) {
            console.log('Resource Summary:', resourceSummary);
            console.log('All Resources:', trackerMetrics?.resourceTiming || []);
        }
        
        if (longTaskSummary) {
            console.log('Long Task Summary:', longTaskSummary);
            console.log('All Long Tasks (with full details):', trackerMetrics?.longTasks || []);
            console.log('%c💡 To inspect a specific long task:', 'color: #3498db; font-weight: bold;');
            console.log('   const tasks = performanceTracker.getMetrics().longTasks;');
            console.log('   console.log(tasks[0]); // Inspect first long task');
            console.log('   console.log(tasks[0].fullEntry); // See full entry details');
            console.log('   console.log(tasks[0].attribution); // See attribution (source) info');
        }
        
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

