/**
 * SwapButton - Microact Version
 *
 * Main swap action button with state management.
 */

import { Component, h } from '../../core/microact-setup.js';

export class SwapButton extends Component {
    constructor(props = {}) {
        super(props);
    }

    handleClick(e) {
        e.preventDefault();
        const { disabled, onClick } = this.props;
        if (!disabled && onClick) {
            onClick(e);
        }
    }

    render() {
        const { direction, disabled } = this.props;
        const buttonText = direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';

        return h('button', {
            className: 'swap-button',
            disabled: disabled,
            onClick: this.bind(this.handleClick)
        }, buttonText);
    }
}

export default SwapButton;
