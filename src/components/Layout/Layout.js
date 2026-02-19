/**
 * Layout - Page layout wrapper
 *
 * Combines TopBar, content area, and Footer
 * Handles mobile navigation state
 *
 * @example
 * h(Layout, null,
 *   h('div', null, 'Page content')
 * )
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
        const { children, currentPath = '' } = this.props;
        const { mobileNavOpen } = this.state;

        return h('div', { className: 'app-layout' },
            h('div', { className: 'home-top-bar' },
                h(TopBar, {
                    currentPath,
                    onToggleMobileNav: this.handleToggleMobileNav
                }),
                h(MobileNav, {
                    isOpen: mobileNavOpen,
                    currentPath,
                    onClose: this.handleCloseMobileNav
                })
            ),

            h('main', { className: 'app-main' },
                children
            ),

            h(Footer)
        );
    }
}

export default Layout;
