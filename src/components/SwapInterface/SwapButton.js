import { Component } from '../../core/Component.js';

/**
 * SwapButton Component
 * 
 * Main swap action button with state management.
 * 
 * @class SwapButton
 * @extends Component
 */
export class SwapButton extends Component {
    /**
     * @param {Object} props - Component props
     * @param {string} props.direction - Current swap direction ('buy' or 'sell')
     * @param {boolean} props.disabled - Whether button should be disabled
     * @param {Function} props.onClick - Callback when button is clicked
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
        const oldProps = { ...this.props };
        this.props = { ...this.props, ...newProps };
        
        // Only update if the button text would actually change
        const oldText = oldProps.direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';
        const newText = this.props.direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';
        
        if (oldText !== newText || oldProps.disabled !== this.props.disabled) {
            // Only update if something actually changed
            if (this.element) {
                const button = this.element.querySelector('.swap-button');
                if (button) {
                    button.textContent = newText;
                    if (this.props.disabled) {
                        button.disabled = true;
                    } else {
                        button.disabled = false;
                    }
                }
            }
        }
    }

    /**
     * Handle button click
     * @param {Event} e - Click event
     */
    handleClick(e) {
        e.preventDefault();
        if (!this.props.disabled && this.props.onClick) {
            this.props.onClick(e);
        }
    }

    events() {
        return {
            'click .swap-button': (e) => this.handleClick(e)
        };
    }

    render() {
        const { direction, disabled } = this.props;
        const buttonText = direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';

        return `
            <button class="swap-button" ${disabled ? 'disabled' : ''}>
                ${buttonText}
            </button>
        `;
    }
}

export default SwapButton;

