/**
 * PerformanceAnalyzer
 * 
 * Core analysis engine that automatically identifies performance bottlenecks
 * and expensive operations. Analyzes CSS, JavaScript, and rendering performance.
 */

class PerformanceAnalyzer {
    constructor() {
        this.analysisResults = {
            cssIssues: [],
            jsIssues: [],
            renderingIssues: [],
            resourceIssues: [],
            scrollIssues: []
        };

        // Bind methods
        this.analyze = this.analyze.bind(this);
        this.analyzeCSS = this.analyzeCSS.bind(this);
        this.analyzeJavaScript = this.analyzeJavaScript.bind(this);
        this.analyzeRendering = this.analyzeRendering.bind(this);
        this.analyzeResources = this.analyzeResources.bind(this);
    }

    /**
     * Run complete performance analysis
     */
    async analyze() {
        this.analysisResults = {
            cssIssues: [],
            jsIssues: [],
            renderingIssues: [],
            resourceIssues: [],
            scrollIssues: []
        };

        // Run all analyses in parallel
        await Promise.all([
            this.analyzeCSS(),
            this.analyzeJavaScript(),
            this.analyzeRendering(),
            this.analyzeResources()
        ]);

        return this.analysisResults;
    }

    /**
     * Analyze CSS for performance issues
     */
    async analyzeCSS() {
        const issues = [];

        // Check for expensive CSS properties on frequently repainted elements
        const allElements = document.querySelectorAll('*');
        const bodyElement = document.body;
        const htmlElement = document.documentElement;

        // Check body and html for expensive properties
        const checkElement = (element, name) => {
            const styles = window.getComputedStyle(element);
            const pseudoBefore = window.getComputedStyle(element, '::before');
            const pseudoAfter = window.getComputedStyle(element, '::after');

            // Check for expensive filters
            const filter = styles.filter || pseudoBefore.filter || pseudoAfter.filter;
            if (filter && filter !== 'none') {
                const filterCount = (filter.match(/blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia|url/g) || []).length;
                if (filterCount > 2) {
                    issues.push({
                        type: 'multiple_filters',
                        severity: 'high',
                        element: name,
                        message: `${name} has ${filterCount} CSS filters applied, which is expensive during scroll`,
                        filters: filter,
                        recommendation: 'Consider reducing the number of filters or using a single composite filter'
                    });
                }
            }

            // Check for transform on fixed elements
            const position = styles.position;
            const transform = styles.transform;
            if (position === 'fixed' && transform && transform !== 'none') {
                issues.push({
                    type: 'fixed_with_transform',
                    severity: 'medium',
                    element: name,
                    message: `${name} uses fixed positioning with transforms, which can cause repaints`,
                    recommendation: 'Consider using will-change: transform or contain: layout style paint'
                });
            }

            // Check for will-change usage
            const willChange = styles.willChange;
            if (willChange && willChange !== 'auto') {
                // Good - will-change is being used
            } else if ((filter && filter !== 'none') || (transform && transform !== 'none')) {
                // Missing will-change hint
                issues.push({
                    type: 'missing_will_change',
                    severity: 'low',
                    element: name,
                    message: `${name} uses transforms/filters but doesn't use will-change hint`,
                    recommendation: 'Add will-change: transform or will-change: filter to optimize rendering'
                });
            }

            // Check for contain property
            const contain = styles.contain;
            if (!contain || contain === 'none') {
                // Check if element could benefit from contain
                if (position === 'fixed' || position === 'absolute') {
                    issues.push({
                        type: 'missing_contain',
                        severity: 'low',
                        element: name,
                        message: `${name} could benefit from contain: layout style paint`,
                        recommendation: 'Add contain: layout style paint to isolate rendering'
                    });
                }
            }
        };

        checkElement(bodyElement, 'body');
        checkElement(htmlElement, 'html');

        // Check for marble background specifically
        const marbleElements = document.querySelectorAll('.marble-bg');
        marbleElements.forEach((el, index) => {
            const styles = window.getComputedStyle(el, '::before');
            const filter = styles.filter;
            const transform = styles.transform;
            
            if (filter && filter !== 'none' && (filter.includes('blur') || filter.includes('url'))) {
                issues.push({
                    type: 'marble_background_filters',
                    severity: 'high',
                    element: `marble-bg element ${index + 1}`,
                    message: 'Marble background uses expensive filters (blur/SVG) that impact scroll performance',
                    recommendation: 'Consider using CSS transforms instead of filters, or reduce filter complexity'
                });
            }
        });

        this.analysisResults.cssIssues = issues;
    }

    /**
     * Analyze JavaScript for performance issues
     */
    async analyzeJavaScript() {
        const issues = [];

        // Check for scroll event listeners
        // Note: We can't directly enumerate event listeners, but we can check for common patterns
        // This is a heuristic check

        // Check for setTimeout/setInterval usage that might affect scroll
        // We'll rely on the scroll monitor for actual scroll handler performance

        // Check for synchronous DOM operations
        // This would require runtime monitoring, which is handled by ScrollPerformanceMonitor

        // Check for missing passive event listeners (heuristic)
        // We can't detect this directly, but we can recommend it

        this.analysisResults.jsIssues = issues;
    }

    /**
     * Analyze rendering performance
     */
    async analyzeRendering() {
        const issues = [];

        // Check for forced synchronous layouts
        // This requires runtime monitoring, handled by ScrollPerformanceMonitor

        // Check for large DOM
        const domSize = document.querySelectorAll('*').length;
        if (domSize > 1000) {
            issues.push({
                type: 'large_dom',
                severity: 'medium',
                message: `DOM contains ${domSize} elements, which can slow down rendering`,
                count: domSize,
                recommendation: 'Consider lazy loading or virtualizing long lists'
            });
        }

        // Check for images without lazy loading
        const images = document.querySelectorAll('img');
        const imagesWithoutLazy = Array.from(images).filter(img => !img.loading || img.loading === 'eager');
        if (imagesWithoutLazy.length > 5) {
            issues.push({
                type: 'images_without_lazy',
                severity: 'low',
                message: `${imagesWithoutLazy.length} images don't use lazy loading`,
                count: imagesWithoutLazy.length,
                recommendation: 'Add loading="lazy" to images below the fold'
            });
        }

        this.analysisResults.renderingIssues = issues;
    }

    /**
     * Analyze resource loading
     */
    async analyzeResources() {
        const issues = [];

        // Check stylesheet count
        const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
        if (stylesheets.length > 5) {
            issues.push({
                type: 'many_stylesheets',
                severity: 'medium',
                message: `${stylesheets.length} stylesheets are loaded, which can slow initial render`,
                count: stylesheets.length,
                recommendation: 'Consider combining stylesheets or using CSS imports'
            });
        }

        // Check for external scripts
        const externalScripts = Array.from(document.querySelectorAll('script[src]'))
            .filter(script => {
                const src = script.src;
                return src && !src.startsWith(window.location.origin);
            });

        if (externalScripts.length > 0) {
            issues.push({
                type: 'external_scripts',
                severity: 'low',
                message: `${externalScripts.length} external scripts loaded`,
                count: externalScripts.length,
                recommendation: 'Consider using async/defer attributes or bundling scripts'
            });
        }

        // Check for large resources
        if ('PerformanceObserver' in window) {
            try {
                const resourceObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.transferSize > 500000) { // 500KB
                            issues.push({
                                type: 'large_resource',
                                severity: 'medium',
                                message: `Large resource loaded: ${entry.name} (${(entry.transferSize / 1024).toFixed(2)}KB)`,
                                resource: entry.name,
                                size: entry.transferSize,
                                recommendation: 'Consider compressing or splitting large resources'
                            });
                        }
                    }
                });
                resourceObserver.observe({ entryTypes: ['resource'] });
            } catch (e) {
                // Resource observer not supported
            }
        }

        this.analysisResults.resourceIssues = issues;
    }

    /**
     * Get all issues sorted by severity
     */
    getIssuesBySeverity() {
        const allIssues = [
            ...this.analysisResults.cssIssues,
            ...this.analysisResults.jsIssues,
            ...this.analysisResults.renderingIssues,
            ...this.analysisResults.resourceIssues,
            ...this.analysisResults.scrollIssues
        ];

        const severityOrder = { high: 0, medium: 1, low: 2 };
        return allIssues.sort((a, b) => {
            return severityOrder[a.severity] - severityOrder[b.severity];
        });
    }

    /**
     * Get top N issues
     */
    getTopIssues(n = 5) {
        return this.getIssuesBySeverity().slice(0, n);
    }
}

// Export singleton instance
export const performanceAnalyzer = new PerformanceAnalyzer();
export default performanceAnalyzer;

