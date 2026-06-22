/**
 * ModeBanner - Shows current mode (mock/demo)
 *
 * Displays a subtle banner when running in mock mode
 * so users understand they're seeing demo data.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';

export class ModeBanner extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            showBanner: false,
            reason: null
        };
    }

    async didMount() {
        // Dynamically import to avoid circular dependency
        const { default: serviceFactory } = await import('../../services/ServiceFactory.js');

        // Check initial state
        if (serviceFactory.isUsingMock()) {
            this.setState({ showBanner: true, reason: 'mock' });
        }

        // Listen for mode changes
        const unsub = eventBus.on('services:mock-mode', (data) => {
            this.setState({
                showBanner: true,
                reason: data?.reason || 'mock'
            });
        });
        this.registerCleanup(unsub);
    }

    getMessage() {
        const { reason } = this.state;
        if (reason === 'rpc-unavailable') {
            return 'Demo Mode - No blockchain detected. Start Anvil for live data.';
        }
        if (reason === 'contracts-missing') {
            return 'Demo Mode - Contracts not deployed. Run setup scripts or use ?network=mock';
        }
        return 'Demo Mode - Showing sample data';
    }

    handleDismiss() {
        this.setState({ showBanner: false });
    }

    render() {
        if (!this.state.showBanner) {
            return h('div', { class: 'mode-banner-hidden', style: 'display:none' });
        }

        return h('div', { class: 'mode-banner' },
            h('span', { class: 'mode-banner-icon' }, '🔧'),
            h('span', { class: 'mode-banner-text' }, this.getMessage()),
            h('button', {
                class: 'mode-banner-dismiss',
                onclick: () => this.handleDismiss(),
                title: 'Dismiss'
            }, '×')
        );
    }
}

export default ModeBanner;
