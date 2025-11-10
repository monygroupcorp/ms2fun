import { Component } from '../../core/Component.js';
import { FAQ } from './FAQ.js';

/**
 * Documentation component - Main documentation/about page
 */
export class Documentation extends Component {
    constructor() {
        super();
        this.state = {
            activeSection: 'hero'
        };
        this.scrollObserver = null;
        this.isScrolling = false; // Flag to prevent scroll spy from interfering during programmatic scrolls
        this._scrollTimeout = null; // Timeout reference for scroll completion
    }

    onMount() {
        // Setup scroll spy for navigation highlighting
        // Use setTimeout to ensure DOM is fully rendered
        this.setTimeout(() => {
            this.setupScrollSpy();
        }, 100);
        // Setup smooth scrolling using event delegation
        this.setupSmoothScrolling();
    }

    update() {
        // Call parent update first
        super.update();
        
        // Re-setup scroll spy and smooth scrolling after DOM update
        // Use setTimeout to ensure DOM is fully updated
        this.setTimeout(() => {
            if (this.mounted && this.element) {
                const sections = this.element.querySelectorAll('.doc-section[id]');
                // Only re-setup if we don't have an observer or if section count changed
                if (!this.scrollObserver || sections.length !== this._lastSectionCount) {
                    this._lastSectionCount = sections.length;
                    this.setupScrollSpy();
                }
                // Always re-setup smooth scrolling to ensure event handlers are attached
                this.setupSmoothScrolling();
            }
        }, 50);
    }

    setupScrollSpy() {
        // Disconnect existing observer if it exists
        if (this.scrollObserver) {
            this.scrollObserver.disconnect();
            this.scrollObserver = null;
        }

        if (!this.element) return;
        
        const sections = this.element.querySelectorAll('.doc-section[id]');
        
        if (sections.length === 0) return; // No sections yet
        
        this.scrollObserver = new IntersectionObserver((entries) => {
            // Don't update if we're programmatically scrolling
            if (this.isScrolling) return;
            
            // Always query fresh nav links to avoid stale references
            const navLinks = this.element.querySelectorAll('.doc-nav-link');
            if (navLinks.length === 0) return;
            
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sectionId = entry.target.id;
                    this.setState({ activeSection: sectionId });
                    
                    // Update nav link active state with fresh query
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

        sections.forEach(section => this.scrollObserver.observe(section));
        
        // Register cleanup
        this.registerCleanup(() => {
            if (this.scrollObserver) {
                this.scrollObserver.disconnect();
                this.scrollObserver = null;
            }
            if (this._scrollTimeout) {
                clearTimeout(this._scrollTimeout);
                this._scrollTimeout = null;
            }
        });
    }

    setupSmoothScrolling() {
        // Use event delegation on the nav container so it persists across updates
        const navContainer = this.element.querySelector('.doc-nav');
        if (!navContainer) return;

        // Remove any existing listener
        if (this._navClickHandler) {
            navContainer.removeEventListener('click', this._navClickHandler);
        }

        // Create new handler with proper event handling
        this._navClickHandler = (e) => {
            const link = e.target.closest('.doc-nav-link');
            if (!link) return;
            
            // Always prevent default to avoid page reload
            e.preventDefault();
            e.stopPropagation();
            
            const href = link.getAttribute('href');
            if (!href || !href.startsWith('#')) return;
            
            const targetId = href.substring(1);
            this.scrollToSection(targetId);
        };

        navContainer.addEventListener('click', this._navClickHandler, true); // Use capture phase
        
        // Register cleanup
        this.registerCleanup(() => {
            if (navContainer && this._navClickHandler) {
                navContainer.removeEventListener('click', this._navClickHandler, true);
                this._navClickHandler = null;
            }
        });

        // Setup CTA button navigation
        const ctaGetStarted = this.getRef('cta-get-started', '[data-ref="cta-get-started"]');
        const ctaFactories = this.getRef('cta-factories', '[data-ref="cta-factories"]');
        const footerCtaHome = this.getRef('footer-cta-home', '[data-ref="footer-cta-home"]');
        const footerCtaFactories = this.getRef('footer-cta-factories', '[data-ref="footer-cta-factories"]');

        if (ctaGetStarted) {
            ctaGetStarted.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/');
                } else {
                    window.location.href = '/';
                }
            });
        }

        if (ctaFactories) {
            ctaFactories.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/factories');
                } else {
                    window.location.href = '/factories';
                }
            });
        }

        if (footerCtaHome) {
            footerCtaHome.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/');
                } else {
                    window.location.href = '/';
                }
            });
        }

        if (footerCtaFactories) {
            footerCtaFactories.addEventListener('click', (e) => {
                e.preventDefault();
                if (window.router) {
                    window.router.navigate('/factories');
                } else {
                    window.location.href = '/factories';
                }
            });
        }
    }

    scrollToSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (!section) {
            console.warn(`Section with id "${sectionId}" not found`);
            return;
        }

        // Clear any existing timeout
        if (this._scrollTimeout) {
            clearTimeout(this._scrollTimeout);
            this._scrollTimeout = null;
        }

        // Set flag to prevent scroll spy from interfering
        this.isScrolling = true;
        
        // Update URL hash without causing page reload
        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', `#${sectionId}`);
        }
        
        // Update active state immediately so highlighting works right away
        this.setState({ activeSection: sectionId });
        
        // Wait for DOM update to complete before scrolling
        // Use double requestAnimationFrame to ensure render has completed
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // Re-query the section in case DOM changed
                const updatedSection = document.getElementById(sectionId);
                if (updatedSection) {
                    // Use scrollIntoView for reliable scrolling
                    updatedSection.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                        inline: 'nearest'
                    });
                }
            });
        });
        
        // Re-enable scroll spy after scroll completes
        this._scrollTimeout = window.setTimeout(() => {
            this.isScrolling = false;
            this._scrollTimeout = null;
        }, 1000); // Give enough time for smooth scroll to complete
    }

    render() {
        const faqs = this.getFAQs();
        
        return `
            <div class="documentation">
                <div class="doc-container">
                    <aside class="doc-sidebar">
                        <nav class="doc-nav">
                            <a href="#hero" class="doc-nav-link ${this.state.activeSection === 'hero' ? 'active' : ''}">Introduction</a>
                            <a href="#what-is" class="doc-nav-link ${this.state.activeSection === 'what-is' ? 'active' : ''}">What is ms2.fun?</a>
                            <a href="#how-it-works" class="doc-nav-link ${this.state.activeSection === 'how-it-works' ? 'active' : ''}">How it Works</a>
                            <a href="#decentralization" class="doc-nav-link ${this.state.activeSection === 'decentralization' ? 'active' : ''}">Decentralization</a>
                            <a href="#factory-requirements" class="doc-nav-link ${this.state.activeSection === 'factory-requirements' ? 'active' : ''}">Factory Requirements</a>
                            <a href="#community" class="doc-nav-link ${this.state.activeSection === 'community' ? 'active' : ''}">Community</a>
                            <a href="#faq" class="doc-nav-link ${this.state.activeSection === 'faq' ? 'active' : ''}">FAQ</a>
                        </nav>
                    </aside>
                    
                    <main class="doc-content">
                        <section id="hero" class="doc-section hero-section">
                            <h1 class="hero-title">Welcome to ms2.fun</h1>
                            <p class="hero-subtitle">
                                A fully decentralized launchpad for Web3 projects. Built for the community, 
                                by the community, especially for our cult executives.
                            </p>
                            <div class="hero-cta">
                                <a href="/" class="cta-button" data-ref="cta-get-started">Get Started</a>
                                <a href="/factories" class="cta-button secondary" data-ref="cta-factories">Explore Factories</a>
                            </div>
                        </section>

                        <section id="what-is" class="doc-section">
                            <h2>What is ms2.fun?</h2>
                            <p>
                                ms2.fun is a launchpad, but not your average launchpad! 
                                It's fully decentralized (as decentralized as we can make it, anyway). 
                                The frontend lives on GitHub (soon IPFS - even more decentralized!), 
                                and it connects to a public master contract that keeps track of all 
                                the factories.
                            </p>
                            <p>
                                Here's the thing: anyone can submit a factory, and anyone can 
                                create collections using those factories. It's permissionless 
                                creation in a curated ecosystem. Think of it like an open art gallery 
                                where the community decides what gets featured, but the cult executives 
                                make sure the quality stays high.
                            </p>
                            <p>
                                Built for the stationthisbot community and especially for 
                                our cult executives. This is your platform, your ecosystem, your 
                                launchpad.
                            </p>
                        </section>

                        <section id="how-it-works" class="doc-section">
                            <h2>How it Works</h2>
                            <p>It's simpler than it sounds.</p>
                            
                            <div class="how-it-works-steps">
                                <div class="step">
                                    <h3>Master Contract</h3>
                                    <p>
                                        The master contract is the brain of the operation. It keeps track 
                                        of all authorized factories. Think of it like a directory of 
                                        approved tools.
                                    </p>
                                </div>
                                
                                <div class="step">
                                    <h3>Factories</h3>
                                    <p>
                                        Factories are like templates. Each factory can create multiple 
                                        project instances. Want to launch an ERC404 token? There's a 
                                        factory for that. Want to create an ERC1155 collection? There's 
                                        a factory for that too.
                                    </p>
                                </div>
                                
                                <div class="step">
                                    <h3>Instances</h3>
                                    <p>
                                        When you use a factory to create a project, you're creating an 
                                        "instance". Each instance is its own contract, its own project, 
                                        its own thing.
                                    </p>
                                </div>
                            </div>
                            
                            <p class="flow-description">
                                <strong>The flow:</strong> Browse factories → Pick one → Create your project → 
                                Deploy it → Share it with the world.
                            </p>
                            
                            <p>
                                All of this happens on-chain, transparently, and with minimal 
                                centralization. The cult executives control the master contract 
                                to ensure quality, but everything else is open and permissionless.
                            </p>
                        </section>

                        <section id="decentralization" class="doc-section">
                            <h2>Decentralization</h2>
                            <p>We're decentralized. Really decentralized.</p>
                            
                            <div class="decentralization-checklist">
                                <div class="check-item">
                                    <span class="check-icon">✓</span>
                                    <div>
                                        <strong>Frontend:</strong> Statically hosted (GitHub now, IPFS soon)
                                    </div>
                                </div>
                                <div class="check-item">
                                    <span class="check-icon">✓</span>
                                    <div>
                                        <strong>Master Contract:</strong> Public, on-chain, transparent
                                    </div>
                                </div>
                                <div class="check-item">
                                    <span class="check-icon">✓</span>
                                    <div>
                                        <strong>Factories:</strong> Anyone can submit (with approval)
                                    </div>
                                </div>
                                <div class="check-item">
                                    <span class="check-icon">✓</span>
                                    <div>
                                        <strong>Projects:</strong> Anyone can create
                                    </div>
                                </div>
                                <div class="check-item">
                                    <span class="check-icon">✓</span>
                                    <div>
                                        <strong>Fees:</strong> Application fee for factory approval, plus gas costs. Individual factories may charge their own fees.
                                    </div>
                                </div>
                            </div>
                            
                            <p>
                                The only thing that's not fully decentralized? The master contract 
                                control. But that's by design. The cult executives curate factories 
                                to protect you from:
                            </p>
                            
                            <ul class="protection-list">
                                <li>Pump and dump schemes</li>
                                <li>Scam projects</li>
                                <li>Low-quality spam</li>
                            </ul>
                            
                            <p>
                                Think of it like a quality filter. The ecosystem is open, but we 
                                make sure the tools you're using are legit and the creators are 
                                serious about their projects.
                            </p>
                            
                            <p class="highlight-box">
                                It's the best of both worlds: permissionless creation with quality 
                                curation.
                            </p>
                        </section>

                        <section id="factory-requirements" class="doc-section">
                            <h2>Factory Requirements</h2>
                            <p>
                                Want to submit a factory? Here's what you need to know.
                            </p>
                            
                            <p>
                                To keep the ecosystem high-quality and protect users, factories need 
                                to meet certain requirements:
                            </p>
                            
                            <div class="requirements-grid">
                                <div class="requirement-item">
                                    <h3>Proper Indexing</h3>
                                    <p>
                                        Your factory must properly index all created instances. The master 
                                        contract needs to know what you've created.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Metadata Handling</h3>
                                    <p>
                                        Metadata matters. Your factory needs to handle metadata correctly 
                                        so projects can be discovered and displayed properly.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Styling Requirements</h3>
                                    <p>
                                        We want the launchpad to look good. Factories need to meet styling 
                                        requirements so everything displays nicely.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Ownership Cleanliness</h3>
                                    <p>
                                        This is about decentralization. Factories should follow best 
                                        practices for ownership and control. No rug pulls, no hidden 
                                        admin keys, no centralized control that could hurt users.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>User Protection</h3>
                                    <p>
                                        The goal is to protect users from pump and dump schemes and bad 
                                        actors. Your factory should be designed with user safety in mind.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Quality Curation</h3>
                                    <p>
                                        We're curating a gallery of serious creators. Your factory should 
                                        enable high-quality projects, not spam or low-effort clones.
                                    </p>
                                </div>
                            </div>
                            
                            <p class="requirement-note">
                                Bottom line: If you want to submit a factory, you need to make sure 
                                it meets these requirements AND get approval from the cult executives. 
                                There's an application fee for factory approval. Individual factories 
                                may also charge their own fees for project creation.
                            </p>
                            
                            <p>
                                If you're building something legit and useful, the approval process 
                                is straightforward.
                            </p>
                        </section>

                        <section id="community" class="doc-section">
                            <h2>Community</h2>
                            <p class="community-intro">
                                <strong>Built for the community</strong>
                            </p>
                            
                            <p>
                                ms2.fun was built for the people at stationthisbot and 
                                especially for our cult executives.
                            </p>
                            
                            <p>
                                This is a community-driven ecosystem where:
                            </p>
                            
                            <ul class="community-values">
                                <li>Quality matters</li>
                                <li>Decentralization is the goal</li>
                                <li>Serious creators are welcome</li>
                                <li>Users are protected</li>
                                <li>The community decides what thrives</li>
                            </ul>
                            
                            <p>
                                The cult executives control the master contract, which means they 
                                curate what factories get approved. This isn't about gatekeeping 
                                for the sake of it - it's about maintaining quality and protecting 
                                the community from bad actors.
                            </p>
                            
                            <p>
                                Want to be part of it? Create a project. Want to contribute a 
                                factory? Make sure it meets the requirements and reach out. Want 
                                to just browse and discover cool projects? You're in the right place.
                            </p>
                            
                            <p class="community-cta">
                                <strong>This is your launchpad. Make it awesome.</strong>
                            </p>
                        </section>

                        <section id="faq" class="doc-section">
                            <div data-ref="faq-container">
                                <!-- FAQ component will be mounted here -->
                            </div>
                        </section>

                        <div class="doc-footer-cta">
                            <p>Ready to get started?</p>
                            <div class="hero-cta">
                                <a href="/" class="cta-button" data-ref="footer-cta-home">Back to Home</a>
                                <a href="/factories" class="cta-button secondary" data-ref="footer-cta-factories">Explore Factories</a>
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setTimeout(() => {
            this.setupFAQ();
        }, 0);
    }

    setupFAQ() {
        const faqContainer = this.getRef('faq-container', '[data-ref="faq-container"]');
        if (!faqContainer) return;

        const faqs = this.getFAQs();
        const faqComponent = new FAQ(faqs);
        faqComponent.mount(faqContainer);
        this.createChild('faq', faqComponent);
    }

    getFAQs() {
        return [
            {
                id: 'what-is',
                question: 'What is ms2.fun?',
                answer: `
                    <p>ms2.fun is a fully decentralized launchpad for Web3 projects. It's 
                    statically hosted (GitHub, soon IPFS), connects to a public master contract, 
                    and lets anyone create factories and collections. It's an emergent ecosystem 
                    built for the community, especially the cult executives.</p>
                `
            },
            {
                id: 'how-does-it-work',
                question: 'How does it work?',
                answer: `
                    <p>The master contract indexes authorized factories. Anyone can submit 
                    a factory (though they need to meet requirements and get approval from cult 
                    executives). Once a factory is authorized, anyone can use it to create project 
                    instances. It's permissionless creation within a curated ecosystem.</p>
                `
            },
            {
                id: 'is-it-decentralized',
                question: 'Is it really decentralized?',
                answer: `
                    <p>As decentralized as possible! The frontend is statically hosted 
                    (GitHub now, IPFS soon), the master contract is public, factories can be 
                    submitted by anyone, and collections can be created by anyone. The only 
                    centralized aspect is the master contract control (by cult executives) to 
                    ensure quality and protect users.</p>
                `
            },
            {
                id: 'who-controls-master',
                question: 'Who controls the master contract?',
                answer: `
                    <p>The cult executives control the master contract. This allows them to 
                    curate factories and ensure quality, protecting users from bad actors while 
                    maintaining the decentralized nature of the ecosystem.</p>
                `
            },
            {
                id: 'create-factory',
                question: 'How do I create a factory?',
                answer: `
                    <p>Factories need to meet certain requirements (proper indexing, metadata 
                    handling, styling, ownership cleanliness) and get approval from cult executives. 
                    There's an application fee for factory approval. The goal is to maintain a 
                    high-quality gallery of serious creators and protect users from pump and dump schemes.</p>
                `
            },
            {
                id: 'create-project',
                question: 'How do I create a project?',
                answer: `
                    <p>Browse the available factories, pick one that fits your needs, and 
                    click "Create Project". Each factory has different capabilities (ERC404 for 
                    bonding curves, ERC1155 for multi-edition NFTs, etc.). Follow the creation 
                    flow and deploy your project. Note that factories may charge fees for project creation.</p>
                `
            },
            {
                id: 'factory-requirements',
                question: 'What are the factory requirements?',
                answer: `
                    <p>Factories must properly index created instances, handle metadata 
                    correctly, meet styling requirements, and follow ownership cleanliness 
                    practices (geared towards decentralization). The goal is quality curation 
                    and user protection.</p>
                `
            },
            {
                id: 'who-is-this-for',
                question: 'Who is this built for?',
                answer: `
                    <p>Built for the people at stationthisbot and especially for 
                    cult executives. It's a community-driven platform that values quality, 
                    decentralization, and serious creators.</p>
                `
            },
            {
                id: 'is-it-free',
                question: 'What are the fees?',
                answer: `
                    <p>There's an application fee to submit a factory for approval. Once approved, 
                    factories may charge their own fees for project creation. Creating projects also 
                    requires gas fees (standard Ethereum transaction costs). The platform itself is 
                    free to browse and use.</p>
                `
            },
            {
                id: 'erc404-vs-erc1155',
                question: "What's the difference between ERC404 and ERC1155?",
                answer: `
                    <p>ERC404 combines fungible tokens with NFTs - think bonding curves, 
                    automatic NFT minting from balance, and built-in liquidity. ERC1155 is for 
                    multi-edition NFT collections where each edition can have its own price and 
                    supply. Both have their use cases.</p>
                `
            }
        ];
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

