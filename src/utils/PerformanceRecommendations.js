/**
 * PerformanceRecommendations
 * 
 * Generates specific, actionable optimization recommendations based on
 * performance analysis results. Provides exact code fixes and explanations.
 */

class PerformanceRecommendations {
    constructor() {
        this.recommendations = [];
    }

    /**
     * Generate recommendations from analysis results and scroll metrics
     */
    generateRecommendations(analysisResults, scrollMetrics) {
        this.recommendations = [];

        // Add recommendations from CSS analysis
        this.addCSSRecommendations(analysisResults.cssIssues);

        // Add recommendations from rendering analysis
        this.addRenderingRecommendations(analysisResults.renderingIssues);

        // Add recommendations from resource analysis
        this.addResourceRecommendations(analysisResults.resourceIssues);

        // Add recommendations from scroll performance
        this.addScrollRecommendations(scrollMetrics);

        // Sort by priority (high severity first, then by impact)
        this.recommendations.sort((a, b) => {
            const severityOrder = { high: 0, medium: 1, low: 2 };
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                return severityOrder[a.severity] - severityOrder[b.severity];
            }
            return (b.impact || 0) - (a.impact || 0);
        });

        return this.recommendations;
    }

    /**
     * Add recommendations from CSS issues
     */
    addCSSRecommendations(cssIssues) {
        cssIssues.forEach(issue => {
            let recommendation = null;

            switch (issue.type) {
                case 'multiple_filters':
                    recommendation = {
                        id: 'css-multiple-filters',
                        title: 'Reduce CSS Filters on Background',
                        severity: issue.severity,
                        impact: 'high',
                        category: 'CSS',
                        description: issue.message,
                        why: 'CSS filters (blur, invert, SVG filters) are expensive to render, especially during scrolling. Each filter requires the browser to recalculate pixels, which can drop frame rates.',
                        fix: this.getFilterOptimizationFix(issue),
                        file: 'src/core/marble.css',
                        estimatedImprovement: '10-20 FPS improvement during scroll'
                    };
                    break;

                case 'marble_background_filters':
                    recommendation = {
                        id: 'css-marble-filters',
                        title: 'Optimize Marble Background Filters',
                        severity: issue.severity,
                        impact: 'high',
                        category: 'CSS',
                        description: issue.message,
                        why: 'The marble background uses expensive filters that recalculate on every scroll frame. This is the most likely cause of scroll sluggishness.',
                        fix: this.getMarbleBackgroundFix(),
                        file: 'src/core/marble.css',
                        estimatedImprovement: '15-25 FPS improvement during scroll'
                    };
                    break;

                case 'fixed_with_transform':
                    recommendation = {
                        id: 'css-fixed-transform',
                        title: 'Add will-change Hint for Fixed Elements',
                        severity: issue.severity,
                        impact: 'medium',
                        category: 'CSS',
                        description: issue.message,
                        why: 'Fixed elements with transforms can cause repaints. Adding will-change tells the browser to optimize rendering.',
                        fix: this.getWillChangeFix(issue),
                        file: issue.element === 'body' ? 'src/core/marble.css' : 'src/core/global.css',
                        estimatedImprovement: '5-10 FPS improvement'
                    };
                    break;

                case 'missing_will_change':
                    recommendation = {
                        id: 'css-missing-will-change',
                        title: 'Add will-change Property',
                        severity: issue.severity,
                        impact: 'low',
                        category: 'CSS',
                        description: issue.message,
                        why: 'will-change hints help the browser optimize rendering by preparing layers in advance.',
                        fix: this.getWillChangeFix(issue),
                        file: 'src/core/marble.css',
                        estimatedImprovement: '3-5 FPS improvement'
                    };
                    break;

                case 'missing_contain':
                    recommendation = {
                        id: 'css-missing-contain',
                        title: 'Add contain Property for Isolation',
                        severity: issue.severity,
                        impact: 'low',
                        category: 'CSS',
                        description: issue.message,
                        why: 'The contain property isolates rendering, preventing changes in one element from affecting others.',
                        fix: this.getContainFix(issue),
                        file: 'src/core/marble.css',
                        estimatedImprovement: '2-5 FPS improvement'
                    };
                    break;
            }

            if (recommendation) {
                this.recommendations.push(recommendation);
            }
        });
    }

    /**
     * Add recommendations from rendering issues
     */
    addRenderingRecommendations(renderingIssues) {
        renderingIssues.forEach(issue => {
            let recommendation = null;

            switch (issue.type) {
                case 'large_dom':
                    recommendation = {
                        id: 'rendering-large-dom',
                        title: 'Large DOM Structure',
                        severity: issue.severity,
                        impact: 'medium',
                        category: 'Rendering',
                        description: issue.message,
                        why: 'Large DOM trees slow down layout calculations and repaints during scrolling.',
                        fix: issue.recommendation,
                        estimatedImprovement: 'Varies based on implementation'
                    };
                    break;

                case 'images_without_lazy':
                    recommendation = {
                        id: 'rendering-images-lazy',
                        title: 'Add Lazy Loading to Images',
                        severity: issue.severity,
                        impact: 'low',
                        category: 'Rendering',
                        description: issue.message,
                        why: 'Lazy loading images reduces initial load time and memory usage.',
                        fix: 'Add loading="lazy" attribute to <img> tags below the fold',
                        estimatedImprovement: 'Faster initial load, reduced memory'
                    };
                    break;
            }

            if (recommendation) {
                this.recommendations.push(recommendation);
            }
        });
    }

    /**
     * Add recommendations from resource issues
     */
    addResourceRecommendations(resourceIssues) {
        resourceIssues.forEach(issue => {
            let recommendation = null;

            switch (issue.type) {
                case 'many_stylesheets':
                    recommendation = {
                        id: 'resource-many-stylesheets',
                        title: 'Multiple Stylesheets',
                        severity: issue.severity,
                        impact: 'medium',
                        category: 'Resources',
                        description: issue.message,
                        why: 'Multiple stylesheet requests add network overhead and can delay initial render.',
                        fix: 'Consider combining stylesheets or using CSS @import (though @import has its own trade-offs)',
                        estimatedImprovement: 'Faster initial page load'
                    };
                    break;
            }

            if (recommendation) {
                this.recommendations.push(recommendation);
            }
        });
    }

    /**
     * Add recommendations from scroll performance metrics
     */
    addScrollRecommendations(scrollMetrics) {
        if (!scrollMetrics || !scrollMetrics.isMonitoring) {
            return;
        }

        // Low FPS recommendation
        if (scrollMetrics.currentFPS < 50) {
            this.recommendations.push({
                id: 'scroll-low-fps',
                title: 'Low Scroll Frame Rate',
                severity: 'high',
                impact: 'high',
                category: 'Scrolling',
                description: `Current scroll FPS is ${scrollMetrics.currentFPS} (target: ${scrollMetrics.targetFPS})`,
                why: 'Low frame rate during scrolling makes the page feel sluggish and unresponsive.',
                fix: 'See CSS filter recommendations above - filters are the most common cause of low scroll FPS',
                estimatedImprovement: `${scrollMetrics.targetFPS - scrollMetrics.currentFPS} FPS improvement`
            });
        }

        // Frame drops recommendation
        if (scrollMetrics.frameDrops > 5) {
            this.recommendations.push({
                id: 'scroll-frame-drops',
                title: 'Frame Drops During Scroll',
                severity: 'high',
                impact: 'high',
                category: 'Scrolling',
                description: `${scrollMetrics.frameDrops} frame drops detected in the last 5 seconds`,
                why: 'Frame drops cause visible stuttering during scrolling.',
                fix: 'Optimize CSS filters and transforms, reduce JavaScript work during scroll',
                estimatedImprovement: 'Smoother scrolling experience'
            });
        }

        // Slow scroll handlers
        if (scrollMetrics.avgScrollHandlerTime > 10) {
            this.recommendations.push({
                id: 'scroll-slow-handlers',
                title: 'Slow Scroll Event Handlers',
                severity: scrollMetrics.avgScrollHandlerTime > 30 ? 'high' : 'medium',
                impact: 'medium',
                category: 'JavaScript',
                description: `Scroll handlers are taking ${scrollMetrics.avgScrollHandlerTime.toFixed(2)}ms on average`,
                why: 'Slow scroll handlers block the main thread, causing frame drops.',
                fix: 'Ensure scroll handlers use requestAnimationFrame and avoid synchronous DOM reads/writes',
                file: 'src/core/theme.js',
                estimatedImprovement: '5-15 FPS improvement'
            });
        }

        // Long tasks
        if (scrollMetrics.longTasks > 0) {
            this.recommendations.push({
                id: 'scroll-long-tasks',
                title: 'Long Tasks Blocking Main Thread',
                severity: 'high',
                impact: 'high',
                category: 'JavaScript',
                description: `${scrollMetrics.longTasks} long tasks detected (tasks taking >50ms)`,
                why: 'Long tasks block the main thread, preventing smooth scrolling and interactions.',
                fix: 'Break up long-running operations, use Web Workers for heavy computations, or defer non-critical work',
                estimatedImprovement: 'Significant improvement in responsiveness'
            });
        }
    }

    /**
     * Get filter optimization fix
     */
    getFilterOptimizationFix(issue) {
        return `/* Current: Multiple filters applied */
/* Issue: ${issue.message} */

/* Option 1: Reduce to single filter */
filter: blur(2px); /* Instead of multiple filters */

/* Option 2: Use transform instead of filter where possible */
/* Transforms are GPU-accelerated and faster than filters */
transform: scale(1.05); /* Instead of filter: brightness() */

/* Option 3: Combine filters into one operation */
/* Instead of: filter: blur(2px) invert(1) url('#filter') */
/* Use: A single composite filter or CSS transform */
`;
    }

    /**
     * Get marble background optimization fix
     */
    getMarbleBackgroundFix() {
        return `/* In src/core/marble.css - Optimize body.marble-bg::before */

body.marble-bg::before {
    /* OPTIMIZATION 1: Add will-change hint */
    will-change: transform;
    
    /* OPTIMIZATION 2: Use contain for isolation */
    contain: layout style paint;
    
    /* OPTIMIZATION 3: Consider reducing filter complexity */
    /* If using blur, try reducing blur amount */
    /* filter: blur(1px); instead of blur(3px); */
    
    /* OPTIMIZATION 4: If using SVG filter, consider removing it */
    /* SVG filters are very expensive - only use if absolutely necessary */
    /* Remove: filter: url('#marbleWobble'); if possible */
    
    /* OPTIMIZATION 5: Use transform3d to force GPU acceleration */
    transform: translate3d(0, 0, 0) scale(
        calc(var(--marble-stretch-x, 100) / 100),
        calc(var(--marble-stretch-y, 100) / 100)
    );
}

/* OPTIMIZATION 6: Consider disabling filters on scroll */
/* You could add a class when scrolling and remove filters */
.marble-bg.scrolling::before {
    filter: none; /* Disable filters during scroll */
}
`;
    }

    /**
     * Get will-change fix
     */
    getWillChangeFix(issue) {
        const element = issue.element || 'element';
        return `/* Add to ${element} styles */
${element === 'body' ? 'body.marble-bg::before' : `.${element}::before`} {
    will-change: transform; /* Hint for transform animations */
    /* OR */
    will-change: filter; /* Hint for filter animations */
    /* Use the one that matches your use case */
}`;
    }

    /**
     * Get contain fix
     */
    getContainFix(issue) {
        const element = issue.element || 'element';
        return `/* Add to ${element} styles */
${element === 'body' ? 'body.marble-bg::before' : `.${element}::before`} {
    contain: layout style paint;
    /* This isolates rendering and prevents layout thrashing */
}`;
    }

    /**
     * Get top recommendations
     */
    getTopRecommendations(n = 5) {
        return this.recommendations.slice(0, n);
    }

    /**
     * Get recommendations by category
     */
    getRecommendationsByCategory(category) {
        return this.recommendations.filter(rec => rec.category === category);
    }

    /**
     * Get high priority recommendations
     */
    getHighPriorityRecommendations() {
        return this.recommendations.filter(rec => rec.severity === 'high');
    }
}

// Export singleton instance
export const performanceRecommendations = new PerformanceRecommendations();
export default performanceRecommendations;

