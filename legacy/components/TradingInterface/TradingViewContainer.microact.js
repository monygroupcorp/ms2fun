/**
 * TradingViewContainer - Microact Version
 *
 * Container for the main trading views (Bonding Curve and Swap).
 * Manages visibility of child views based on mobile/desktop state.
 */

import { Component, h } from '../../core/microact-setup.js';

export class TradingViewContainer extends Component {
    constructor(props = {}) {
        super(props);
    }

    /**
     * Override shouldUpdate to handle visibility changes via direct DOM updates
     * This prevents destroying child components when only visibility changes
     */
    shouldUpdate(oldProps, newProps) {
        // If mobile state or phase changes, need full re-render
        if (oldProps.isMobile !== newProps.isMobile) return true;
        if (oldProps.isPhase2 !== newProps.isPhase2) return true;

        // For view switching and overlay changes, update DOM directly
        if (oldProps.activeView !== newProps.activeView ||
            oldProps.showOverlay !== newProps.showOverlay ||
            oldProps.currentTier !== newProps.currentTier) {
            this.updateVisibility(newProps);
            return false;
        }

        return false;
    }

    updateVisibility(props) {
        if (!this.element) return;

        const { isMobile, activeView, showOverlay, isPhase2, currentTier, onOverlayClose } = props || this.props;

        const curveView = this.element.querySelector('.trading-view[data-view="curve"]');
        const swapView = this.element.querySelector('.trading-view[data-view="swap"]');

        if (isMobile) {
            // On mobile, only show active view
            if (curveView) curveView.style.display = activeView === 'curve' ? 'block' : 'none';
            if (swapView) swapView.style.display = activeView === 'swap' ? 'block' : 'none';
        } else {
            // On desktop, show both views
            if (curveView) curveView.style.display = 'block';
            if (swapView) swapView.style.display = 'block';
        }

        // Handle overlay
        let overlay = this.element.querySelector('.not-allowed-overlay');
        if (!isPhase2 && showOverlay) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'not-allowed-overlay';
                overlay.addEventListener('click', () => {
                    if (onOverlayClose) {
                        onOverlayClose();
                    }
                });
                const container = this.element.querySelector('.trading-container');
                if (container) {
                    container.insertBefore(overlay, container.firstChild);
                }
            }
            overlay.innerHTML = `
                <img src="/execs/stop.png" alt="Not Allowed" />
                <div class="overlay-text">NOT ALLOWED</div>
                <div class="tier-text">Current Whitelist: Tier ${currentTier !== null ? currentTier : 'Loading...'}</div>
            `;
            overlay.style.display = 'flex';
        } else if (overlay) {
            overlay.remove();
        }
    }

    didMount() {
        // Ensure visibility is correct after mount
        setTimeout(() => {
            this.updateVisibility();
        }, 0);
    }

    render() {
        const { isMobile, activeView } = this.props;

        // Set initial display styles
        const curveDisplay = isMobile ? (activeView === 'curve' ? 'block' : 'none') : 'block';
        const swapDisplay = isMobile ? (activeView === 'swap' ? 'block' : 'none') : 'block';

        return h('div', { className: 'trading-container' },
            h('div', {
                className: 'trading-view',
                'data-view': 'curve',
                style: `display: ${curveDisplay};`
            }),
            h('div', {
                className: 'trading-view',
                'data-view': 'swap',
                style: `display: ${swapDisplay};`
            })
        );
    }
}

export default TradingViewContainer;
