/**
 * Marble Texture Configuration System
 * Assigns unique distortion configurations to each marble-bg element
 */

/**
 * Generate a random marble configuration
 * @returns {Object} Configuration object with stretch values and position
 */
function generateMarbleConfig() {
    // Random stretch values for retro N64 distortion effect
    // Ensure minimum 100% to always cover the full area
    // X stretch: 100-200% (horizontal distortion, always covers)
    // Y stretch: 100-150% (vertical distortion, always covers)
    const stretchX = Math.floor(Math.random() * 100) + 100; // 100-200 (always >= 100%)
    const stretchY = Math.floor(Math.random() * 50) + 100;  // 100-150 (always >= 100%)
    
    // Random position offset to avoid visible seams
    const positions = ['a', 'b', 'c', 'd'];
    const position = positions[Math.floor(Math.random() * positions.length)];
    
    return {
        stretchX,
        stretchY,
        position
    };
}

/**
 * Calculate blur amount based on stretch values
 * Applies soft blur when stretched beyond threshold to smooth out artifacts
 * Background element (107% X, 103% Y) should get ~1px blur
 * @param {number} stretchX - Horizontal stretch percentage
 * @param {number} stretchY - Vertical stretch percentage
 * @returns {Object} Object with blur amount and whether to use smooth rendering
 */
function calculateBlur(stretchX, stretchY) {
    // Very low thresholds: start applying blur at minimal stretch
    // This ensures even the background (107% X, 103% Y) gets blur
    const thresholdX = 105; // 105% horizontal stretch
    const thresholdY = 105; // 105% vertical stretch
    
    // Calculate how much beyond threshold
    const excessX = Math.max(0, stretchX - thresholdX);
    const excessY = Math.max(0, stretchY - thresholdY);
    
    // Use average excess for more balanced blur calculation
    const avgExcess = (excessX + excessY) / 2;
    const maxExcess = Math.max(excessX, excessY);
    
    // If no excess, no blur
    if (maxExcess <= 0) {
        return { blur: 0, smoothRendering: false };
    }
    
    // Blur formula: 1px per 1% average excess, capped at 1px
    // This ensures background (107% X, 103% Y) gets 1px blur:
    // avgExcess = ((107-105) + (103-105)) / 2 = (2 + 0) / 2 = 1%
    // blur = 1 * 1.0 = 1px (capped at 1px max)
    const blurAmount = Math.min(1, avgExcess * 1.0);
    
    // Use smooth rendering when blur is applied (>= 0.5px for subtle smoothing)
    const smoothRendering = blurAmount >= 0.5;
    
    return { blur: blurAmount, smoothRendering };
}

/**
 * Apply unique marble configuration to an element
 * @param {HTMLElement} element - Element with marble-bg class
 */
function applyMarbleConfig(element) {
    if (!element || !element.classList.contains('marble-bg')) {
        return;
    }
    
    // Skip if already configured (to maintain consistency)
    if (element.dataset.marbleConfigured === 'true') {
        return;
    }
    
    // Generate unique config for this element
    const config = generateMarbleConfig();
    
    // Calculate blur based on stretch values
    const blurResult = calculateBlur(config.stretchX, config.stretchY);
    
    // Apply via CSS custom properties
    element.style.setProperty('--marble-stretch-x', config.stretchX);
    element.style.setProperty('--marble-stretch-y', config.stretchY);
    element.style.setProperty('--marble-blur', `${blurResult.blur}px`);
    
    // Add class to switch to smooth rendering when blur is applied
    if (blurResult.smoothRendering) {
        element.classList.add('marble-smooth-render');
    }
    
    // Remove any existing position classes
    element.classList.remove('marble-pos-a', 'marble-pos-b', 'marble-pos-c', 'marble-pos-d');
    // Add the random position class
    element.classList.add(`marble-pos-${config.position}`);
    
    // Mark as configured to prevent re-configuration
    element.dataset.marbleConfigured = 'true';
    element.dataset.marbleConfig = JSON.stringify(config);
}

/**
 * Initialize marble configurations for all marble-bg elements
 * Call this after DOM updates
 */
function initializeMarbleConfigs() {
    const marbleElements = document.querySelectorAll('.marble-bg');
    marbleElements.forEach(applyMarbleConfig);
}

/**
 * Watch for new marble-bg elements and apply configs
 */
function watchForMarbleElements() {
    // Use MutationObserver to catch dynamically added elements
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    // Check if the added node itself is a marble-bg
                    if (node.classList && node.classList.contains('marble-bg')) {
                        // Skip if already configured (prevents re-configuration on hover/state changes)
                        if (node.dataset.marbleConfigured !== 'true') {
                            applyMarbleConfig(node);
                        }
                    }
                    // Check for marble-bg children
                    const marbleChildren = node.querySelectorAll && node.querySelectorAll('.marble-bg');
                    if (marbleChildren) {
                        marbleChildren.forEach((child) => {
                            // Skip if already configured
                            if (child.dataset.marbleConfigured !== 'true') {
                                applyMarbleConfig(child);
                            }
                        });
                    }
                }
            });
        });
    });
    
    // Start observing
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeMarbleConfigs();
        watchForMarbleElements();
    });
} else {
    initializeMarbleConfigs();
    watchForMarbleElements();
}

// Also initialize after a short delay to catch elements added by frameworks
setTimeout(() => {
    initializeMarbleConfigs();
}, 500);

// Export for manual use if needed
if (typeof window !== 'undefined') {
    window.marbleConfig = {
        initialize: initializeMarbleConfigs,
        apply: applyMarbleConfig,
        generate: generateMarbleConfig
    };
}

