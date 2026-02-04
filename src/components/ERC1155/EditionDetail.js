/**
 * EditionDetail Component
 * 
 * Displays full detail page for an individual ERC1155 edition with minting interface.
 */

import { Component } from '../../core/Component.js';
import { EditionMintInterface } from './EditionMintInterface.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';
import { eventBus } from '../../core/EventBus.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';

export class EditionDetail extends Component {
    constructor(projectId, editionId, adapter) {
        super();
        this.projectId = projectId;
        this.editionId = editionId;
        this.adapter = adapter;
        this.state = {
            edition: null,
            userBalance: '0',
            loading: true,
            error: null
        };
    }

    async onMount() {
        await this.loadEdition();
        await this.loadUserBalance();
        await this.loadProjectStyle();

        // Listen for mint success to update supply count
        this._mintSuccessHandler = this.handleMintSuccess.bind(this);
        eventBus.on('erc1155:mint:success', this._mintSuccessHandler);
    }

    onUnmount() {
        // Clean up event listener
        if (this._mintSuccessHandler) {
            eventBus.off('erc1155:mint:success', this._mintSuccessHandler);
        }

        // Unload project-specific styles
        this.unloadProjectStyle();
    }

    /**
     * Load project-specific styles from styleUri stored on-chain
     * Uses caching to prevent flash of unstyled content on return visits
     */
    async loadProjectStyle() {
        try {
            // Check cache first for instant loading
            const cacheKey = `projectStyle:${this.projectId}`;
            const cachedUri = localStorage.getItem(cacheKey);

            // If we have a cached URI, preload it immediately (before contract call)
            if (cachedUri) {
                this._applyProjectStyle(cachedUri);
            }

            // Fetch from contract (may be same as cached, or updated)
            const styleUri = await this.adapter.getStyle().catch(() => '');

            if (styleUri && styleUri.trim()) {
                // Update cache
                localStorage.setItem(cacheKey, styleUri);

                // Apply if different from cached (or if no cache)
                if (styleUri !== cachedUri) {
                    this._applyProjectStyle(styleUri);
                }
            } else if (cachedUri) {
                // Style was removed on-chain, clear cache and styles
                localStorage.removeItem(cacheKey);
                this.unloadProjectStyle();
            }
        } catch (error) {
            console.warn('[EditionDetail] Failed to load project style:', error);
        }
    }

    /**
     * Apply project style and show content when loaded
     */
    _applyProjectStyle(styleUri) {
        console.log('[EditionDetail] Applying project style:', styleUri);
        const styleId = `project-style-${this.projectId}`;

        // Add marker class immediately to both html and body
        document.documentElement.classList.add('has-project-style');
        document.body.classList.add('has-project-style');
        document.body.setAttribute('data-project-style', this.projectId);

        // Check if already loaded (shared with EditionGallery)
        const existingLink = document.querySelector(`link[data-stylesheet-id="${styleId}"]`);
        if (existingLink) {
            // Already loaded, just mark as ready
            document.documentElement.classList.add('project-style-loaded');
            document.documentElement.classList.add('project-style-resolved');
            document.body.classList.add('project-style-loaded');
            document.body.classList.add('project-style-resolved');
        } else {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleUri.startsWith('/') || styleUri.startsWith('http') ? styleUri : '/' + styleUri;
            link.setAttribute('data-stylesheet-id', styleId);

            link.onload = () => {
                console.log('[EditionDetail] Project style loaded');
                document.documentElement.classList.add('project-style-loaded');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.add('project-style-loaded');
                document.body.classList.add('project-style-resolved');
            };

            link.onerror = () => {
                console.warn('[EditionDetail] Failed to load project style CSS');
                document.documentElement.classList.remove('has-project-style');
                document.documentElement.classList.add('project-style-resolved');
                document.body.classList.remove('has-project-style');
                document.body.classList.add('project-style-resolved');
            };

            document.head.appendChild(link);
        }

        this._projectStyleId = styleId;
    }

    /**
     * Unload project-specific styles
     */
    unloadProjectStyle() {
        if (this._projectStyleId) {
            stylesheetLoader.unload(this._projectStyleId);
            this._projectStyleId = null;

            // Remove marker classes from both html and body
            document.documentElement.classList.remove('has-project-style');
            document.documentElement.classList.remove('project-style-loaded');
            document.documentElement.classList.remove('project-style-resolved');
            document.documentElement.classList.remove('project-style-pending');
            document.body.classList.remove('has-project-style');
            document.body.classList.remove('project-style-loaded');
            document.body.classList.remove('project-style-resolved');
            document.body.classList.remove('project-style-pending');
            document.body.removeAttribute('data-project-style');
        }
    }

    async handleMintSuccess(data) {
        // Only update if this is for our edition (compare as strings)
        if (data.editionId.toString() !== this.editionId.toString()) {
            return;
        }

        // Reload edition data to get updated supply count
        // Use silent reload by not setting loading state
        try {
            const edition = await this.adapter.getEditionInfo(this.editionId);
            // Update edition without triggering re-render
            this.state.edition = edition;

            // Manually update the supply display without full re-render
            const supplyElements = this.element.querySelectorAll('.stat-card .stat-value');
            if (supplyElements.length >= 2) {
                const maxSupply = BigInt(edition.maxSupply || '0');
                const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
                supplyElements[1].textContent = supply; // Second stat is supply
            }

            // Update user balance without triggering re-render
            const address = walletService.getAddress();
            if (address) {
                const balance = await this.adapter.getBalanceForEdition(address, this.editionId);
                // Update state directly without setState to avoid re-render
                this.state.userBalance = balance;

                // Manually update the balance display if it exists
                const statLabels = this.element.querySelectorAll('.stat-card .stat-label');
                for (let i = 0; i < statLabels.length; i++) {
                    if (statLabels[i].textContent === 'You Own') {
                        const valueElement = statLabels[i].nextElementSibling;
                        if (valueElement) {
                            valueElement.textContent = balance;
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('[EditionDetail] Failed to refresh after mint:', error);
        }
    }

    async loadEdition() {
        try {
            this.setState({ loading: true, error: null });
            const edition = await this.adapter.getEditionInfo(this.editionId);
            this.setState({ edition, loading: false });
        } catch (error) {
            console.error('[EditionDetail] Failed to load edition:', error);
            this.setState({ 
                error: error.message || 'Failed to load edition information',
                loading: false 
            });
        }
    }

    async loadUserBalance() {
        try {
            const address = walletService.getAddress();
            if (address && this.state.edition) {
                const balance = await this.adapter.getBalanceForEdition(address, this.editionId);
                this.setState({ userBalance: balance });
            }
        } catch (error) {
            console.error('[EditionDetail] Failed to load user balance:', error);
        }
    }

    render() {
        if (this.state.loading) {
            return `
                <div class="edition-detail loading marble-bg">
                    <div class="loading-spinner"></div>
                    <p>Loading edition...</p>
                </div>
            `;
        }

        if (this.state.error || !this.state.edition) {
            return `
                <div class="edition-detail error marble-bg">
                    <h2>Error</h2>
                    <p>${this.escapeHtml(this.state.error || 'Edition not found')}</p>
                    <button class="back-button" ref="back-button">← Back to Project</button>
                </div>
            `;
        }

        const edition = this.state.edition;
        const imageUrl = edition.metadata?.image || 
                        edition.metadata?.image_url || 
                        '/placeholder-edition.png';
        const name = edition.metadata?.name || `Edition #${edition.id}`;
        const description = edition.metadata?.description || '';
        const price = this.formatPrice(edition.price);
        const currentSupply = BigInt(edition.currentSupply || '0');
        const maxSupply = BigInt(edition.maxSupply || '0');
        const supply = `${edition.currentSupply} / ${edition.maxSupply === '0' ? '∞' : edition.maxSupply}`;
        const isSoldOut = edition.maxSupply !== '0' && currentSupply >= maxSupply;

        return `
            <div class="edition-detail marble-bg">
                <div class="edition-header-actions">
                    <button class="back-button" ref="back-button">← Back to Project</button>
                    <div class="admin-button-container" ref="admin-button-container">
                        <!-- AdminButton will be mounted here -->
                    </div>
                </div>

                <div class="edition-detail-content">
                    <div class="edition-image-section">
                        <div class="edition-image-wrapper">
                            ${renderIpfsImage(imageUrl, name, 'edition-main-image')}
                            ${isSoldOut ? '<div class="sold-out-badge large">Sold Out</div>' : ''}
                        </div>
                    </div>
                    
                    <div class="edition-info-section">
                        <h1 class="edition-title">${this.escapeHtml(name)}</h1>
                        
                        ${description ? `
                            <div class="edition-description-full">
                                <p>${this.escapeHtml(description)}</p>
                            </div>
                        ` : ''}
                        
                        <div class="edition-stats-grid">
                            <div class="stat-card marble-bg">
                                <span class="stat-label">Price</span>
                                <span class="stat-value price">${price} ETH</span>
                            </div>
                            <div class="stat-card marble-bg">
                                <span class="stat-label">Supply</span>
                                <span class="stat-value">${supply}</span>
                            </div>
                            ${this.state.userBalance !== '0' ? `
                                <div class="stat-card marble-bg">
                                    <span class="stat-label">You Own</span>
                                    <span class="stat-value">${this.state.userBalance}</span>
                                </div>
                            ` : ''}
                            ${edition.creator ? `
                                <div class="stat-card marble-bg">
                                    <span class="stat-label">Creator</span>
                                    <span class="stat-value address">${this.formatAddress(edition.creator)}</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="edition-mint-section" ref="mint-interface">
                            <!-- EditionMintInterface will be mounted here -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    formatPrice(priceWei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                const priceEth = parseFloat(window.ethers.utils.formatEther(priceWei));
                return priceEth.toFixed(4);
            }
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        } catch (error) {
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        }
    }

    formatAddress(address) {
        if (!address) return 'N/A';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    setupDOMEventListeners() {
        const backButton = this.getRef('back-button', '.back-button');
        if (backButton) {
            backButton.addEventListener('click', async () => {
                // Navigate back to project using modern URL format
                const { navigateToProject } = await import('../../utils/navigation.js');
                await navigateToProject(this.projectId);
            });
        }
    }

    setupChildComponents() {
        // Setup admin button
        this.setupAdminButton();

        if (!this.state.edition) return;

        const mintContainer = this.getRef('mint-interface', '.edition-mint-section');
        if (mintContainer && !this._children.has('mint-interface')) {
            const mintInterface = new EditionMintInterface(this.state.edition, this.adapter);
            const mintElement = document.createElement('div');
            mintContainer.appendChild(mintElement);
            mintInterface.mount(mintElement);
            mintInterface._parent = this;
            this.createChild('mint-interface', mintInterface);
        }
        
        // Enhance IPFS images with gateway rotation
        if (this.element) {
            enhanceAllIpfsImages(this.element);
        }
    }

    async setupAdminButton() {
        try {
            // Use the adapter that's already available
            if (!this.adapter) {
                return;
            }

            const contractAddress = this.adapter.contractAddress;
            const contractType = this.adapter.contractType;

            // Create and mount AdminButton
            const container = this.getRef('admin-button-container', '.admin-button-container');
            if (container) {
                const adminButton = new AdminButton(contractAddress, contractType, this.adapter);
                const buttonElement = document.createElement('div');
                container.appendChild(buttonElement);
                adminButton.mount(buttonElement);
                this.createChild('admin-button', adminButton);
            }
        } catch (error) {
            console.warn('[EditionDetail] Error setting up admin button:', error);
        }
    }

    /**
     * Only re-render when structural state changes (edition, loading, error)
     * Skip re-render for minor updates like userBalance to preserve mounted children
     */
    shouldUpdate(oldState, newState) {
        // Always render if no old state
        if (!oldState) return true;

        // Re-render for structural changes
        if (oldState.loading !== newState.loading) return true;
        if (oldState.error !== newState.error) return true;
        if (oldState.edition !== newState.edition) return true;

        // Skip re-render for userBalance changes - update DOM directly instead
        if (oldState.userBalance !== newState.userBalance) {
            this.updateUserBalanceDisplay(newState.userBalance);
            return false;
        }

        return false;
    }

    /**
     * Update user balance display without full re-render
     */
    updateUserBalanceDisplay(balance) {
        if (!this.element) return;

        const balanceCard = this.element.querySelector('.stat-card .stat-label');
        // Find the "You Own" stat card and update it
        const statCards = this.element.querySelectorAll('.stat-card');
        for (const card of statCards) {
            const label = card.querySelector('.stat-label');
            if (label && label.textContent === 'You Own') {
                const value = card.querySelector('.stat-value');
                if (value) value.textContent = balance;
                return;
            }
        }

        // If balance > 0 and no "You Own" card exists, we'd need to add one
        // For now, just log - a full re-render would be needed to add the card
        if (balance !== '0') {
            console.log('[EditionDetail] User balance changed to', balance, 'but no card to update');
        }
    }

    onStateUpdate(oldState, newState) {
        // Setup child components when edition first loads
        if (!oldState.edition && newState.edition && !newState.loading) {
            this.setTimeout(() => {
                this.setupChildComponents();
            }, 0);
        }
        
        // Refresh user balance after minting
        if (oldState.edition && newState.edition && 
            oldState.edition.currentSupply !== newState.edition.currentSupply) {
            this.loadUserBalance();
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

