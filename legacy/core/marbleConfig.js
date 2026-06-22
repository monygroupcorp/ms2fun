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
 * Optimized: Increased threshold and reduced blur cap for better scroll performance
 * @param {number} stretchX - Horizontal stretch percentage
 * @param {number} stretchY - Vertical stretch percentage
 * @returns {Object} Object with blur amount and whether to use smooth rendering
 */
function calculateBlur(stretchX, stretchY) {
    // Increased thresholds: only apply blur when significantly stretched
    // This reduces the number of elements that get blur filters
    const thresholdX = 110; // 110% horizontal stretch (was 105)
    const thresholdY = 110; // 110% vertical stretch (was 105)
    
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
    
    // Blur formula: 0.3px per 1% average excess, capped at 0.5px
    // Further reduced blur amounts for better performance
    // Only elements stretched beyond 110% will get blur
    const blurAmount = Math.min(0.5, avgExcess * 0.3);
    
    // Use smooth rendering when blur is applied (>= 0.25px for subtle smoothing)
    const smoothRendering = blurAmount >= 0.25;
    
    return { blur: blurAmount, smoothRendering };
}

/**
 * Get the appropriate marble image URL based on theme and blur amount
 * Uses pre-blurred images to eliminate CSS blur filters for better performance
 * @param {number} blurAmount - Blur amount in pixels (0, 0.5, etc.)
 * @param {boolean} isDarkMode - Whether dark mode is active
 * @returns {string} URL to the appropriate marble image
 */
function getMarbleImageUrl(blurAmount, isDarkMode) {
    // If blur is needed, use pre-blurred variant
    if (blurAmount > 0) {
        // Round to nearest 0.5px for variant matching
        const blurRounded = Math.round(blurAmount * 2) / 2;
        if (blurRounded === 0.5) {
            return isDarkMode 
                ? 'url(/public/marbsoft-dark-blur-0.5px.png)'
                : 'url(/public/marbsoft-blur-0.5px.png)';
        }
        // For other blur amounts, fallback to CSS blur (future: generate more variants)
        // For now, return base image and CSS will handle blur
        return isDarkMode
            ? 'url(/public/marbsoft-dark.png)'
            : 'url(/public/marbsoft.png)';
    }
    
    // No blur needed, use base images
    return isDarkMode
        ? 'url(/public/marbsoft-dark.png)'
        : 'url(/public/marbsoft.png)';
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
    
    // Detect theme
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Get appropriate image URL (pre-blurred if needed)
    const imageUrl = getMarbleImageUrl(blurResult.blur, isDarkMode);
    
    // Apply via CSS custom properties
    element.style.setProperty('--marble-stretch-x', config.stretchX);
    element.style.setProperty('--marble-stretch-y', config.stretchY);
    element.style.setProperty('--marble-image-url', imageUrl);
    
    // Set data-blur attribute for CSS selection (if needed for future variants)
    if (blurResult.blur > 0) {
        element.setAttribute('data-blur', blurResult.blur.toString());
        // Fallback CSS blur if pre-blurred image doesn't exist
        element.style.setProperty('--marble-blur-fallback', `blur(${blurResult.blur}px)`);
    } else {
        element.removeAttribute('data-blur');
        element.style.setProperty('--marble-blur-fallback', 'none');
    }
    
    // Keep --marble-blur for compatibility (though CSS won't use it if pre-blurred image exists)
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

/**
 * Check if dark marble image exists and setup fallback if needed
 * If marbsoft-dark.png doesn't exist, fallback to using invert filter
 */
function setupDarkMarbleFallback() {
    const img = new Image();
    img.onload = () => {
        // Image exists, remove fallback class if it was added
        document.documentElement.classList.remove('marble-dark-fallback');
    };
    img.onerror = () => {
        // Image doesn't exist, add fallback class to use invert filter
        document.documentElement.classList.add('marble-dark-fallback');
    };
    // Try to load the dark marble image
    img.src = '/public/marbsoft-dark.png';
}

/**
 * Scroll detection for filter optimization
 * Toggles .scrolling class on all .marble-bg elements to disable filters during scroll
 * This eliminates expensive filter recalculations on every scroll frame
 */
function setupScrollDetection() {
    let scrollTimeout = null;
    let isScrolling = false;
    const SCROLL_STOP_DELAY = 150; // ms delay before re-enabling filters
    
    const toggleScrollingClass = (add) => {
        // Apply to all marble-bg elements (including body)
        const marbleElements = document.querySelectorAll('.marble-bg');
        marbleElements.forEach((el) => {
            if (add) {
                el.classList.add('scrolling');
            } else {
                el.classList.remove('scrolling');
            }
        });
    };
    
    const handleScroll = () => {
        // Add scrolling class if not already scrolling
        if (!isScrolling) {
            isScrolling = true;
            toggleScrollingClass(true);
        }
        
        // Clear existing timeout
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        
        // Remove scrolling class after scroll stops
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
            toggleScrollingClass(false);
            scrollTimeout = null;
        }, SCROLL_STOP_DELAY);
    };
    
    // Use passive listener for better scroll performance
    window.addEventListener('scroll', handleScroll, { passive: true });
}

/**
 * Update marble image URLs when theme changes
 * Re-applies configurations to update image URLs for new theme
 */
function updateMarbleImagesForTheme() {
    const marbleElements = document.querySelectorAll('.marble-bg[data-marble-configured="true"]');
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
    
    marbleElements.forEach((element) => {
        // Get existing blur amount from stored config or CSS variable
        const storedConfig = element.dataset.marbleConfig;
        let blurAmount = 0;
        
        if (storedConfig) {
            try {
                const config = JSON.parse(storedConfig);
                const blurResult = calculateBlur(config.stretchX, config.stretchY);
                blurAmount = blurResult.blur;
            } catch (e) {
                // Fallback: read from CSS variable
                const blurValue = getComputedStyle(element).getPropertyValue('--marble-blur');
                blurAmount = parseFloat(blurValue) || 0;
            }
        }
        
        // Update image URL for new theme
        const imageUrl = getMarbleImageUrl(blurAmount, isDarkMode);
        element.style.setProperty('--marble-image-url', imageUrl);
    });
}

// Export for manual use if needed
if (typeof window !== 'undefined') {
    window.marbleConfig = {
        initialize: initializeMarbleConfigs,
        apply: applyMarbleConfig,
        generate: generateMarbleConfig,
        updateForTheme: updateMarbleImagesForTheme
    };
    
    // Setup scroll detection and theme change listener when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setupScrollDetection();
            setupDarkMarbleFallback();
            
            // Listen for theme changes
            window.addEventListener('themechange', updateMarbleImagesForTheme);
        });
    } else {
        setupScrollDetection();
        setupDarkMarbleFallback();
        
        // Listen for theme changes
        window.addEventListener('themechange', updateMarbleImagesForTheme);
    }
}

