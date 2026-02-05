/**
 * Documentation - Microact Version
 *
 * Main documentation/about page with scroll spy and mobile menu.
 */

import { Component, h } from '../../core/microact-setup.js';

export class Documentation extends Component {
    constructor(props = {}) {
        super(props);
        this._scrollObserver = null;
        this._isScrolling = false;
        this._scrollTimeout = null;
        this._navClickHandler = null;
        this._mobileMenuRetries = 0;
        this.state = {
            activeSection: 'hero',
            sidebarOpen: false
        };
    }

    async didMount() {
        setTimeout(() => {
            this.setupScrollSpy();
        }, 100);
        this.setupSmoothScrolling();
        setTimeout(() => {
            this.setupMobileMenu();
        }, 50);
        this.setupFAQ();
    }

    setupScrollSpy() {
        if (this._scrollObserver) {
            this._scrollObserver.disconnect();
            this._scrollObserver = null;
        }

        if (!this._element) return;

        const sections = this._element.querySelectorAll('.doc-section[id]');

        if (sections.length === 0) return;

        this._scrollObserver = new IntersectionObserver((entries) => {
            if (this._isScrolling) return;

            const navLinks = this._element.querySelectorAll('.doc-nav-link');
            if (navLinks.length === 0) return;

            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sectionId = entry.target.id;
                    // Update active state directly via DOM to avoid re-render
                    navLinks.forEach(link => {
                        if (link.getAttribute('href') === `#${sectionId}`) {
                            link.classList.add('active');
                        } else {
                            link.classList.remove('active');
                        }
                    });
                }
            });
        }, {
            rootMargin: '-20% 0px -60% 0px',
            threshold: 0.1
        });

        sections.forEach(section => this._scrollObserver.observe(section));

        this.registerCleanup(() => {
            if (this._scrollObserver) {
                this._scrollObserver.disconnect();
                this._scrollObserver = null;
            }
            if (this._scrollTimeout) {
                clearTimeout(this._scrollTimeout);
                this._scrollTimeout = null;
            }
        });
    }

    setupSmoothScrolling() {
        const navContainer = this._element?.querySelector('.doc-nav');
        if (!navContainer) return;

        if (this._navClickHandler) {
            navContainer.removeEventListener('click', this._navClickHandler);
        }

        this._navClickHandler = (e) => {
            const link = e.target.closest('.doc-nav-link');
            if (!link) return;

            e.preventDefault();
            e.stopPropagation();

            const href = link.getAttribute('href');
            if (!href || !href.startsWith('#')) return;

            const targetId = href.substring(1);
            this.scrollToSection(targetId);

            // Close mobile menu if open
            if (this.state.sidebarOpen) {
                this.closeSidebar();
            }
        };

        navContainer.addEventListener('click', this._navClickHandler, true);

        this.registerCleanup(() => {
            if (navContainer && this._navClickHandler) {
                navContainer.removeEventListener('click', this._navClickHandler, true);
                this._navClickHandler = null;
            }
        });

        // Setup CTA button navigation
        this.setupCTAButtons();
    }

    setupCTAButtons() {
        const ctaButtons = this._element?.querySelectorAll('[data-ref="cta-get-started"], [data-ref="footer-cta-home"]');
        const factoryButtons = this._element?.querySelectorAll('[data-ref="cta-factories"], [data-ref="footer-cta-factories"]');

        ctaButtons?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/');
                } else {
                    window.location.href = '/';
                }
            });
        });

        factoryButtons?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/factories');
                } else {
                    window.location.href = '/factories';
                }
            });
        });
    }

    setupMobileMenu() {
        const menuToggle = this._element?.querySelector('[data-ref="menu-toggle"]');
        const sidebar = this._element?.querySelector('[data-ref="sidebar"]');
        const overlay = this._element?.querySelector('[data-ref="sidebar-overlay"]');

        if (!menuToggle || !sidebar || !overlay) {
            if (this._mobileMenuRetries < 3) {
                this._mobileMenuRetries++;
                setTimeout(() => this.setupMobileMenu(), 200);
            }
            return;
        }

        this._mobileMenuRetries = 0;

        menuToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleSidebar();
        });

        overlay.addEventListener('click', () => {
            this.closeSidebar();
        });

        const handleResize = () => {
            if (window.innerWidth > 968) {
                this.closeSidebar();
            }
        };

        window.addEventListener('resize', handleResize);

        this.registerCleanup(() => {
            window.removeEventListener('resize', handleResize);
            document.body.style.overflow = '';
        });
    }

    toggleSidebar() {
        const sidebar = this._element?.querySelector('[data-ref="sidebar"]');
        const overlay = this._element?.querySelector('[data-ref="sidebar-overlay"]');

        if (sidebar?.classList.contains('active')) {
            this.closeSidebar();
        } else {
            sidebar?.classList.add('active');
            overlay?.classList.add('active');
            document.body.style.overflow = 'hidden';
            this.setState({ sidebarOpen: true });
        }
    }

    closeSidebar() {
        const sidebar = this._element?.querySelector('[data-ref="sidebar"]');
        const overlay = this._element?.querySelector('[data-ref="sidebar-overlay"]');

        sidebar?.classList.remove('active');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
        this.setState({ sidebarOpen: false });
    }

    scrollToSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (!section) return;

        if (this._scrollTimeout) {
            clearTimeout(this._scrollTimeout);
            this._scrollTimeout = null;
        }

        this._isScrolling = true;

        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', `#${sectionId}`);
        }

        // Update nav link active state
        const navLinks = this._element?.querySelectorAll('.doc-nav-link');
        navLinks?.forEach(link => {
            if (link.getAttribute('href') === `#${sectionId}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                section.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                    inline: 'nearest'
                });
            });
        });

        this._scrollTimeout = setTimeout(() => {
            this._isScrolling = false;
            this._scrollTimeout = null;
        }, 1000);
    }

    async setupFAQ() {
        const faqContainer = this._element?.querySelector('[data-ref="faq-container"]');
        if (!faqContainer) return;

        const { FAQ } = await import('./FAQ.js');
        const faqs = this.getFAQs();
        const faqComponent = new FAQ(faqs);
        faqComponent.mount(faqContainer);
    }

    getFAQs() {
        return [
            {
                id: 'what-is',
                question: 'What is ms2.fun?',
                answer: `<p>ms2.fun is a fully decentralized launchpad for Web3 projects. It's statically hosted (GitHub, soon IPFS), connects to a public master contract, and lets anyone create factories and collections. It's an emergent ecosystem built for the community, especially the cult executives.</p>`
            },
            {
                id: 'how-does-it-work',
                question: 'How does it work?',
                answer: `<p>The master contract indexes authorized factories. Anyone can submit a factory (though they need to meet requirements and get approval from cult executives). Once a factory is authorized, anyone can use it to create project instances. It's permissionless creation within a curated ecosystem.</p>`
            },
            {
                id: 'who-controls-master',
                question: 'Who controls the master contract?',
                answer: `<p>The cult executives control the master contract. This allows them to curate factories and ensure quality, protecting users from bad actors while maintaining the decentralized nature of the ecosystem.</p>`
            },
            {
                id: 'create-factory',
                question: 'How do I create a factory?',
                answer: `<p>Factories need to meet certain requirements (proper indexing, metadata handling, styling, ownership cleanliness) and get approval from cult executives. There's an application fee for factory approval. The goal is to maintain a high-quality gallery of serious creators and protect users from pump and dump schemes.</p>`
            },
            {
                id: 'create-project',
                question: 'How do I create a project?',
                answer: `<p>Browse the available factories, pick one that fits your needs, and click "Create Project". Each factory has different capabilities (ERC404 for bonding curves, ERC1155 for multi-edition NFTs, etc.). Follow the creation flow and deploy your project. Note that factories may charge fees for project creation.</p>`
            },
            {
                id: 'factory-requirements',
                question: 'What are the factory requirements?',
                answer: `<p>Factories must properly index created instances, handle metadata correctly, meet styling requirements, and follow ownership cleanliness practices (geared towards decentralization). The goal is quality curation and user protection.</p>`
            },
            {
                id: 'who-is-this-for',
                question: 'Who is this built for?',
                answer: `<p>Built for the people at stationthisbot and especially for cult executives. It's a community-driven platform that values quality, decentralization, and serious creators.</p>`
            },
            {
                id: 'is-it-free',
                question: 'What are the fees?',
                answer: `<p>There's an application fee to submit a factory for approval. Once approved, factories may charge their own fees for project creation. Creating projects also requires gas fees (standard Ethereum transaction costs). The platform itself is free to browse and use.</p>`
            },
            {
                id: 'erc404-vs-erc1155',
                question: "What's the difference between ERC404 and ERC1155?",
                answer: `<p>ERC404 combines fungible tokens with NFTs - think bonding curves, automatic NFT minting from balance, and built-in liquidity. ERC1155 is for multi-edition NFT collections where each edition can have its own price and supply. Both have their use cases.</p>`
            }
        ];
    }

    // Prevent re-render for sidebar state changes - handled via DOM
    shouldUpdate(oldState, newState) {
        if (oldState.sidebarOpen !== newState.sidebarOpen) {
            return false;
        }
        return true;
    }

    renderNavLink(href, label) {
        return h('a', {
            href,
            className: `doc-nav-link ${this.state.activeSection === href.substring(1) ? 'active' : ''}`
        }, label);
    }

    render() {
        return h('div', { className: 'documentation marble-bg' },
            h('button', {
                className: 'doc-menu-toggle',
                'data-ref': 'menu-toggle',
                'aria-label': 'Toggle navigation menu'
            }, '\u2630'),
            h('div', { className: 'doc-sidebar-overlay', 'data-ref': 'sidebar-overlay' }),

            h('div', { className: 'doc-container' },
                h('aside', { className: 'doc-sidebar', 'data-ref': 'sidebar' },
                    h('nav', { className: 'doc-nav' },
                        this.renderNavLink('#hero', 'Introduction'),
                        this.renderNavLink('#what-is', 'What is ms2.fun?'),
                        this.renderNavLink('#how-it-works', 'How it Works'),
                        this.renderNavLink('#contract-types', 'Contract Types'),
                        this.renderNavLink('#feature-matrix', 'Feature Matrix'),
                        this.renderNavLink('#factory-requirements', 'Factory Requirements'),
                        this.renderNavLink('#community', 'Community'),
                        this.renderNavLink('#faq', 'FAQ')
                    )
                ),

                h('main', { className: 'doc-content' },
                    // Hero Section
                    h('section', { id: 'hero', className: 'doc-section hero-section' },
                        h('h1', { className: 'hero-title' }, 'MS2.FUN'),
                        h('p', { className: 'hero-subtitle' },
                            'An artist enclave established through Ethereum smart contracts. Constructed for the community, dedicated to our cult executives.'
                        ),
                        h('div', { className: 'hero-cta' },
                            h('a', { href: '/', className: 'cta-button', 'data-ref': 'cta-get-started' }, 'Begin'),
                            h('a', { href: '/factories', className: 'cta-button secondary', 'data-ref': 'cta-factories' }, 'Examine Factories')
                        )
                    ),

                    // What Is Section
                    h('section', { id: 'what-is', className: 'doc-section' },
                        h('h2', null, 'What is MS2.FUN?'),
                        h('p', null, 'MS2.FUN is an artist enclave established through Ethereum smart contracts. A launchpad connected to a public master contract that maintains the registry of authorized factories.'),
                        h('p', null, 'Any individual may submit a factory for approval, and any individual may create projects using those factories. The cult executives curate factories to ensure quality and protect users, while maintaining the ecosystem open for creators.'),
                        h('p', null, 'We progress toward greater decentralization. The objective is to construct a platform where artists and creators may launch their projects with confidence, supported by quality tools and community curation.'),
                        h('p', null, 'Constructed for the stationthisbot community and dedicated to our cult executives.')
                    ),

                    // How It Works Section
                    h('section', { id: 'how-it-works', className: 'doc-section' },
                        h('h2', null, 'How It Works'),
                        h('p', null, 'The architecture is straightforward.'),
                        h('div', { className: 'how-it-works-steps' },
                            h('div', { className: 'step' },
                                h('h3', null, 'Master Contract'),
                                h('p', null, 'The master contract serves as the foundation of the operation. It maintains the registry of all authorized factories. A directory of approved tools.')
                            ),
                            h('div', { className: 'step' },
                                h('h3', null, 'Factories'),
                                h('p', null, 'Factories function as templates. Each factory may create multiple project instances. To launch an ERC404 token, there exists a factory. To create an ERC1155 collection, there exists a factory.')
                            ),
                            h('div', { className: 'step' },
                                h('h3', null, 'Instances'),
                                h('p', null, 'When one employs a factory to create a project, one creates an instance. Each instance is its own contract, its own project, its own entity.')
                            )
                        ),
                        h('p', { className: 'flow-description' },
                            h('strong', null, 'The Process:'), ' Examine factories \u2192 Select one \u2192 Create your project \u2192 Deploy it \u2192 Present it to the world.'
                        ),
                        h('p', null, 'All of this occurs on-chain, transparently. The cult executives control the master contract to ensure quality, while maintaining the ecosystem open for creators.')
                    ),

                    // Contract Types Section
                    h('section', { id: 'contract-types', className: 'doc-section' },
                        h('h2', null, 'Supported Contract Types'),
                        h('p', null, 'MS2.FUN currently supports two contract types, each with distinct capabilities and use cases. Additional contract types shall be added as the ecosystem expands.'),
                        h('div', { className: 'contract-types-grid' },
                            h('div', { className: 'contract-type-card erc404 marble-bg' },
                                h('div', { className: 'contract-type-header' },
                                    h('span', { className: 'contract-type-icon' }),
                                    h('h3', null, 'ERC404')
                                ),
                                h('p', { className: 'contract-type-description' }, 'Unifies fungible tokens with NFTs. Designed for token launches with integrated liquidity and NFT minting capabilities.'),
                                h('div', { className: 'contract-type-features' },
                                    h('h4', null, 'Key Features:'),
                                    h('ul', null,
                                        h('li', null, h('strong', null, 'Bonding Curve:'), ' Dynamic pricing mechanism for token trading'),
                                        h('li', null, h('strong', null, 'Automatic NFT Minting:'), ' NFTs mint automatically upon token holding'),
                                        h('li', null, h('strong', null, 'Merkle Tree Whitelist:'), ' Support for phased launches with whitelisting'),
                                        h('li', null, h('strong', null, 'Phase Transitions:'), ' Presale to live trading phases'),
                                        h('li', null, h('strong', null, 'On-Chain Messaging:'), ' Integrated chat feature for community interaction'),
                                        h('li', null, h('strong', null, 'Liquidity Pool Integration:'), ' Automatic liquidity pool deployment')
                                    )
                                )
                            ),
                            h('div', { className: 'contract-type-card erc1155 marble-bg' },
                                h('div', { className: 'contract-type-header' },
                                    h('span', { className: 'contract-type-icon' }),
                                    h('h3', null, 'ERC1155')
                                ),
                                h('p', { className: 'contract-type-description' }, 'Multi-edition NFT collections where each edition may possess its own price and supply. Designed for artists and creators to monetize their work.'),
                                h('div', { className: 'contract-type-features' },
                                    h('h4', null, 'Key Features:'),
                                    h('ul', null,
                                        h('li', null, h('strong', null, 'Multiple Editions:'), ' Multiple NFT types within one contract'),
                                        h('li', null, h('strong', null, 'Per-Edition Pricing:'), ' Each edition may possess its own price'),
                                        h('li', null, h('strong', null, 'Open Mint:'), ' Public minting functionality'),
                                        h('li', null, h('strong', null, 'Batch Operations:'), ' Mint or transfer multiple NFTs simultaneously'),
                                        h('li', null, h('strong', null, 'Metadata URI Support:'), ' IPFS metadata for each edition')
                                    )
                                )
                            )
                        ),
                        h('p', { className: 'contract-types-note' },
                            h('strong', null, 'Note:'), ' The platform is designed to be extensible. New contract types may be added through the factory system as the ecosystem evolves.'
                        )
                    ),

                    // Feature Matrix Section
                    h('section', { id: 'feature-matrix', className: 'doc-section' },
                        h('h2', null, 'Feature Matrix'),
                        h('p', null, 'Projects on MS2.FUN may support various features. The feature matrix system ensures that contracts declare their required features, and the website renders the appropriate UI components.'),
                        h('div', { className: 'feature-matrix-explanation' },
                            h('p', null, 'When a factory creates a project, it specifies which features that project supports. The website then determines how to display and interact with that project. This ensures compatibility between contracts and the frontend.')
                        ),
                        h('div', { className: 'features-grid' },
                            h('div', { className: 'feature-item marble-bg' },
                                h('h3', null, 'Bonding Curve'),
                                h('p', null, 'Dynamic pricing mechanism where token price changes based on supply and demand. Common in ERC404 projects.'),
                                h('span', { className: 'feature-badge erc404' }, 'ERC404')
                            ),
                            h('div', { className: 'feature-item marble-bg' },
                                h('h3', null, 'Liquidity Pool'),
                                h('p', null, 'Secondary market liquidity through automated market makers. Enables trading after initial bonding curve phase.'),
                                h('span', { className: 'feature-badge erc404' }, 'ERC404')
                            ),
                            h('div', { className: 'feature-item marble-bg' },
                                h('h3', null, 'Chat Feature'),
                                h('p', null, 'On-chain messaging system where users may leave messages linked to their transactions. Facilitates community engagement.'),
                                h('span', { className: 'feature-badge both' }, 'Both')
                            ),
                            h('div', { className: 'feature-item marble-bg' },
                                h('h3', null, 'Balance Mint Portfolio'),
                                h('p', null, 'View and manage token balances, NFT holdings, and minting history in one location.'),
                                h('span', { className: 'feature-badge erc404' }, 'ERC404')
                            ),
                            h('div', { className: 'feature-item marble-bg' },
                                h('h3', null, 'Multi-Edition Support'),
                                h('p', null, 'Support for multiple NFT editions within a single contract, each with its own pricing and metadata.'),
                                h('span', { className: 'feature-badge erc1155' }, 'ERC1155')
                            )
                        ),
                        h('p', { className: 'feature-matrix-note' },
                            h('strong', null, 'Future Features:'), ' The feature matrix is extensible. As new features are developed, they may be added to the system and supported by factories.'
                        )
                    ),

                    // Factory Requirements Section
                    h('section', { id: 'factory-requirements', className: 'doc-section' },
                        h('h2', null, 'Factory Requirements'),
                        h('p', null, 'To submit a factory, one must understand the following requirements.'),
                        h('p', null, 'To maintain ecosystem quality and protect users, factories must meet certain requirements. The cult executives review all factory applications to ensure quality and safety.'),
                        h('div', { className: 'requirements-grid' },
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'Proper Indexing'),
                                h('p', null, "Your factory must properly index all created instances. The master contract needs to know what you've created, and instances must be discoverable through the launchpad.")
                            ),
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'Metadata Handling'),
                                h('p', null, 'Metadata matters. Your factory needs to handle metadata correctly so projects can be discovered and displayed properly.')
                            ),
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'Styling Requirements'),
                                h('p', null, 'The launchpad requires visual consistency. Factories must meet styling requirements so all elements display properly and consistently.')
                            ),
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'Ownership Cleanliness'),
                                h('p', null, 'This concerns decentralization. Factories must follow best practices for ownership and control. No rug pulls, no hidden admin keys.')
                            ),
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'User Protection'),
                                h('p', null, "The objective is to protect users from pump and dump schemes and bad actors. One's factory must be designed with user safety in mind.")
                            ),
                            h('div', { className: 'requirement-item' },
                                h('h3', null, 'Quality Curation'),
                                h('p', null, "We curate a gallery of serious creators. One's factory must enable high-quality projects, not spam or low-effort clones.")
                            )
                        ),
                        h('p', { className: 'requirement-note' },
                            h('strong', null, 'Summary:'), ' To submit a factory, one must ensure it meets these requirements AND obtain approval from the cult executives. There exists an application fee for factory approval (currently 0.1 ETH).'
                        )
                    ),

                    // Community Section
                    h('section', { id: 'community', className: 'doc-section' },
                        h('h2', null, 'Community'),
                        h('p', { className: 'community-intro' },
                            h('strong', null, 'Constructed for the community')
                        ),
                        h('p', null, 'MS2.FUN was constructed for the people at stationthisbot and especially for our cult executives.'),
                        h('ul', { className: 'community-values' },
                            h('li', null, 'Quality matters'),
                            h('li', null, 'Decentralization is the objective'),
                            h('li', null, 'Serious creators are welcome'),
                            h('li', null, 'Users are protected'),
                            h('li', null, 'The community determines what thrives')
                        ),
                        h('p', { className: 'community-cta' },
                            h('strong', null, 'This is your launchpad. Make it meaningful.')
                        )
                    ),

                    // FAQ Section
                    h('section', { id: 'faq', className: 'doc-section' },
                        h('div', { 'data-ref': 'faq-container' })
                    ),

                    // Footer CTA
                    h('div', { className: 'doc-footer-cta' },
                        h('p', null, 'Ready to begin?'),
                        h('div', { className: 'hero-cta' },
                            h('a', { href: '/', className: 'cta-button', 'data-ref': 'footer-cta-home' }, 'Return to Home'),
                            h('a', { href: '/factories', className: 'cta-button secondary', 'data-ref': 'footer-cta-factories' }, 'Examine Factories')
                        )
                    )
                )
            )
        );
    }
}

export default Documentation;
