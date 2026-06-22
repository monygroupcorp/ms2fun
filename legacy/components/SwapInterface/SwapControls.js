import { Component } from '../../core/Component.js';

/**
 * SwapControls Component
 * 
 * Handles the direction switch button and quick fill buttons.
 * 
 * @class SwapControls
 * @extends Component
 */
export class SwapControls extends Component {
    /**
     * @param {Object} props - Component props
     * @param {string} props.direction - Current swap direction ('buy' or 'sell')
     * @param {Function} props.onDirectionSwitch - Callback when direction switch is clicked
     * @param {Function} props.onQuickFill - Callback when quick fill button is clicked (amount or percentage)
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
     * Handle direction switch click
     * @param {Event} e - Click event
     */
    handleDirectionSwitch(e) {
        e.preventDefault();
        e.stopPropagation();
        if (this.props.onDirectionSwitch) {
            this.props.onDirectionSwitch(e);
        }
    }

    /**
     * Handle quick fill button click
     * @param {Event} e - Click event
     */
    handleQuickFill(e) {
        e.preventDefault();
        if (this.props.onQuickFill) {
            this.props.onQuickFill(e);
        }
    }

    events() {
        return {
            'click .direction-switch': (e) => this.handleDirectionSwitch(e),
            'click [data-amount]': (e) => this.handleQuickFill(e),
            'click [data-percentage]': (e) => this.handleQuickFill(e)
        };
    }

    render() {
        const { direction } = this.props;

        return `
            <div class="quick-fill-buttons">
                ${direction === 'buy' ? 
                    `<button data-amount="0.0025">0.0025</button>
                    <button data-amount="0.01">0.01</button>
                    <button data-amount="0.05">0.05</button>
                    <button data-amount="0.1">0.1</button>`
                :
                    `<button data-percentage="25">25%</button>
                    <button data-percentage="50">50%</button>
                    <button data-percentage="75">75%</button>
                    <button data-percentage="100">100%</button>`
                }
            </div>
            <button class="direction-switch">↑↓</button>
        `;
    }
}

export default SwapControls;

