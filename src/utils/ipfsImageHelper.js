/**
 * IPFS Image Helper
 * 
 * Helper functions for rendering IPFS-aware images in string-based HTML rendering.
 * Works with the Component system's string-based render methods.
 */

import { isIpfsUri, resolveIpfsToHttp } from '../services/IpfsService.js';

/**
 * Render HTML for an IPFS-aware image
 * This creates an img tag with data attributes for IPFS support
 * The image will automatically try gateways on error via JavaScript
 * 
 * @param {string} src - Image URL (HTTP or IPFS)
 * @param {string} alt - Alt text
 * @param {string} className - CSS classes
 * @param {object} options - Additional options (loading, style, etc.)
 * @returns {string} HTML string for the image
 */
export function renderIpfsImage(src, alt = '', className = '', options = {}) {
    if (!src) {
        return '<div class="ipfs-image-empty"></div>';
    }
    
    const {
        loading = 'lazy',
        style = {},
        id = null,
        dataAttributes = {}
    } = options;
    
    // Escape HTML
    const escapeHtml = (text) => {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    const escapedSrc = escapeHtml(src);
    const escapedAlt = escapeHtml(alt);
    const escapedClass = escapeHtml(className);
    
    // Build style string
    const styleStr = Object.entries(style)
        .map(([key, value]) => {
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}: ${value};`;
        })
        .join(' ');
    
    // Build data attributes
    const dataAttrs = Object.entries(dataAttributes)
        .map(([key, value]) => `data-${key}="${escapeHtml(String(value))}"`)
        .join(' ');
    
    // If IPFS, add data attribute and use first gateway
    const isIpfs = isIpfsUri(src);
    const initialUrl = isIpfs ? resolveIpfsToHttp(src, 0) : src;
    
    const idAttr = id ? `id="${escapeHtml(id)}"` : '';
    const ipfsDataAttr = isIpfs ? `data-ipfs-uri="${escapeHtml(src)}"` : '';
    const ipfsClass = isIpfs ? 'ipfs-image' : '';
    
    return `
        <img 
            ${idAttr}
            src="${escapeHtml(initialUrl || '')}" 
            alt="${escapedAlt}" 
            class="${escapedClass} ${ipfsClass}"
            loading="${loading}"
            ${ipfsDataAttr}
            ${dataAttrs}
            ${styleStr ? `style="${styleStr}"` : ''}
        />
    `.trim();
}

/**
 * Enhance an image element with IPFS gateway rotation
 * Call this after mounting to add IPFS support to existing img elements
 * 
 * @param {HTMLImageElement} imgElement - Image element to enhance
 */
export function enhanceImageWithIpfs(imgElement) {
    if (!imgElement || !(imgElement instanceof HTMLImageElement)) {
        return;
    }
    
    const ipfsUri = imgElement.getAttribute('data-ipfs-uri');
    if (!ipfsUri) {
        return; // Not an IPFS image
    }
    
    import('../services/IpfsService.js').then(({ resolveIpfsToHttp, getAvailableGateways }) => {
        let gatewayIndex = 0;
        const gateways = getAvailableGateways();
        
        const tryNextGateway = () => {
            if (gatewayIndex >= gateways.length - 1) {
                // All gateways failed - show error
                imgElement.classList.add('ipfs-image-error');
                imgElement.alt = imgElement.alt || 'IPFS image unavailable';
                console.error('[ipfsImageHelper] Failed to load IPFS image after trying all gateways:', ipfsUri);
                return;
            }
            
            gatewayIndex++;
            const nextUrl = resolveIpfsToHttp(ipfsUri, gatewayIndex);
            if (nextUrl) {
                imgElement.src = nextUrl;
            }
        };
        
        // Remove existing error handler if any
        imgElement.removeEventListener('error', tryNextGateway);
        
        // Add error handler for gateway rotation
        imgElement.addEventListener('error', tryNextGateway);
        
        // Add loading class
        imgElement.classList.add('ipfs-image-loading');
        
        // Remove loading class on success
        imgElement.addEventListener('load', () => {
            imgElement.classList.remove('ipfs-image-loading');
            imgElement.classList.add('ipfs-image-loaded');
        }, { once: true });
    });
}

/**
 * Enhance all IPFS images in a container
 * Useful for bulk enhancement after rendering
 * 
 * @param {HTMLElement} container - Container element
 */
export function enhanceAllIpfsImages(container) {
    if (!container) return;
    
    const ipfsImages = container.querySelectorAll('img[data-ipfs-uri]');
    ipfsImages.forEach(enhanceImageWithIpfs);
}

