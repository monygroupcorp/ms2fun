import { Component } from '../../core/Component.js';

/**
 * PortfolioButton Component
 * 
 * Button that opens the portfolio modal.
 * 
 * @class PortfolioButton
 * @extends Component
 */
export class PortfolioButton extends Component {
    /**
     * @param {Object} props - Component props
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
        this.props = { ...this.props, ...newProps };
        this.update();
    }

    /**
     * Handle button click
     * @param {Event} e - Click event
     */
    handleClick(e) {
        e.preventDefault();
        if (this.props.onClick) {
            this.props.onClick();
        }
    }

    events() {
        return {
            'click .portfolio-button': (e) => this.handleClick(e)
        };
    }

    render() {
        return `<button class="portfolio-button">Portfolio</button>`;
    }
}

export default PortfolioButton;

