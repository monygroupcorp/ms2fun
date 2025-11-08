import { Component } from '../../core/Component.js';

/**
 * TabNavigation Component
 * 
 * Handles tab switching between different views (Bonding Curve, Swap).
 * Only shows tabs on mobile; on desktop, only shows Portfolio button.
 * 
 * @class TabNavigation
 * @extends Component
 */
export class TabNavigation extends Component {
    /**
     * @param {Object} props - Component props
     * @param {boolean} props.isMobile - Whether in mobile view
     * @param {string} props.activeView - Currently active view ('swap' or 'curve')
     * @param {Function} props.onTabClick - Callback when tab is clicked (view)
     * @param {Function} props.onPortfolioClick - Callback when portfolio button is clicked
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
     * Handle tab button click
     * @param {Event} e - Click event
     */
    handleTabClick(e) {
        const view = e.target.dataset.view;
        if (view && this.props.onTabClick) {
            this.props.onTabClick({ target: { dataset: { view } } });
        }
    }

    /**
     * Handle portfolio button click
     * @param {Event} e - Click event
     */
    handlePortfolioClick(e) {
        e.preventDefault();
        if (this.props.onPortfolioClick) {
            this.props.onPortfolioClick();
        }
    }

    events() {
        return {
            'click .tab-button': (e) => this.handleTabClick(e),
            'click .portfolio-button': (e) => this.handlePortfolioClick(e)
        };
    }

    render() {
        const { isMobile, activeView } = this.props;

        return `
            <div class="tab-navigation">
                ${isMobile ? `
                    <button class="tab-button ${activeView === 'curve' ? 'active' : ''}" data-view="curve">Bonding Curve</button>
                    <button class="tab-button ${activeView === 'swap' ? 'active' : ''}" data-view="swap">Swap</button>
                ` : ''}
                <button class="portfolio-button">Portfolio</button>
            </div>
        `;
    }

    onMount() {
        // Ensure events are bound after mount
        this.bindEvents();
    }

    onUpdate() {
        // Re-bind events after update
        this.bindEvents();
    }
}

export default TabNavigation;

