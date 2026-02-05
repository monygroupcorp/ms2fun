/**
 * OverlayManager - Microact Version
 *
 * Manages the whitelist "Not Allowed" overlay visibility.
 * Shows overlay when user is not whitelisted and not in Phase 2.
 */

import { Component, h } from '../../core/microact-setup.js';

export class OverlayManager extends Component {
    constructor(props = {}) {
        super(props);
    }

    handleOverlayClick(e) {
        const { onClose } = this.props;
        if (onClose) {
            onClose();
        }
    }

    render() {
        const { showOverlay, isPhase2, currentTier } = this.props;

        // Don't show overlay if in Phase 2 or overlay shouldn't be shown
        if (isPhase2 || !showOverlay) {
            return h('div', { className: 'overlay-manager-empty' });
        }

        return h('div', {
            className: 'not-allowed-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('img', { src: '/public/execs/stop.png', alt: 'Not Allowed' }),
            h('div', { className: 'overlay-text' }, 'NOT ALLOWED'),
            h('div', { className: 'tier-text' },
                `Current Whitelist: Tier ${currentTier !== null ? currentTier : 'Loading...'}`
            )
        );
    }
}

export default OverlayManager;
