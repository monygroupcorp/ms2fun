import { Component } from '../../core/Component.js';
import { isIpfsUri, resolveIpfsToHttp, getAvailableGateways } from '../../services/IpfsService.js';

/**
 * IpfsImage Component
 * 
 * Renders images with IPFS support, including gateway rotation on failure.
 * Falls back gracefully if all gateways fail.
 * 
 * Props:
 * - src: Image URL (HTTP or IPFS)
 * - alt: Alt text for image
 * - className: CSS classes
 * - style: Inline styles
 * - loading: Loading attribute ('lazy', 'eager', etc.)
 * - onLoad: Callback when image loads
 * - onError: Callback when image fails
 * - placeholder: Placeholder content while loading (optional)
 * - errorPlaceholder: Error placeholder content (optional)
 */
export class IpfsImage extends Component {
    constructor(props = {}) {
        super();
        this.props = props;
        
        // State for gateway rotation and loading
        this.setState({
            gatewayIndex: 0,
            isLoading: true,
            hasError: false,
            currentSrc: null
        });
        
        // Bind methods
        this.handleImageLoad = this.handleImageLoad.bind(this);
        this.handleImageError = this.handleImageError.bind(this);
    }
    
    /**
     * Get current HTTP URL based on src and gateway index
     */
    getCurrentUrl() {
        const { src } = this.props;
        
        if (!src) {
            return null;
        }
        
        // If not IPFS, return as-is
        if (!isIpfsUri(src)) {
            return src;
        }
        
        // Resolve IPFS to HTTP using current gateway
        return resolveIpfsToHttp(src, this.state.gatewayIndex);
    }
    
    /**
     * Handle successful image load
     */
    handleImageLoad(event) {
        this.setState({
            isLoading: false,
            hasError: false
        });
        
        // Call user's onLoad callback if provided
        if (this.props.onLoad) {
            this.props.onLoad(event);
        }
    }
    
    /**
     * Handle image load error - try next gateway
     */
    handleImageError(event) {
        const gateways = getAvailableGateways();
        const { src } = this.props;
        
        // If not IPFS or out of gateways, show error
        if (!isIpfsUri(src) || this.state.gatewayIndex >= gateways.length - 1) {
            this.setState({
                isLoading: false,
                hasError: true
            });
            
            // Log error for debugging
            console.error('[IpfsImage] Failed to load image:', src, {
                triedGateways: this.state.gatewayIndex + 1,
                totalGateways: gateways.length
            });
            
            // Call user's onError callback if provided
            if (this.props.onError) {
                this.props.onError(event);
            }
            
            return;
        }
        
        // Try next gateway
        const nextIndex = this.state.gatewayIndex + 1;
        this.setState({
            gatewayIndex: nextIndex
        });
        
        // Update image src to trigger new load attempt
        const img = this.element?.querySelector('img');
        if (img) {
            const nextUrl = resolveIpfsToHttp(src, nextIndex);
            if (nextUrl) {
                img.src = nextUrl;
            }
        }
    }
    
    /**
     * Render component
     */
    render() {
        const { 
            src, 
            alt = '', 
            className = '', 
            style = {},
            loading = 'lazy',
            placeholder,
            errorPlaceholder
        } = this.props;
        
        const { isLoading, hasError } = this.state;
        
        if (!src) {
            return '<div class="ipfs-image-empty"></div>';
        }
        
        const currentUrl = this.getCurrentUrl();
        
        // Error state - show placeholder
        if (hasError) {
            if (errorPlaceholder) {
                return errorPlaceholder;
            }
            
            // Default error placeholder
            return `
                <div class="ipfs-image-error ${className}" style="${this.styleToString(style)}">
                    <div class="ipfs-image-error-icon">⚠️</div>
                    <div class="ipfs-image-error-text">IPFS image unavailable</div>
                </div>
            `;
        }
        
        // Loading or loaded state - show image
        return `
            <div class="ipfs-image-container ${className}" style="${this.styleToString(style)}">
                ${isLoading && placeholder ? placeholder : ''}
                <img 
                    src="${this.escapeHtml(currentUrl || '')}" 
                    alt="${this.escapeHtml(alt)}" 
                    loading="${loading}"
                    class="ipfs-image ${isLoading ? 'ipfs-image-loading' : 'ipfs-image-loaded'}"
                    style="${isLoading ? 'opacity: 0;' : 'opacity: 1; transition: opacity 0.3s;'}"
                />
            </div>
        `;
    }
    
    /**
     * Mount component and attach event listeners
     */
    mount(element) {
        super.mount(element);
        
        // Attach load/error handlers to img element
        const img = this.element?.querySelector('img');
        if (img) {
            img.addEventListener('load', this.handleImageLoad);
            img.addEventListener('error', this.handleImageError);
            
            // Register cleanup
            this.registerCleanup(() => {
                img.removeEventListener('load', this.handleImageLoad);
                img.removeEventListener('error', this.handleImageError);
            });
        }
    }
    
    /**
     * Convert style object to string
     */
    styleToString(style) {
        if (!style || typeof style !== 'object') {
            return '';
        }
        
        return Object.entries(style)
            .map(([key, value]) => {
                const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                return `${cssKey}: ${value};`;
            })
            .join(' ');
    }
}

// Static styles for the component
IpfsImage.styles = `
    .ipfs-image-container {
        position: relative;
        display: inline-block;
        width: 100%;
        height: 100%;
    }
    
    .ipfs-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    
    .ipfs-image-loading {
        opacity: 0;
    }
    
    .ipfs-image-loaded {
        opacity: 1;
        transition: opacity 0.3s ease-in;
    }
    
    .ipfs-image-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100px;
        background-color: #f5f5f5;
        color: #666;
        padding: 1rem;
        text-align: center;
    }
    
    .ipfs-image-error-icon {
        font-size: 2rem;
        margin-bottom: 0.5rem;
    }
    
    .ipfs-image-error-text {
        font-size: 0.875rem;
    }
    
    .ipfs-image-empty {
        display: block;
        width: 100%;
        height: 100%;
        background-color: transparent;
    }
    
    /* Dark mode support */
    html[data-theme='dark'] .ipfs-image-error {
        background-color: #2a2a2a;
        color: #aaa;
    }
`;

