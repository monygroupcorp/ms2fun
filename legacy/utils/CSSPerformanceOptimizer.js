/**
 * CSSPerformanceOptimizer
 * 
 * Automatically detects expensive CSS properties and suggests optimizations.
 * Focuses on properties that impact scroll performance.
 */

class CSSPerformanceOptimizer {
    constructor() {
        this.expensiveProperties = [
            'filter',
            'backdrop-filter',
            'box-shadow',
            'border-radius',
            'opacity',
            'transform',
            'clip-path'
        ];

        this.optimizations = [];
    }

    /**
     * Analyze CSS and generate optimization suggestions
     */
    analyze() {
        this.optimizations = [];

        // Analyze body and html elements
        this.analyzeElement(document.body, 'body');
        this.analyzeElement(document.documentElement, 'html');

        // Analyze elements with marble-bg class
        const marbleElements = document.querySelectorAll('.marble-bg');
        marbleElements.forEach((el, index) => {
            this.analyzeElement(el, `.marble-bg[${index}]`);
            this.analyzePseudoElement(el, '::before', `.marble-bg[${index}]::before`);
            this.analyzePseudoElement(el, '::after', `.marble-bg[${index}]::after`);
        });

        return this.optimizations;
    }

    /**
     * Analyze an element for expensive CSS properties
     */
    analyzeElement(element, selector) {
        if (!element) return;

        const styles = window.getComputedStyle(element);
        this.checkExpensiveProperties(styles, selector, 'element');
    }

    /**
     * Analyze a pseudo-element
     */
    analyzePseudoElement(element, pseudo, selector) {
        if (!element) return;

        try {
            const styles = window.getComputedStyle(element, pseudo);
            this.checkExpensiveProperties(styles, selector, 'pseudo-element');
        } catch (e) {
            // Pseudo-element might not exist
        }
    }

    /**
     * Check for expensive properties and suggest optimizations
     */
    checkExpensiveProperties(styles, selector, type) {
        // Check filters
        const filter = styles.filter;
        if (filter && filter !== 'none') {
            const filterComplexity = this.analyzeFilterComplexity(filter);
            if (filterComplexity.isExpensive) {
                this.optimizations.push({
                    selector,
                    type,
                    property: 'filter',
                    currentValue: filter,
                    issue: filterComplexity.issue,
                    severity: filterComplexity.severity,
                    suggestion: this.getFilterSuggestion(filter, filterComplexity)
                });
            }
        }

        // Check backdrop-filter
        const backdropFilter = styles.backdropFilter || styles.webkitBackdropFilter;
        if (backdropFilter && backdropFilter !== 'none') {
            this.optimizations.push({
                selector,
                type,
                property: 'backdrop-filter',
                currentValue: backdropFilter,
                issue: 'Backdrop filters are very expensive, especially during scroll',
                severity: 'high',
                suggestion: 'Consider removing backdrop-filter or using a simpler alternative'
            });
        }

        // Check transform
        const transform = styles.transform;
        const position = styles.position;
        if (transform && transform !== 'none') {
            if (position === 'fixed' || position === 'absolute') {
                const hasWillChange = styles.willChange && styles.willChange !== 'auto';
                if (!hasWillChange) {
                    this.optimizations.push({
                        selector,
                        type,
                        property: 'will-change',
                        issue: 'Fixed/absolute element with transform missing will-change hint',
                        severity: 'medium',
                        suggestion: 'Add will-change: transform to optimize rendering'
                    });
                }
            }
        }

        // Check for contain property
        const contain = styles.contain;
        if ((position === 'fixed' || position === 'absolute') && (!contain || contain === 'none')) {
            this.optimizations.push({
                selector,
                type,
                property: 'contain',
                issue: 'Fixed/absolute element could benefit from contain property',
                severity: 'low',
                suggestion: 'Add contain: layout style paint to isolate rendering'
            });
        }

        // Check for multiple box-shadows (expensive)
        const boxShadow = styles.boxShadow;
        if (boxShadow && boxShadow !== 'none') {
            const shadowCount = (boxShadow.match(/rgba?\(/g) || []).length;
            if (shadowCount > 2) {
                this.optimizations.push({
                    selector,
                    type,
                    property: 'box-shadow',
                    currentValue: boxShadow,
                    issue: `Multiple box-shadows (${shadowCount}) are expensive`,
                    severity: 'medium',
                    suggestion: 'Reduce to 1-2 box-shadows or use a single composite shadow'
                });
            }
        }
    }

    /**
     * Analyze filter complexity
     */
    analyzeFilterComplexity(filter) {
        const filterString = filter.toLowerCase();

        // Count filter functions
        const filterFunctions = [
            'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale',
            'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia', 'url'
        ];

        let count = 0;
        let hasBlur = false;
        let hasSVG = false;
        let blurAmount = 0;

        filterFunctions.forEach(func => {
            if (filterString.includes(func)) {
                count++;
                if (func === 'blur') {
                    hasBlur = true;
                    // Extract blur amount
                    const blurMatch = filterString.match(/blur\(([^)]+)\)/);
                    if (blurMatch) {
                        blurAmount = parseFloat(blurMatch[1]) || 0;
                    }
                }
                if (func === 'url') {
                    hasSVG = true;
                }
            }
        });

        let severity = 'low';
        let issue = '';

        if (hasSVG) {
            severity = 'high';
            issue = 'SVG filters (url()) are very expensive and should be avoided if possible';
        } else if (hasBlur && blurAmount > 3) {
            severity = 'high';
            issue = `Large blur amount (${blurAmount}px) is expensive during scroll`;
        } else if (count > 2) {
            severity = 'medium';
            issue = `Multiple filters (${count}) can impact scroll performance`;
        } else if (hasBlur) {
            severity = 'medium';
            issue = 'Blur filters are moderately expensive during scroll';
        } else {
            return { isExpensive: false };
        }

        return {
            isExpensive: true,
            severity,
            issue,
            count,
            hasBlur,
            hasSVG,
            blurAmount
        };
    }

    /**
     * Get filter optimization suggestion
     */
    getFilterSuggestion(filter, complexity) {
        if (complexity.hasSVG) {
            return `/* Remove SVG filter if possible - they're very expensive */
/* Current: ${filter} */
/* Suggested: Remove url() filter, use CSS filters only if needed */`;
        }

        if (complexity.hasBlur && complexity.blurAmount > 3) {
            return `/* Reduce blur amount */
/* Current: ${filter} */
/* Suggested: Reduce blur from ${complexity.blurAmount}px to 1-2px */
filter: blur(1px); /* or remove blur entirely */`;
        }

        if (complexity.count > 2) {
            return `/* Reduce number of filters */
/* Current: ${filter} (${complexity.count} filters) */
/* Suggested: Use 1-2 filters maximum, or combine effects */`;
        }

        return `/* Consider optimizing filter */
/* Current: ${filter} */
/* Consider: Remove if not essential, or use transform alternatives */`;
    }

    /**
     * Get all optimizations
     */
    getOptimizations() {
        return this.optimizations;
    }

    /**
     * Get optimizations by severity
     */
    getOptimizationsBySeverity(severity) {
        return this.optimizations.filter(opt => opt.severity === severity);
    }

    /**
     * Get high priority optimizations
     */
    getHighPriorityOptimizations() {
        return this.getOptimizationsBySeverity('high');
    }
}

// Export singleton instance
export const cssPerformanceOptimizer = new CSSPerformanceOptimizer();
export default cssPerformanceOptimizer;

