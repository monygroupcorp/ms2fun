/**
 * TopBar - Site navigation header
 *
 * Desktop: Logo + nav links
 * Mobile: Logo + hamburger toggle
 *
 * @example
 * h(TopBar, { onToggleMobileNav: () => {} })
 */

import { h, Component } from '@monygroupcorp/microact';

export class TopBar extends Component {
    constructor(props) {
        super(props);
        this.state = {
            mobileNavOpen: false
        };
    }

    handleToggleMobileNav = () => {
        const newState = !this.state.mobileNavOpen;
        this.setState({ mobileNavOpen: newState });

        // Notify parent if callback provided
        if (this.props.onToggleMobileNav) {
            this.props.onToggleMobileNav(newState);
        }
    }

    render() {
        const { currentPath = '', children, mobileNavOpen, mode } = this.props;
        const comingSoon = mode === 'COMING_SOON';

        return h('div', { className: 'home-top-bar' },
            // Logo
            h('a', {
                href: '/',
                className: 'home-logo',
                onclick: (e) => {
                    e.preventDefault();
                    window.router.navigate('/');
                }
            },
                'MS2',
                h('span', { className: 'logo-tld' }, '.fun')
            ),

            // Mobile Menu Toggle (hamburger)
            h('button', {
                className: 'mobile-menu-toggle',
                'aria-label': 'Menu',
                'aria-expanded': mobileNavOpen ? 'true' : 'false',
                onclick: this.handleToggleMobileNav
            },
                h('span', { className: 'hamburger-bar' })
            ),

            // Desktop Nav Links (minimal - Create button only)
            h('div', { className: 'nav-links' },
                h('a', {
                    href: comingSoon ? undefined : '/create',
                    className: `btn btn-primary${comingSoon ? ' btn-disabled' : ''}`,
                    onclick: comingSoon ? undefined : (e) => {
                        e.preventDefault();
                        window.router.navigate('/create');
                    },
                    'aria-disabled': comingSoon ? 'true' : undefined
                }, 'Create')
            ),

            // MobileNav rendered as child
            children
        );
    }
}

export default TopBar;
