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
        // Setup mobile menu toggle - delay slightly to ensure layout is complete
        // This is especially important on direct load/refresh
        this.setTimeout(() => {
            this.setupMobileMenu();
        }, 50);
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
                // Re-setup mobile menu to ensure it works after updates
                this.setupMobileMenu();
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

    setupMobileMenu() {
        // Use setTimeout to ensure DOM is ready
        this.setTimeout(() => {
            // Use querySelector directly with data-ref attribute
            const menuToggle = this.element?.querySelector('[data-ref="menu-toggle"]');
            const sidebar = this.element?.querySelector('[data-ref="sidebar"]');
            const overlay = this.element?.querySelector('[data-ref="sidebar-overlay"]');
            
            if (!menuToggle || !sidebar || !overlay) {
                // Retry after a short delay (but only a few times)
                if (!this._mobileMenuRetries) {
                    this._mobileMenuRetries = 0;
                }
                if (this._mobileMenuRetries < 3) {
                    this._mobileMenuRetries++;
                    this.setTimeout(() => this.setupMobileMenu(), 200);
                }
                return;
            }
            
            this._mobileMenuRetries = 0;
            
            // Check if already set up by looking for our custom data attribute
            if (menuToggle.dataset.menuSetup === 'true') {
                return; // Already set up
            }
            
            // Mark as set up
            menuToggle.dataset.menuSetup = 'true';
            
            // CRITICAL: CSS now uses left: -280px when hidden and left: 0 when active
            // This prevents the browser from calculating a right edge that causes horizontal overflow
            // The sidebar is completely off-screen when hidden (left: -280px), so it doesn't affect document width
            // When active, it slides into view (left: 0) but stays within viewport bounds
            
            // Function to position overlay below navbar and exclude hamburger/sidebar areas
            const positionOverlayBelowNavbar = () => {
                const navbar = document.getElementById('app-top-container');
                if (!navbar || !overlay) {
                    if (overlay) {
                        overlay.style.top = '0px';
                        overlay.style.left = '0px';
                        overlay.style.right = '0px';
                        overlay.style.clipPath = 'none';
                    }
                    return;
                }
                
                // Force a reflow to ensure accurate measurements
                void navbar.offsetHeight;
                
                // Get navbar height - try multiple methods for accuracy
                let navbarHeight = navbar.offsetHeight;
                if (!navbarHeight || navbarHeight === 0) {
                    const rect = navbar.getBoundingClientRect();
                    navbarHeight = rect.height;
                }
                // Fallback if still 0
                if (!navbarHeight || navbarHeight === 0) {
                    navbarHeight = navbar.scrollHeight;
                }
                
                // Position overlay to start below navbar
                overlay.style.top = `${navbarHeight}px`;
                
                // CRITICAL: Ensure overlay never exceeds viewport width
                // Set max-width to current viewport width
                overlay.style.maxWidth = `${window.innerWidth}px`;
                overlay.style.width = 'auto';
                
                // Get hamburger button - try to find it in the DOM
                // Since newMenuToggle might not be in scope yet, query for it
                let hamburgerButton = document.querySelector('.doc-menu-toggle[data-ref="menu-toggle"]');
                if (!hamburgerButton) {
                    // Fallback: try to find any hamburger button
                    hamburgerButton = document.querySelector('.doc-menu-toggle');
                }
                if (!hamburgerButton) {
                    // No hamburger button found, just position overlay below navbar
                    overlay.style.left = '0px';
                    overlay.style.right = '0px';
                    overlay.style.clipPath = 'none';
                    return;
                }
                
                // Get hamburger button position and size (relative to viewport)
                const hamburgerRect = hamburgerButton.getBoundingClientRect();
                const hamburgerTop = hamburgerRect.top;
                const hamburgerLeft = hamburgerRect.left;
                const hamburgerWidth = hamburgerRect.width;
                const hamburgerHeight = hamburgerRect.height;
                // Add padding around hamburger for exclusion area
                const hamburgerPadding = 15;
                
                // Calculate hamburger exclusion area
                // Clip-path coordinates are relative to the element (overlay), not viewport
                // Overlay starts at navbarHeight from top, so we need to adjust coordinates
                const hamburgerExcludeTop = Math.max(0, hamburgerTop - navbarHeight);
                const hamburgerExcludeLeft = hamburgerLeft;
                const hamburgerExcludeRight = hamburgerLeft + hamburgerWidth + hamburgerPadding;
                const hamburgerExcludeBottom = hamburgerTop + hamburgerHeight + hamburgerPadding - navbarHeight;
                
                // If hamburger is above overlay (in navbar area), don't exclude it (it's already above)
                const hamburgerIsAboveOverlay = hamburgerTop + hamburgerHeight < navbarHeight;
                
                const sidebarWidth = 280; // Sidebar width
                const isSidebarActive = sidebar.classList.contains('active');
                
                if (isSidebarActive) {
                    // Sidebar is open: exclude left side where sidebar is (280px)
                    const availableWidth = window.innerWidth - sidebarWidth;
                    overlay.style.left = `${sidebarWidth}px`;
                    overlay.style.right = '0px';
                    // Ensure overlay doesn't exceed viewport
                    if (availableWidth < 0) {
                        overlay.style.left = '0px';
                        overlay.style.maxWidth = `${window.innerWidth}px`;
                    } else {
                        overlay.style.maxWidth = `${availableWidth}px`;
                    }
                    // When sidebar is open, it covers the hamburger, so we just need to exclude sidebar
                    // No clip-path needed - the left positioning already excludes the sidebar
                    overlay.style.clipPath = 'none';
                } else {
                    // Sidebar is closed: overlay covers full width but exclude hamburger area
                    overlay.style.left = '0px';
                    overlay.style.right = '0px';
                    // Ensure overlay never exceeds viewport width - use calc to account for any edge cases
                    overlay.style.maxWidth = `${window.innerWidth}px`;
                    overlay.style.width = 'auto'; // Let it be determined by left/right
                    
                    // Only exclude hamburger if it's within the overlay area (below navbar)
                    if (!hamburgerIsAboveOverlay && hamburgerExcludeBottom > 0) {
                        // Exclude hamburger area in top-left corner
                        // Create a polygon that goes around the hamburger
                        overlay.style.clipPath = `polygon(
                            0% 0%,
                            ${hamburgerExcludeLeft}px 0%,
                            ${hamburgerExcludeLeft}px ${hamburgerExcludeBottom}px,
                            ${hamburgerExcludeRight}px ${hamburgerExcludeBottom}px,
                            ${hamburgerExcludeRight}px 0%,
                            100% 0%,
                            100% 100%,
                            0% 100%
                        )`;
                    } else {
                        // Hamburger is in navbar area (above overlay), no need to exclude
                        overlay.style.clipPath = 'none';
                    }
                }
            };
            
            // Toggle sidebar function
            const toggleSidebar = () => {
                const isActive = sidebar.classList.contains('active');
                // Get hamburger button (query for it to ensure we have the current element)
                const hamburgerBtn = document.querySelector('.doc-menu-toggle[data-ref="menu-toggle"]') || 
                                    document.querySelector('.doc-menu-toggle');
                
                if (isActive) {
                    sidebar.classList.remove('active');
                    overlay.classList.remove('active');
                    document.body.style.overflow = ''; // Restore scrolling
                    // Restore hamburger z-index when sidebar closes
                    if (hamburgerBtn) {
                        hamburgerBtn.style.zIndex = '1002';
                    }
                } else {
                    sidebar.classList.add('active');
                    overlay.classList.add('active');
                    document.body.style.overflow = 'hidden'; // Prevent background scrolling
                    // Lower hamburger z-index when sidebar opens so it's behind sidebar
                    if (hamburgerBtn) {
                        hamburgerBtn.style.zIndex = '998';
                    }
                }
                
                // Reposition overlay after state change to account for sidebar position
                // Use requestAnimationFrame to ensure DOM has updated
                requestAnimationFrame(() => {
                    positionOverlayBelowNavbar();
                });
            };
            
            // Close sidebar function
            const closeSidebar = () => {
                sidebar.classList.remove('active');
                overlay.classList.remove('active');
                document.body.style.overflow = ''; // Restore scrolling
                // Restore hamburger z-index when sidebar closes
                const hamburgerBtn = document.querySelector('.doc-menu-toggle[data-ref="menu-toggle"]') || 
                                    document.querySelector('.doc-menu-toggle');
                if (hamburgerBtn) {
                    hamburgerBtn.style.zIndex = '1002';
                }
            };
            
            // Menu toggle button click handler
            const handleToggleClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation(); // Prevent other handlers from firing
                toggleSidebar();
            };
            
            // Remove any existing listeners by cloning the button
            const newMenuToggle = menuToggle.cloneNode(true);
            newMenuToggle.dataset.menuSetup = 'true'; // Preserve the flag
            menuToggle.parentNode.replaceChild(newMenuToggle, menuToggle);
            
            // Position overlay initially - use multiple strategies to ensure it happens after layout
            // Strategy 1: Immediate (for navigation)
            positionOverlayBelowNavbar();
            
            // Strategy 2: After next frame (for initial load)
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    positionOverlayBelowNavbar();
                });
            });
            
            // Strategy 3: After window load (for direct load/refresh)
            if (document.readyState === 'loading') {
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        positionOverlayBelowNavbar();
                    }, 100);
                }, { once: true });
            } else {
                // Already loaded, but wait a bit for layout to settle
                setTimeout(() => {
                    positionOverlayBelowNavbar();
                }, 100);
            }
            
            // Strategy 4: On resize (navbar height might change)
            let resizeTimeout;
            const handleResizeForPositioning = () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    positionOverlayBelowNavbar();
                }, 150);
            };
            window.addEventListener('resize', handleResizeForPositioning);
            
            // Add click listener
            newMenuToggle.addEventListener('click', handleToggleClick);
            
            // Overlay click to close - use event delegation on document body
            // Since overlay has pointer-events: none, we need to detect clicks on the overlay area
            const handleDocumentClick = (e) => {
                // Only handle if sidebar is active
                if (!sidebar.classList.contains('active')) return;
                
                // Don't close if clicking on sidebar itself
                if (sidebar.contains(e.target)) return;
                
                // Don't close if clicking on hamburger button
                if (newMenuToggle.contains(e.target)) return;
                
                // Don't close if clicking on navbar
                const navbar = document.getElementById('app-top-container');
                if (navbar && navbar.contains(e.target)) return;
                
                // Get click/touch position - handle both mouse and touch events
                let clickY = 0;
                if (e.clientY !== undefined) {
                    // Mouse event
                    clickY = e.clientY;
                } else if (e.changedTouches && e.changedTouches.length > 0) {
                    // Touch event (touchend)
                    clickY = e.changedTouches[0].clientY;
                } else if (e.touches && e.touches.length > 0) {
                    // Touch event (touchstart/move)
                    clickY = e.touches[0].clientY;
                }
                
                // Check if click is within overlay area (below navbar, not on interactive elements)
                const navbarHeight = navbar ? (navbar.offsetHeight || navbar.getBoundingClientRect().height) : 0;
                
                // If click is below navbar and not on any interactive element, close sidebar
                if (clickY >= navbarHeight) {
                    // Check if click is on an interactive element (button, link, etc.)
                    const interactiveElement = e.target.closest('button, a, [role="button"], input, select, textarea');
                    
                    // Don't close if clicking on any interactive element (buttons, links, etc.)
                    // These should work normally
                    if (interactiveElement) {
                        // Check if it's a nav link (which should close sidebar)
                        if (interactiveElement.classList.contains('doc-nav-link')) {
                            // Nav links should close sidebar, but let their own handler do it
                            return;
                        }
                        // Other interactive elements should work normally, don't close
                        return;
                    }
                    
                    // Click is on overlay area (not on any interactive element), close sidebar
                    e.preventDefault();
                    e.stopPropagation();
                    closeSidebar();
                }
            };
            
            // Use both click and touchend for mobile compatibility
            // Use capture phase to catch events before they reach other handlers
            document.addEventListener('click', handleDocumentClick, true);
            document.addEventListener('touchend', handleDocumentClick, true);
            
            // Close sidebar when clicking a nav link (mobile only)
            const navLinks = sidebar.querySelectorAll('.doc-nav-link');
            navLinks.forEach(link => {
                const handleNavClick = () => {
                    // Only close on mobile (check if sidebar is active/visible)
                    if (window.innerWidth <= 968 && sidebar.classList.contains('active')) {
                        closeSidebar();
                    }
                };
                link.addEventListener('click', handleNavClick);
            });
            
            // Close sidebar on window resize if it becomes desktop view
            // Also reposition overlay if navbar height changes
            const handleResize = () => {
                if (window.innerWidth > 968) {
                    closeSidebar();
                } else {
                    // Reposition overlay on resize (navbar height might change)
                    // Use requestAnimationFrame to ensure layout has settled
                    requestAnimationFrame(() => {
                        positionOverlayBelowNavbar();
                    });
                }
            };
            
            window.addEventListener('resize', handleResize);
            
            // Register cleanup
            this.registerCleanup(() => {
                document.body.style.overflow = ''; // Restore scrolling on unmount
                window.removeEventListener('resize', handleResize);
                window.removeEventListener('resize', handleResizeForPositioning);
                document.removeEventListener('click', handleDocumentClick, true);
                document.removeEventListener('touchend', handleDocumentClick, true);
                if (resizeTimeout) {
                    clearTimeout(resizeTimeout);
                }
            });
        }, 100);
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
            <div class="documentation marble-bg">
                <button class="doc-menu-toggle" data-ref="menu-toggle" aria-label="Toggle navigation menu">☰</button>
                <div class="doc-sidebar-overlay" data-ref="sidebar-overlay"></div>
                <div class="doc-container">
                    <aside class="doc-sidebar" data-ref="sidebar">
                        <nav class="doc-nav">
                            <a href="#hero" class="doc-nav-link ${this.state.activeSection === 'hero' ? 'active' : ''}">Introduction</a>
                            <a href="#what-is" class="doc-nav-link ${this.state.activeSection === 'what-is' ? 'active' : ''}">What is ms2.fun?</a>
                            <a href="#how-it-works" class="doc-nav-link ${this.state.activeSection === 'how-it-works' ? 'active' : ''}">How it Works</a>
                            <a href="#contract-types" class="doc-nav-link ${this.state.activeSection === 'contract-types' ? 'active' : ''}">Contract Types</a>
                            <a href="#feature-matrix" class="doc-nav-link ${this.state.activeSection === 'feature-matrix' ? 'active' : ''}">Feature Matrix</a>
                            <a href="#factory-requirements" class="doc-nav-link ${this.state.activeSection === 'factory-requirements' ? 'active' : ''}">Factory Requirements</a>
                            <a href="#community" class="doc-nav-link ${this.state.activeSection === 'community' ? 'active' : ''}">Community</a>
                            <a href="#faq" class="doc-nav-link ${this.state.activeSection === 'faq' ? 'active' : ''}">FAQ</a>
                        </nav>
                    </aside>
                    
                    <main class="doc-content">
                        <section id="hero" class="doc-section hero-section">
                            <h1 class="hero-title">Welcome to ms2.fun</h1>
                            <p class="hero-subtitle">
                                An artist enclave made possible by Ethereum smart contracts. Built for the 
                                community, especially for our cult executives.
                            </p>
                            <div class="hero-cta">
                                <a href="/" class="cta-button" data-ref="cta-get-started">Get Started</a>
                                <a href="/factories" class="cta-button secondary" data-ref="cta-factories">Explore Factories</a>
                            </div>
                        </section>

                        <section id="what-is" class="doc-section">
                            <h2>What is ms2.fun?</h2>
                            <p>
                                ms2.fun is an artist enclave made possible by Ethereum smart contracts. 
                                It's a launchpad that connects to a public master contract that keeps 
                                track of authorized factories.
                            </p>
                            <p>
                                Anyone can submit a factory for approval, and anyone can create projects 
                                using those factories. The cult executives curate factories to ensure 
                                quality and protect users, while keeping the ecosystem open for creators.
                            </p>
                            <p>
                                We're working toward greater decentralization, but we're not there yet. 
                                The goal is to build a platform where artists and creators can launch 
                                their projects with confidence, supported by quality tools and community 
                                curation.
                            </p>
                            <p>
                                Built for the stationthisbot community and especially for our cult executives.
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
                                All of this happens on-chain, transparently. The cult executives control 
                                the master contract to ensure quality, while keeping the ecosystem open 
                                for creators.
                            </p>
                        </section>

                        <section id="contract-types" class="doc-section">
                            <h2>Supported Contract Types</h2>
                            <p>
                                ms2.fun currently supports two contract types, each with unique capabilities 
                                and use cases. More contract types will be added as the ecosystem grows.
                            </p>
                            
                            <div class="contract-types-grid">
                                <div class="contract-type-card erc404 marble-bg">
                                    <div class="contract-type-header">
                                        <span class="contract-type-icon">💎</span>
                                        <h3>ERC404</h3>
                                    </div>
                                    <p class="contract-type-description">
                                        Combines fungible tokens with NFTs. Perfect for token launches with 
                                        built-in liquidity and NFT minting capabilities.
                                    </p>
                                    
                                    <div class="contract-type-features">
                                        <h4>Key Features:</h4>
                                        <ul>
                                            <li><strong>Bonding Curve:</strong> Dynamic pricing mechanism for token trading</li>
                                            <li><strong>Automatic NFT Minting:</strong> NFTs mint automatically when you hold tokens</li>
                                            <li><strong>Merkle Tree Whitelist:</strong> Support for phased launches with whitelisting</li>
                                            <li><strong>Phase Transitions:</strong> Presale → Live trading phases</li>
                                            <li><strong>On-Chain Messaging:</strong> Built-in chat feature for community interaction</li>
                                            <li><strong>Liquidity Pool Integration:</strong> Automatic liquidity pool deployment</li>
                                        </ul>
                                    </div>
                                    
                                    <div class="contract-type-usecases">
                                        <h4>Best For:</h4>
                                        <ul>
                                            <li>Token launches with bonding curve</li>
                                            <li>Community tokens with NFT rewards</li>
                                            <li>NFT collections with built-in liquidity</li>
                                            <li>Gamified token projects</li>
                                        </ul>
                                    </div>
                                </div>
                                
                                <div class="contract-type-card erc1155 marble-bg">
                                    <div class="contract-type-header">
                                        <span class="contract-type-icon">🎨</span>
                                        <h3>ERC1155</h3>
                                    </div>
                                    <p class="contract-type-description">
                                        Multi-edition NFT collections where each edition can have its own 
                                        price and supply. Perfect for artists and creators to monetize their work.
                                    </p>
                                    
                                    <div class="contract-type-features">
                                        <h4>Key Features:</h4>
                                        <ul>
                                            <li><strong>Multiple Editions:</strong> Multiple NFT types in one contract</li>
                                            <li><strong>Per-Edition Pricing:</strong> Each edition can have its own price</li>
                                            <li><strong>Open Mint:</strong> Public minting functionality</li>
                                            <li><strong>Batch Operations:</strong> Mint or transfer multiple NFTs at once</li>
                                            <li><strong>Metadata URI Support:</strong> IPFS metadata for each edition</li>
                                        </ul>
                                    </div>
                                    
                                    <div class="contract-type-usecases">
                                        <h4>Best For:</h4>
                                        <ul>
                                            <li>Art collections</li>
                                            <li>Digital collectibles</li>
                                            <li>Limited edition releases</li>
                                            <li>Creator monetization</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                            
                            <p class="contract-types-note">
                                <strong>Note:</strong> The platform is designed to be extensible. New contract types 
                                can be added through the factory system as the ecosystem evolves.
                            </p>
                        </section>

                        <section id="feature-matrix" class="doc-section">
                            <h2>Feature Matrix</h2>
                            <p>
                                Projects on ms2.fun can support various features. The feature matrix system 
                                ensures that contracts declare their required features, and the website renders 
                                the appropriate UI components.
                            </p>
                            
                            <div class="feature-matrix-explanation">
                                <p>
                                    When a factory creates a project, it specifies which features that project 
                                    supports. The website then knows how to display and interact with that project. 
                                    This ensures compatibility between contracts and the frontend.
                                </p>
                            </div>
                            
                            <div class="features-grid">
                                <div class="feature-item marble-bg">
                                    <h3>Bonding Curve</h3>
                                    <p>
                                        Dynamic pricing mechanism where token price changes based on supply and demand. 
                                        Common in ERC404 projects.
                                    </p>
                                    <span class="feature-badge erc404">ERC404</span>
                                </div>
                                
                                <div class="feature-item marble-bg">
                                    <h3>Liquidity Pool</h3>
                                    <p>
                                        Secondary market liquidity through automated market makers. Enables trading 
                                        after initial bonding curve phase.
                                    </p>
                                    <span class="feature-badge erc404">ERC404</span>
                                </div>
                                
                                <div class="feature-item marble-bg">
                                    <h3>Chat Feature</h3>
                                    <p>
                                        On-chain messaging system where users can leave messages linked to their 
                                        transactions. Builds community engagement.
                                    </p>
                                    <span class="feature-badge both">Both</span>
                                </div>
                                
                                <div class="feature-item marble-bg">
                                    <h3>Balance Mint Portfolio</h3>
                                    <p>
                                        View and manage your token balances, NFT holdings, and minting history 
                                        in one place.
                                    </p>
                                    <span class="feature-badge erc404">ERC404</span>
                                </div>
                                
                                <div class="feature-item marble-bg">
                                    <h3>Multi-Edition Support</h3>
                                    <p>
                                        Support for multiple NFT editions within a single contract, each with 
                                        its own pricing and metadata.
                                    </p>
                                    <span class="feature-badge erc1155">ERC1155</span>
                                </div>
                                
                            </div>
                            
                            <p class="feature-matrix-note">
                                <strong>Future Features:</strong> The feature matrix is extensible. As new features 
                                are developed, they can be added to the system and supported by factories.
                            </p>
                        </section>

                        <section id="factory-requirements" class="doc-section">
                            <h2>Factory Requirements</h2>
                            <p>
                                Want to submit a factory? Here's what you need to know.
                            </p>
                            
                            <p>
                                To keep the ecosystem high-quality and protect users, factories need 
                                to meet certain requirements. The cult executives review all factory 
                                applications to ensure quality and safety.
                            </p>
                            
                            <div class="requirements-grid">
                                <div class="requirement-item">
                                    <h3>Proper Indexing</h3>
                                    <p>
                                        Your factory must properly index all created instances. The master 
                                        contract needs to know what you've created, and instances must be 
                                        discoverable through the launchpad.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Factory must maintain an index of all 
                                        deployed instances and report them to the master contract.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Metadata Handling</h3>
                                    <p>
                                        Metadata matters. Your factory needs to handle metadata correctly 
                                        so projects can be discovered and displayed properly. This includes 
                                        names, descriptions, images, and feature declarations.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Instances must store metadata (name, 
                                        display name, metadata URI) and support the feature matrix system.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Styling Requirements</h3>
                                    <p>
                                        We want the launchpad to look good. Factories need to meet styling 
                                        requirements so everything displays nicely and consistently.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Projects created by your factory should 
                                        work seamlessly with the launchpad UI components.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Ownership Cleanliness</h3>
                                    <p>
                                        This is about decentralization. Factories should follow best 
                                        practices for ownership and control. No rug pulls, no hidden 
                                        admin keys, no centralized control that could hurt users.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Ownership should be transparent, 
                                        preferably multi-sig or DAO-controlled. No single points of failure.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>User Protection</h3>
                                    <p>
                                        The goal is to protect users from pump and dump schemes and bad 
                                        actors. Your factory should be designed with user safety in mind.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Contracts should have safeguards against 
                                        common attack vectors and should not enable malicious behavior.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Quality Curation</h3>
                                    <p>
                                        We're curating a gallery of serious creators. Your factory should 
                                        enable high-quality projects, not spam or low-effort clones.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Factory should have mechanisms to 
                                        prevent spam and encourage quality project creation.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Name Collision Prevention</h3>
                                    <p>
                                        Factory names must be unique to prevent URL conflicts and confusion. 
                                        The master contract tracks factory names to ensure uniqueness.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Factory names are hashed and checked 
                                        against existing names before registration.
                                    </p>
                                </div>
                                
                                <div class="requirement-item">
                                    <h3>Feature Matrix Support</h3>
                                    <p>
                                        Factories must declare which features their projects support. This 
                                        ensures the website knows how to render and interact with projects.
                                    </p>
                                    <p class="requirement-detail">
                                        <strong>Technical:</strong> Factories must specify features (bonding 
                                        curve, chat, etc.) when registering with the master contract.
                                    </p>
                                </div>
                            </div>
                            
                            <div class="factory-application-process">
                                <h3>Application Process</h3>
                                <ol>
                                    <li>
                                        <strong>Consult Before Deployment:</strong> We strongly recommend 
                                        consulting with us before deploying your factory contract. This ensures 
                                        your contract meets all requirements and can help avoid issues during 
                                        the approval process. Early consultation leads to the smoothest possible 
                                        launch.
                                    </li>
                                    <li>
                                        <strong>Deploy Your Factory:</strong> Deploy your factory contract 
                                        to the Ethereum mainnet (or testnet for testing).
                                    </li>
                                    <li>
                                        <strong>Prepare Application:</strong> Gather all required information:
                                        <ul>
                                            <li>Factory contract address</li>
                                            <li>Contract type (ERC404, ERC1155, etc.)</li>
                                            <li>Factory title and display title</li>
                                            <li>Metadata URI</li>
                                            <li>List of supported features</li>
                                        </ul>
                                    </li>
                                    <li>
                                        <strong>Submit Application:</strong> Submit your factory application 
                                        through the master contract, including the application fee (currently 0.1 ETH).
                                    </li>
                                    <li>
                                        <strong>Review Process:</strong> Cult executives review your application 
                                        for compliance with requirements.
                                    </li>
                                    <li>
                                        <strong>Approval or Rejection:</strong> If approved, your factory is 
                                        registered and becomes available for project creation. If rejected, 
                                        you'll receive a reason and may be eligible for a fee refund.
                                    </li>
                                </ol>
                            </div>
                            
                            <p class="requirement-note">
                                <strong>Bottom line:</strong> If you want to submit a factory, you need to 
                                make sure it meets these requirements AND get approval from the cult executives. 
                                There's an application fee for factory approval (currently 0.1 ETH). Individual 
                                factories may also charge their own fees for project creation.
                            </p>
                            
                            <p>
                                If you're building something legit and useful, the approval process 
                                is straightforward. The goal is quality, not gatekeeping.
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

