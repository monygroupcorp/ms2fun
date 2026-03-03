/**
 * MobileNav - Mobile navigation panel
 *
 * Dropdown panel shown when hamburger menu is toggled
 * Automatically hidden on desktop via CSS
 *
 * @example
 * h(MobileNav, { isOpen: true })
 */

import { h, Component } from '@monygroupcorp/microact';

export class MobileNav extends Component {
    handleNavClick = (path) => (e) => {
        e.preventDefault();
        window.router.navigate(path);

        // Notify parent to close mobile nav
        if (this.props.onClose) {
            this.props.onClose();
        }
    }

    render() {
        const { isOpen = false, currentPath = '', mode } = this.props;
        const comingSoon = mode === 'COMING_SOON';
        const className = isOpen ? 'mobile-nav-panel is-open' : 'mobile-nav-panel';

        return h('div', {
            className,
            id: 'mobile-nav'
        },
            h('a', {
                href: '/discover',
                className: 'mobile-nav-link',
                onclick: this.handleNavClick('/discover')
            }, 'Discover'),

            h('a', {
                href: '/portfolio',
                className: 'mobile-nav-link',
                onclick: this.handleNavClick('/portfolio')
            }, 'Portfolio'),

            h('a', {
                href: '/governance',
                className: 'mobile-nav-link',
                onclick: this.handleNavClick('/governance')
            }, 'Governance'),

            h('a', {
                href: '/docs',
                className: 'mobile-nav-link',
                onclick: this.handleNavClick('/docs')
            }, 'Docs'),

            h('a', {
                href: comingSoon ? undefined : '/create',
                className: `mobile-nav-link mobile-nav-link-primary${comingSoon ? ' btn-disabled' : ''}`,
                onclick: comingSoon ? undefined : this.handleNavClick('/create'),
                'aria-disabled': comingSoon ? 'true' : undefined
            }, 'Create')
        );
    }
}

export default MobileNav;
