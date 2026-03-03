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
import { SimpleWalletButton } from '../Web3/SimpleWalletButton.js';

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
        const { children, currentPath = '' } = this.props;
        const { mobileNavOpen } = this.state;

        return h('div', { className: 'app-layout' },
            h(TopBar, {
                currentPath,
                onToggleMobileNav: this.handleToggleMobileNav,
                mobileNavOpen,
                children: h(MobileNav, {
                    isOpen: mobileNavOpen,
                    currentPath,
                    onClose: this.handleCloseMobileNav
                })
            }),

            h('main', { className: 'app-main' },
                children
            ),

            h(SimpleWalletButton),

            h(Footer)
        );
    }
}

export default Layout;
