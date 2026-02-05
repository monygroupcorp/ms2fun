/**
 * HeroSection - Microact Version
 *
 * Golden plaque hero with title, subtitle, and CTA buttons.
 * Features a dropdown menu for "Create" actions.
 */

import { Component, h } from '../../core/microact-setup.js';

export class HeroSection extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            createMenuOpen: false
        };
    }

    didMount() {
        // ESC key to close modal
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.state.createMenuOpen) {
                this.handleCreateMenuClose();
            }
        };

        document.addEventListener('keydown', escHandler);
        this.registerCleanup(() => {
            document.removeEventListener('keydown', escHandler);
        });
    }

    handleCreateMenuToggle() {
        this.setState({ createMenuOpen: !this.state.createMenuOpen });
    }

    handleCreateMenuClose() {
        this.setState({ createMenuOpen: false });
    }

    handleDocumentationClick(e) {
        e.preventDefault();
        if (window.router) {
            window.router.navigate('/about');
        } else {
            window.location.href = '/about';
        }
    }

    handleCreateProjectClick(e) {
        e.preventDefault();
        this.handleCreateMenuClose();
        if (window.router) {
            window.router.navigate('/factories');
        } else {
            window.location.href = '/factories';
        }
    }

    handleCreateVaultClick(e) {
        e.preventDefault();
        this.handleCreateMenuClose();
        if (window.router) {
            window.router.navigate('/vaults/register');
        } else {
            window.location.href = '/vaults/register';
        }
    }

    handleScrollIndicatorClick() {
        const contentSection = document.querySelector('.home-content-section');
        if (contentSection) {
            contentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    handleOverlayClick(e) {
        if (e.target === e.currentTarget) {
            this.handleCreateMenuClose();
        }
    }

    render() {
        const { createMenuOpen } = this.state;

        return h('div', { className: 'hero-section' },
            // Hero plaque
            h('div', { className: 'hero-plaque' },
                h('h1', { className: 'hero-title' }, 'MS2.FUN LAUNCHPAD'),
                h('p', { className: 'hero-subtitle' }, 'A curated platform for Web3 project discovery and interaction'),
                h('div', { className: 'hero-buttons' },
                    h('a', {
                        href: '/about',
                        className: 'cta-button documentation-button',
                        onClick: this.bind(this.handleDocumentationClick)
                    }, 'Documentation'),
                    h('button', {
                        className: 'cta-button create-button',
                        onClick: this.bind(this.handleCreateMenuToggle)
                    }, 'Create')
                )
            ),

            // Scroll indicator
            h('div', {
                className: 'scroll-indicator',
                onClick: this.bind(this.handleScrollIndicatorClick)
            },
                h('svg', {
                    className: 'scroll-chevron',
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    xmlns: 'http://www.w3.org/2000/svg'
                },
                    h('path', {
                        d: 'M7 10L12 15L17 10',
                        stroke: 'currentColor',
                        'stroke-width': '2',
                        'stroke-linecap': 'round',
                        'stroke-linejoin': 'round'
                    })
                )
            ),

            // Create Options Modal
            createMenuOpen && this.renderCreateModal()
        );
    }

    renderCreateModal() {
        return h('div', {
            className: 'create-modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'create-modal' },
                h('h2', { className: 'modal-title' }, 'What would you like to create?'),
                h('div', { className: 'modal-options' },
                    h('a', {
                        href: '/factories',
                        className: 'option-card',
                        onClick: this.bind(this.handleCreateProjectClick)
                    },
                        h('div', { className: 'option-icon' }, '🚀'),
                        h('h3', { className: 'option-title' }, 'Create Project'),
                        h('p', { className: 'option-description' }, 'Launch a new NFT or token project using our factory templates')
                    ),
                    h('a', {
                        href: '/vaults/register',
                        className: 'option-card',
                        onClick: this.bind(this.handleCreateVaultClick)
                    },
                        h('div', { className: 'option-icon' }, '💰'),
                        h('h3', { className: 'option-title' }, 'Create Vault'),
                        h('p', { className: 'option-description' }, 'Register a new vault for protocol alignment and rewards')
                    )
                ),
                h('button', {
                    className: 'modal-close',
                    onClick: this.bind(this.handleCreateMenuClose)
                }, 'Cancel')
            )
        );
    }
}

export default HeroSection;
