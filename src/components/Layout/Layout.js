/**
 * Layout - Page layout wrapper
 *
 * Combines TopBar, content area, and Footer
 * Handles mobile navigation state
 *
 * Web3 initialization handled by route handlers, not Layout
 *
 * @example
 * h(Layout, {
 *     currentPath: '/',
 *     children: h(YourRoute)
 * })
 */

import { h, Component } from '@monygroupcorp/microact';
import { TopBar } from './TopBar.js';
import { MobileNav } from './MobileNav.js';
import { Footer } from './Footer.js';

export class Layout extends Component {
    constructor(props) {
        super(props);
        this.state = {
            mobileNavOpen: false
        };
    }

    handleToggleMobileNav = (isOpen) => {
        this.setState({ mobileNavOpen: isOpen });
    }

    handleCloseMobileNav = () => {
        this.setState({ mobileNavOpen: false });
    }

    render() {
        const { children, currentPath = '', mode } = this.props;
        const { mobileNavOpen } = this.state;

        const isTestnet = mode === 'SEPOLIA' || mode === 'SEPOLIA_DEV';

        return h('div', { className: 'app-layout' },
            isTestnet && h('div', {
                style: 'background:#ff6b00;color:#000;text-align:center;padding:6px 16px;font-size:13px;font-weight:700;letter-spacing:0.04em;border-bottom:2px solid #000;'
            }, 'STAGED TEST VERSION — SEPOLIA TESTNET — NOT REAL MONEY'),
            h(TopBar, {
                currentPath,
                mode,
                onToggleMobileNav: this.handleToggleMobileNav,
                mobileNavOpen,
                children: h(MobileNav, {
                    isOpen: mobileNavOpen,
                    currentPath,
                    mode,
                    onClose: this.handleCloseMobileNav
                })
            }),

            h('main', { className: 'app-main' },
                children
            ),

            h(Footer)
        );
    }
}

export default Layout;
