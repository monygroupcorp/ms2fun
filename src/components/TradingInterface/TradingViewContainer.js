import { Component } from '../../core/Component.js';

/**
 * TradingViewContainer Component
 * 
 * Container for the main trading views (Bonding Curve and Swap).
 * Manages visibility of child views based on mobile/desktop state.
 * 
 * @class TradingViewContainer
 * @extends Component
 */
export class TradingViewContainer extends Component {
    /**
     * @param {Object} props - Component props
     * @param {boolean} props.isMobile - Whether in mobile view
     * @param {string} props.activeView - Currently active view ('swap' or 'curve')
     * @param {boolean} props.showOverlay - Whether to show overlay
     * @param {boolean} props.isPhase2 - Whether in Phase 2
     * @param {number|null} props.currentTier - Current whitelist tier
     * @param {Function} props.onOverlayClose - Callback when overlay is closed
     */
    constructor(props = {}) {
        super();
        this.props = props;
    }

    /**
     * Update component props
     * @param {Object} newProps - New props to merge
     */
    updateProps(newProps) {
        this.props = { ...this.props, ...newProps };
        // Don't call update() here as it will re-render and lose child components
        // Just update visibility directly
        this.updateVisibility();
    }

    /**
     * Update view visibility based on props
     */
    updateVisibility() {
        if (!this.element) return;

        const { isMobile, activeView, showOverlay, isPhase2, currentTier } = this.props;
        
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
                    if (this.props.onOverlayClose) {
                        this.props.onOverlayClose();
                    }
                });
                this.element.insertBefore(overlay, this.element.firstChild);
            }
            overlay.innerHTML = `
                <img src="/public/stop.png" alt="Not Allowed" />
                <div class="overlay-text">NOT ALLOWED</div>
                <div class="tier-text">Current Whitelist: Tier ${currentTier !== null ? currentTier : 'Loading...'}</div>
            `;
            overlay.style.display = 'flex';
        } else if (overlay) {
            overlay.remove();
        }
    }

    render() {
        const { isMobile, activeView } = this.props;
        
        // Set initial display styles
        const curveDisplay = isMobile ? (activeView === 'curve' ? 'block' : 'none') : 'block';
        const swapDisplay = isMobile ? (activeView === 'swap' ? 'block' : 'none') : 'block';
        
        return `
            <div class="trading-container">
                <div class="trading-view" data-view="curve" style="display: ${curveDisplay};"></div>
                <div class="trading-view" data-view="swap" style="display: ${swapDisplay};"></div>
            </div>
        `;
    }

    onMount() {
        // Ensure events are bound after mount
        this.bindEvents();
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            this.updateVisibility();
        }, 0);
    }

    onUpdate() {
        // Re-bind events after update
        this.bindEvents();
        // Update visibility after DOM update
        setTimeout(() => {
            this.updateVisibility();
        }, 0);
    }
}

export default TradingViewContainer;

