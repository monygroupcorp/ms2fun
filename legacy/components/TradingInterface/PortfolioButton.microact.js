/**
 * PortfolioButton - Microact Version
 *
 * Button that opens the portfolio modal.
 */

import { Component, h } from '../../core/microact-setup.js';

export class PortfolioButton extends Component {
    constructor(props = {}) {
        super(props);
    }

    handleClick(e) {
        e.preventDefault();
        const { onClick } = this.props;
        if (onClick) {
            onClick();
        }
    }

    render() {
        return h('button', {
            className: 'portfolio-button',
            onClick: this.bind(this.handleClick)
        }, 'Portfolio');
    }
}

export default PortfolioButton;
