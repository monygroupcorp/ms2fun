import { Component } from '../../core/Component.js';

/**
 * HeroSection component
 * Golden plaque hero with title, subtitle, and CTA buttons
 * Features a dropdown menu for "Create" actions (Project/Vault)
 */
export class HeroSection extends Component {
    constructor() {
        super();
        this.state = {
            createMenuOpen: false
        };
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
        // Scroll to the content section below
        const contentSection = document.querySelector('.home-content-section');
        if (contentSection) {
            contentSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    render() {
        const { createMenuOpen } = this.state;

        return `
            <div class="hero-section">
                <div class="hero-plaque">
                    <h1 class="hero-title">MS2.FUN LAUNCHPAD</h1>
                    <p class="hero-subtitle">A curated platform for Web3 project discovery and interaction</p>
                    <div class="hero-buttons">
                        <a href="/about" class="cta-button documentation-button" data-ref="documentation-button">
                            Documentation
                        </a>
                        <button class="cta-button create-button" data-ref="create-button">
                            Create
                        </button>
                    </div>
                </div>
                <div class="scroll-indicator" data-ref="scroll-indicator">
                    <svg class="scroll-chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>

                <!-- Create Options Modal -->
                ${createMenuOpen ? `
                    <div class="create-modal-overlay" data-ref="modal-overlay">
                        <div class="create-modal">
                            <h2 class="modal-title">What would you like to create?</h2>
                            <div class="modal-options">
                                <a href="/factories" class="option-card" data-ref="create-project-card">
                                    <div class="option-icon">🚀</div>
                                    <h3 class="option-title">Create Project</h3>
                                    <p class="option-description">Launch a new NFT or token project using our factory templates</p>
                                </a>
                                <a href="/vaults/register" class="option-card" data-ref="create-vault-card">
                                    <div class="option-icon">💰</div>
                                    <h3 class="option-title">Create Vault</h3>
                                    <p class="option-description">Register a new vault for protocol alignment and rewards</p>
                                </a>
                            </div>
                            <button class="modal-close" data-ref="modal-close">Cancel</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupEscKeyListener();
        this.setupDOMEventListeners();
    }

    setupEscKeyListener() {
        // ESC key to close modal - only set up once
        if (!this.escKeyHandler) {
            this.escKeyHandler = (e) => {
                if (e.key === 'Escape' && this.state.createMenuOpen) {
                    this.handleCreateMenuClose();
                }
            };

            document.addEventListener('keydown', this.escKeyHandler);
            this.registerCleanup(() => {
                document.removeEventListener('keydown', this.escKeyHandler);
            });
        }
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Documentation button
        const documentationButton = this.element.querySelector('.documentation-button');
        if (documentationButton) {
            documentationButton.addEventListener('click', (e) => this.handleDocumentationClick(e));
        }

        // Create button - opens modal
        const createButton = this.element.querySelector('.create-button');
        if (createButton) {
            createButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleCreateMenuToggle();
            });
        }

        // Scroll indicator
        const scrollIndicator = this.getRef('scroll-indicator', '.scroll-indicator');
        if (scrollIndicator) {
            scrollIndicator.addEventListener('click', () => this.handleScrollIndicatorClick());
        }

        // Modal overlay click (close modal)
        const modalOverlay = this.element.querySelector('.create-modal-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                // Only close if clicking the overlay itself, not the modal content
                if (e.target === modalOverlay) {
                    this.handleCreateMenuClose();
                }
            });
        }

        // Modal close button
        const modalClose = this.element.querySelector('[data-ref="modal-close"]');
        if (modalClose) {
            modalClose.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleCreateMenuClose();
            });
        }

        // Create Project card
        const createProjectCard = this.element.querySelector('[data-ref="create-project-card"]');
        if (createProjectCard) {
            createProjectCard.addEventListener('click', (e) => this.handleCreateProjectClick(e));
        }

        // Create Vault card
        const createVaultCard = this.element.querySelector('[data-ref="create-vault-card"]');
        if (createVaultCard) {
            createVaultCard.addEventListener('click', (e) => this.handleCreateVaultClick(e));
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup all DOM listeners when state changes
        if (oldState.createMenuOpen !== newState.createMenuOpen) {
            this.setTimeout(() => {
                this.setupDOMEventListeners();
            }, 0);
        }
    }
}
