/**
 * SwapControls - Microact Version
 *
 * Handles the direction switch button and quick fill buttons.
 */

import { Component, h } from '../../core/microact-setup.js';

export class SwapControls extends Component {
    constructor(props = {}) {
        super(props);
    }

    handleDirectionSwitch(e) {
        e.preventDefault();
        e.stopPropagation();
        const { onDirectionSwitch } = this.props;
        if (onDirectionSwitch) {
            onDirectionSwitch(e);
        }
    }

    handleQuickFillAmount(amount) {
        const { onQuickFill } = this.props;
        if (onQuickFill) {
            // Simulate event with dataset
            onQuickFill({ target: { dataset: { amount } } });
        }
    }

    handleQuickFillPercentage(percentage) {
        const { onQuickFill } = this.props;
        if (onQuickFill) {
            onQuickFill({ target: { dataset: { percentage } } });
        }
    }

    // Individual handlers for each quick fill button (for stable binding)
    handleAmount0025() { this.handleQuickFillAmount('0.0025'); }
    handleAmount001() { this.handleQuickFillAmount('0.01'); }
    handleAmount005() { this.handleQuickFillAmount('0.05'); }
    handleAmount01() { this.handleQuickFillAmount('0.1'); }

    handlePercent25() { this.handleQuickFillPercentage('25'); }
    handlePercent50() { this.handleQuickFillPercentage('50'); }
    handlePercent75() { this.handleQuickFillPercentage('75'); }
    handlePercent100() { this.handleQuickFillPercentage('100'); }

    render() {
        const { direction } = this.props;

        const quickFillButtons = direction === 'buy'
            ? [
                h('button', {
                    'data-amount': '0.0025',
                    onClick: this.bind(this.handleAmount0025)
                }, '0.0025'),
                h('button', {
                    'data-amount': '0.01',
                    onClick: this.bind(this.handleAmount001)
                }, '0.01'),
                h('button', {
                    'data-amount': '0.05',
                    onClick: this.bind(this.handleAmount005)
                }, '0.05'),
                h('button', {
                    'data-amount': '0.1',
                    onClick: this.bind(this.handleAmount01)
                }, '0.1')
            ]
            : [
                h('button', {
                    'data-percentage': '25',
                    onClick: this.bind(this.handlePercent25)
                }, '25%'),
                h('button', {
                    'data-percentage': '50',
                    onClick: this.bind(this.handlePercent50)
                }, '50%'),
                h('button', {
                    'data-percentage': '75',
                    onClick: this.bind(this.handlePercent75)
                }, '75%'),
                h('button', {
                    'data-percentage': '100',
                    onClick: this.bind(this.handlePercent100)
                }, '100%')
            ];

        return h('div', { className: 'swap-controls-wrapper' },
            h('div', { className: 'quick-fill-buttons' }, ...quickFillButtons),
            h('button', {
                className: 'direction-switch',
                onClick: this.bind(this.handleDirectionSwitch)
            }, '↑↓')
        );
    }
}

export default SwapControls;
