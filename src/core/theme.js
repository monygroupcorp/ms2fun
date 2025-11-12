/**
 * Theme System - Temple of Capital
 * 
 * Manages light/dark theme switching for the launchpad.
 * CULT EXEC styles are completely isolated and unaffected.
 */

class ThemeManager {
    constructor() {
        this.themeKey = 'ms2fun-theme';
        this.currentTheme = this.getStoredTheme() || this.getSystemTheme();
        this.init();
    }

    /**
     * Initialize theme system
     */
    init() {
        // Don't apply theme if we're on CULT EXEC page
        if (document.body.classList.contains('cultexecs-active')) {
            return;
        }

        this.applyTheme(this.currentTheme);
        this.createThemeToggle();
    }

    /**
     * Get stored theme preference from localStorage
     */
    getStoredTheme() {
        try {
            return localStorage.getItem(this.themeKey);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get system theme preference
     */
    getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    /**
     * Apply theme to document
     */
    applyTheme(theme) {
        // Never apply theme to CULT EXEC pages
        if (document.body.classList.contains('cultexecs-active')) {
            return;
        }

        // Validate theme
        if (theme !== 'light' && theme !== 'dark') {
            console.warn('Invalid theme:', theme, '- defaulting to light');
            theme = 'light';
        }

        const html = document.documentElement;
        
        try {
            // Use requestAnimationFrame to ensure smooth transition
            requestAnimationFrame(() => {
                if (theme === 'dark') {
                    html.setAttribute('data-theme', 'dark');
                } else {
                    html.setAttribute('data-theme', 'light');
                }
                
                this.currentTheme = theme;
                this.storeTheme(theme);
                
                // Update toggle icon if it exists
                const toggle = document.getElementById('theme-toggle');
                if (toggle) {
                    this.updateToggleIcon(toggle);
                    toggle.setAttribute('title', `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`);
                }
                
                // Dispatch theme change event
                window.dispatchEvent(new CustomEvent('themechange', { 
                    detail: { theme } 
                }));
            });
        } catch (error) {
            console.error('Error applying theme:', error);
            // Fallback: just set the attribute directly
            html.setAttribute('data-theme', theme);
            this.currentTheme = theme;
            this.storeTheme(theme);
        }
    }

    /**
     * Store theme preference
     */
    storeTheme(theme) {
        try {
            localStorage.setItem(this.themeKey, theme);
        } catch (e) {
            console.warn('Could not store theme preference:', e);
        }
    }

    /**
     * Toggle between light and dark themes
     */
    toggle() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        return newTheme;
    }

    /**
     * Set specific theme
     */
    setTheme(theme) {
        if (theme === 'light' || theme === 'dark') {
            this.applyTheme(theme);
        }
    }

    /**
     * Get current theme
     */
    getTheme() {
        return this.currentTheme;
    }

    /**
     * Create theme toggle button (optional - can be called manually)
     */
    createThemeToggle() {
        // Check if toggle already exists
        if (document.getElementById('theme-toggle')) {
            // If it exists but we're on CULT EXEC, remove it
            if (document.body.classList.contains('cultexecs-active')) {
                const wrapper = document.getElementById('theme-toggle-wrapper');
                if (wrapper) {
                    wrapper.remove();
                }
            }
            return;
        }

        // Only create toggle if not on CULT EXEC page
        if (document.body.classList.contains('cultexecs-active')) {
            return;
        }

        // Create toggle button
        const toggle = document.createElement('button');
        toggle.id = 'theme-toggle';
        toggle.className = 'theme-toggle';
        toggle.setAttribute('aria-label', 'Toggle theme');
        toggle.setAttribute('title', `Switch to ${this.currentTheme === 'light' ? 'dark' : 'light'} mode`);
        toggle.type = 'button'; // Prevent form submission
        
        // Set icon based on current theme
        this.updateToggleIcon(toggle);
        
        // Add click handler with error handling
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            try {
                const newTheme = this.toggle();
                // Icon update is handled in applyTheme now
            } catch (error) {
                console.error('Error toggling theme:', error);
                // Don't break the site if theme toggle fails
            }
        });

        // Add directly to body so it persists across route changes
        // Never add to app-top-container as it gets cleared by routes
        const wrapper = document.createElement('div');
        wrapper.className = 'theme-toggle-wrapper';
        wrapper.id = 'theme-toggle-wrapper'; // Add ID for easy reference
        wrapper.appendChild(toggle);
        document.body.appendChild(wrapper);
        
        // Setup scroll-based visibility
        this.setupScrollVisibility(wrapper);
    }
    
    /**
     * Setup scroll-based visibility for theme toggle
     * Shows at top of page, hides when scrolling down or after 1 second at top
     * Only reappears when scrolling UP, not when scrolling down
     */
    setupScrollVisibility(wrapper) {
        if (!wrapper) return;
        
        // Threshold for showing/hiding (show when within 50px of top)
        const SCROLL_THRESHOLD = 50;
        // Time to wait at top before auto-hiding (1 second)
        const AUTO_HIDE_DELAY = 1000;
        let isVisible = true;
        let ticking = false;
        let autoHideTimeout = null;
        let lastScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        let isScrollingDown = false;
        
        const showToggle = () => {
            const wasVisible = isVisible;
            
            if (!isVisible) {
                isVisible = true;
                wrapper.classList.remove('theme-toggle-hidden');
                wrapper.classList.add('theme-toggle-visible');
            }
            
            // Set auto-hide timer when at top
            // Only set if we just became visible OR if timer isn't already set
            const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
            if (scrollY < SCROLL_THRESHOLD) {
                // Clear any existing timer
                if (autoHideTimeout) {
                    clearTimeout(autoHideTimeout);
                }
                // Set new timer - either because we just showed, or to reset existing timer
                autoHideTimeout = setTimeout(() => {
                    hideToggle();
                }, AUTO_HIDE_DELAY);
            }
        };
        
        const hideToggle = () => {
            if (isVisible) {
                isVisible = false;
                // Force a reflow to ensure transition triggers
                void wrapper.offsetHeight;
                wrapper.classList.remove('theme-toggle-visible');
                wrapper.classList.add('theme-toggle-hidden');
            }
            // Clear any pending auto-hide
            if (autoHideTimeout) {
                clearTimeout(autoHideTimeout);
                autoHideTimeout = null;
            }
        };
        
        const updateVisibility = () => {
            const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
            const scrollDelta = scrollY - lastScrollY;
            
            // Determine scroll direction
            if (scrollDelta > 0) {
                // Scrolling down
                isScrollingDown = true;
                // Hide immediately when scrolling down
                hideToggle();
            } else if (scrollDelta < 0) {
                // Scrolling up
                isScrollingDown = false;
                // Only show if at top and scrolling up
                if (scrollY < SCROLL_THRESHOLD) {
                    showToggle();
                } else {
                    hideToggle();
                }
            } else {
                // No scroll movement (at rest)
                // Only show if at top and not scrolling down
                if (scrollY < SCROLL_THRESHOLD && !isScrollingDown) {
                    showToggle();
                } else {
                    hideToggle();
                }
            }
            
            lastScrollY = scrollY;
            ticking = false;
        };
        
        const handleScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(updateVisibility);
                ticking = true;
            }
        };
        
        // Initial state - show if at top, then auto-hide after delay
        const initialScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        if (initialScrollY < SCROLL_THRESHOLD) {
            wrapper.classList.add('theme-toggle-visible');
            // Set auto-hide timer for initial state
            autoHideTimeout = setTimeout(() => {
                hideToggle();
            }, AUTO_HIDE_DELAY);
        } else {
            wrapper.classList.add('theme-toggle-hidden');
            isVisible = false;
        }
        
        // Listen for scroll events
        window.addEventListener('scroll', handleScroll, { passive: true });
        
        // Check initial scroll position
        updateVisibility();
        
        // Store cleanup function
        this._scrollCleanup = () => {
            window.removeEventListener('scroll', handleScroll, { passive: true });
            if (autoHideTimeout) {
                clearTimeout(autoHideTimeout);
                autoHideTimeout = null;
            }
        };
    }
    
    /**
     * Ensure toggle persists after route changes
     * Call this after route navigation if needed
     */
    ensureToggleExists() {
        // If on CULT EXEC page, remove toggle if it exists
        if (document.body.classList.contains('cultexecs-active')) {
            const wrapper = document.getElementById('theme-toggle-wrapper');
            if (wrapper) {
                wrapper.remove();
            }
            return;
        }
        
        // Otherwise, ensure toggle exists and is properly attached
        const toggle = document.getElementById('theme-toggle');
        const wrapper = document.getElementById('theme-toggle-wrapper');
        
        // If toggle doesn't exist, create it
        if (!toggle) {
            this.createThemeToggle();
        } 
        // If toggle exists but wrapper is missing or not in body, recreate
        else if (!wrapper || !document.body.contains(wrapper)) {
            // Remove orphaned toggle
            if (toggle.parentNode) {
                toggle.parentNode.removeChild(toggle);
            }
            // Recreate
            this.createThemeToggle();
        }
        // If wrapper exists but toggle is missing, recreate toggle
        else if (wrapper && !wrapper.contains(toggle)) {
            this.createThemeToggle();
        }
        // If wrapper exists but scroll visibility isn't set up, set it up
        else if (wrapper && !wrapper.classList.contains('theme-toggle-visible') && !wrapper.classList.contains('theme-toggle-hidden')) {
            this.setupScrollVisibility(wrapper);
        }
    }

    /**
     * Update toggle button icon
     */
    updateToggleIcon(button) {
        const isDark = this.currentTheme === 'dark';
        
        // Use SVG icons for sun/moon
        if (isDark) {
            // Moon icon (dark mode active, show sun to switch to light)
            button.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
            `;
        } else {
            // Sun icon (light mode active, show moon to switch to dark)
            button.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
            `;
        }
    }

    /**
     * Listen for system theme changes
     */
    watchSystemTheme() {
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            // Only watch if user hasn't manually set a preference
            if (!this.getStoredTheme()) {
                mediaQuery.addEventListener('change', (e) => {
                    const newTheme = e.matches ? 'dark' : 'light';
                    this.applyTheme(newTheme);
                    const toggle = document.getElementById('theme-toggle');
                    if (toggle) {
                        this.updateToggleIcon(toggle);
                    }
                });
            }
        }
    }
}

// Initialize theme manager
let themeManager;

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        themeManager = new ThemeManager();
        themeManager.watchSystemTheme();
        
        // Re-ensure toggle exists after a short delay to catch route changes
        setTimeout(() => {
            if (themeManager) {
                themeManager.ensureToggleExists();
            }
        }, 500);
    });
} else {
    themeManager = new ThemeManager();
    themeManager.watchSystemTheme();
    
    // Re-ensure toggle exists after a short delay
    setTimeout(() => {
        if (themeManager) {
            themeManager.ensureToggleExists();
        }
    }, 500);
}

// Watch for route changes and re-ensure toggle exists
// This handles cases where routes clear containers
if (window.addEventListener) {
    // Listen for any mutations that might remove the toggle
    const observer = new MutationObserver(() => {
        if (themeManager) {
            // If CULT EXEC page is active, ensure toggle is removed
            if (document.body.classList.contains('cultexecs-active')) {
                const wrapper = document.getElementById('theme-toggle-wrapper');
                if (wrapper) {
                    wrapper.remove();
                }
            } else {
                // On launchpad pages, ensure toggle exists and is attached to body
                const wrapper = document.getElementById('theme-toggle-wrapper');
                const toggle = document.getElementById('theme-toggle');
                
                // If wrapper doesn't exist or isn't in body, recreate
                if (!wrapper || !document.body.contains(wrapper)) {
                    // Debounce to avoid excessive recreation
                    clearTimeout(themeManager._recreateTimeout);
                    themeManager._recreateTimeout = setTimeout(() => {
                        themeManager.ensureToggleExists();
                    }, 100);
                }
                // If toggle is missing, recreate
                else if (!toggle) {
                    clearTimeout(themeManager._recreateTimeout);
                    themeManager._recreateTimeout = setTimeout(() => {
                    themeManager.ensureToggleExists();
                    }, 100);
                }
            }
        }
    });
    
    // Start observing when DOM is ready
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: false // Only watch direct children, not deep subtree
        });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, {
                childList: true,
                subtree: false
            });
        });
    }
}

// Export for use in other modules (if using ES6 modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ThemeManager, themeManager };
}

// Make available globally for easy access
window.ThemeManager = ThemeManager;
window.themeManager = themeManager;

