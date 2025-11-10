import { Component } from '../../core/Component.js';

/**
 * OverlayManager Component
 * 
 * Manages the whitelist "Not Allowed" overlay visibility.
 * Shows overlay when user is not whitelisted and not in Phase 2.
 * 
 * @class OverlayManager
 * @extends Component
 */
export class OverlayManager extends Component {
    /**
     * @param {Object} props - Component props
     * @param {boolean} props.showOverlay - Whether to show the overlay
     * @param {boolean} props.isPhase2 - Whether in Phase 2 (liquidity deployed)
     * @param {number|null} props.currentTier - Current whitelist tier
     * @param {Function} props.onClose - Callback when overlay is closed/clicked
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
        this.update();
    }

    /**
     * Handle overlay click (to close)
     * @param {Event} e - Click event
     */
    handleOverlayClick(e) {
        if (this.props.onClose) {
            this.props.onClose();
        }
    }

    events() {
        return {
            'click .not-allowed-overlay': (e) => this.handleOverlayClick(e)
        };
    }

    render() {
        const { showOverlay, isPhase2, currentTier } = this.props;

        // Don't show overlay if in Phase 2 or overlay shouldn't be shown
        if (isPhase2 || !showOverlay) {
            return '';
        }

        return `
            <div class="not-allowed-overlay">
                <img src="/public/execs/stop.png" alt="Not Allowed" />
                <div class="overlay-text">NOT ALLOWED</div>
                <div class="tier-text">Current Whitelist: Tier ${currentTier !== null ? currentTier : 'Loading...'}</div>
            </div>
        `;
    }
}

export default OverlayManager;

