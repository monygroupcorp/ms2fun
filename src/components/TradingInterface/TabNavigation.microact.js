/**
 * TabNavigation - Microact Version
 *
 * Handles tab switching between different views (Bonding Curve, Swap).
 * Only shows tabs on mobile; on desktop, only shows Portfolio button.
 */

import { Component, h } from '../../core/microact-setup.js';

export class TabNavigation extends Component {
    constructor(props = {}) {
        super(props);
    }

    handleTabClickCurve() {
        const { onTabClick } = this.props;
        if (onTabClick) {
            onTabClick({ target: { dataset: { view: 'curve' } } });
        }
    }

    handleTabClickSwap() {
        const { onTabClick } = this.props;
        if (onTabClick) {
            onTabClick({ target: { dataset: { view: 'swap' } } });
        }
    }

    handlePortfolioClick(e) {
        e.preventDefault();
        const { onPortfolioClick } = this.props;
        if (onPortfolioClick) {
            onPortfolioClick();
        }
    }

    render() {
        const { isMobile, activeView } = this.props;

        return h('div', { className: 'tab-navigation' },
            isMobile && h('button', {
                className: `tab-button ${activeView === 'curve' ? 'active' : ''}`,
                onClick: this.bind(this.handleTabClickCurve)
            }, 'Bonding Curve'),

            isMobile && h('button', {
                className: `tab-button ${activeView === 'swap' ? 'active' : ''}`,
                onClick: this.bind(this.handleTabClickSwap)
            }, 'Swap'),

            h('div', { className: 'admin-button-container-cultexecs' }),

            h('button', {
                className: 'portfolio-button',
                onClick: this.bind(this.handlePortfolioClick)
            }, 'Portfolio')
        );
    }
}

export default TabNavigation;
