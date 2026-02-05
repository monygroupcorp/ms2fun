/**
 * IpfsImage - Microact Version
 *
 * Renders images with IPFS support, including gateway rotation on failure.
 * Falls back gracefully if all gateways fail.
 *
 * Props:
 * - src: Image URL (HTTP or IPFS)
 * - alt: Alt text for image
 * - className: CSS classes
 * - style: Style object
 * - loading: Loading attribute ('lazy', 'eager', etc.)
 * - onLoad: Callback when image loads
 * - onError: Callback when image fails
 * - placeholder: Placeholder element while loading
 * - errorPlaceholder: Error placeholder element
 */

import { Component, h } from '../../core/microact-setup.js';
import { isIpfsUri, resolveIpfsToHttp, getAvailableGateways } from '../../services/IpfsService.js';

export class IpfsImage extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            gatewayIndex: 0,
            isLoading: true,
            hasError: false
        };
    }

    getCurrentUrl() {
        const { src } = this.props;
        if (!src) return null;
        if (!isIpfsUri(src)) return src;
        return resolveIpfsToHttp(src, this.state.gatewayIndex);
    }

    handleImageLoad(event) {
        this.setState({
            isLoading: false,
            hasError: false
        });

        if (this.props.onLoad) {
            this.props.onLoad(event);
        }
    }

    handleImageError(event) {
        const gateways = getAvailableGateways();
        const { src } = this.props;

        if (!isIpfsUri(src) || this.state.gatewayIndex >= gateways.length - 1) {
            this.setState({
                isLoading: false,
                hasError: true
            });

            console.error('[IpfsImage] Failed to load image:', src, {
                triedGateways: this.state.gatewayIndex + 1,
                totalGateways: gateways.length
            });

            if (this.props.onError) {
                this.props.onError(event);
            }
            return;
        }

        // Try next gateway
        this.setState({
            gatewayIndex: this.state.gatewayIndex + 1
        });
    }

    styleToString(style) {
        if (!style || typeof style !== 'object') return '';
        return Object.entries(style)
            .map(([key, value]) => {
                const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                return `${cssKey}: ${value};`;
            })
            .join(' ');
    }

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
            return h('div', { className: 'ipfs-image-empty' });
        }

        const currentUrl = this.getCurrentUrl();

        // Error state
        if (hasError) {
            if (errorPlaceholder) {
                return errorPlaceholder;
            }

            return h('div', {
                className: `ipfs-image-error ${className}`,
                style: this.styleToString(style)
            },
                h('div', { className: 'ipfs-image-error-icon' }, '⚠️'),
                h('div', { className: 'ipfs-image-error-text' }, 'IPFS image unavailable')
            );
        }

        // Loading or loaded state
        return h('div', {
            className: `ipfs-image-container ${className}`,
            style: this.styleToString(style)
        },
            isLoading && placeholder ? placeholder : null,
            h('img', {
                src: currentUrl || '',
                alt,
                loading,
                className: `ipfs-image ${isLoading ? 'ipfs-image-loading' : 'ipfs-image-loaded'}`,
                style: isLoading ? 'opacity: 0;' : 'opacity: 1; transition: opacity 0.3s;',
                onload: this.bind(this.handleImageLoad),
                onerror: this.bind(this.handleImageError)
            })
        );
    }
}

export default IpfsImage;
