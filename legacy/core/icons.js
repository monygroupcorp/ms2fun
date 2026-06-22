/**
 * Engraved SVG Icons System
 * Simple, elegant icons that match the engraved marble aesthetic
 */

export const Icons = {
    /**
     * Copy icon - simple lines representing copy/duplicate
     */
    copy: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="5" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <rect x="2" y="2" width="9" height="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`,

    /**
     * Etherscan/Blockchain icon - chain links
     */
    etherscan: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="4" cy="4" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <line x1="6" y1="4" x2="10" y2="4" stroke="currentColor" stroke-width="1.5"/>
        <line x1="4" y1="6" x2="4" y2="10" stroke="currentColor" stroke-width="1.5"/>
        <line x1="12" y1="6" x2="12" y2="10" stroke="currentColor" stroke-width="1.5"/>
        <line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.5"/>
    </svg>`,

    /**
     * GitHub icon - simple code brackets
     */
    github: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 4 L2 8 L6 12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 4 L14 8 L10 12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    /**
     * Website/Globe icon - simple globe
     */
    website: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8 2 A6 6 0 0 1 8 14" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M8 2 A6 6 0 0 0 8 14" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`,

    /**
     * Twitter icon - simple X/Twitter symbol
     */
    twitter: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    /**
     * Creator/User icon - simple person silhouette
     */
    creator: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M4 13 C4 10 5.5 8 8 8 C10.5 8 12 10 12 13" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>`,

    /**
     * Audited/Verified icon - checkmark in circle
     */
    audited: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <path d="M5 8 L7 10 L11 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
};

/**
 * Get icon SVG by name
 * @param {string} name - Icon name
 * @returns {string} SVG markup
 */
export function getIcon(name) {
    return Icons[name] || '';
}

/**
 * Render icon with optional class
 * @param {string} name - Icon name
 * @param {string} className - Optional CSS class
 * @returns {string} SVG markup with class
 */
export function renderIcon(name, className = '') {
    const svg = getIcon(name);
    if (!svg) return '';
    if (className) {
        return svg.replace('<svg', `<svg class="${className}"`);
    }
    return svg;
}

