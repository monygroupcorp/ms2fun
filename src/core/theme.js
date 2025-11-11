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
        
        // Otherwise, create toggle if it doesn't exist
        if (!document.getElementById('theme-toggle')) {
            this.createThemeToggle();
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
                // On launchpad pages, ensure toggle exists
                const toggle = document.getElementById('theme-toggle');
                if (!toggle && document.getElementById('theme-toggle-wrapper')) {
                    // Wrapper exists but toggle is missing, recreate it
                    themeManager.ensureToggleExists();
                }
            }
        }
    });
    
    // Start observing when DOM is ready
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, {
                childList: true,
                subtree: true
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

