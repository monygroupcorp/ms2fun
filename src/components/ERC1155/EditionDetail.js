/**
 * EditionDetail Component
 * 
 * Displays full detail page for an individual ERC1155 edition with minting interface.
 */

import { Component } from '../../core/Component.js';
import { EditionMintInterface } from './EditionMintInterface.js';
import { WalletDisplay } from '../WalletDisplay/WalletDisplay.js';
import { AdminButton } from '../AdminButton/AdminButton.js';
import walletService from '../../services/WalletService.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderIpfsImage, enhanceAllIpfsImages } from '../../utils/ipfsImageHelper.js';

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
                
                <div class="wallet-display-container" ref="wallet-display-container">
                    <!-- WalletDisplay will be mounted here -->
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
            backButton.addEventListener('click', () => {
                // Navigate back to project
                if (window.router) {
                    window.router.navigate(`/project/${this.projectId}`);
                } else {
                    window.location.href = `/project/${this.projectId}`;
                }
            });
        }
    }

    setupChildComponents() {
        // Mount WalletDisplay
        const walletContainer = this.getRef('wallet-display-container', '.wallet-display-container');
        if (walletContainer && !this._children.has('wallet-display')) {
            const walletDisplay = new WalletDisplay();
            const walletElement = document.createElement('div');
            walletContainer.appendChild(walletElement);
            walletDisplay.mount(walletElement);
            this.createChild('wallet-display', walletDisplay);
        }

        // Setup admin button
        this.setupAdminButton();

        if (!this.state.edition) return;

        const mintContainer = this.getRef('mint-interface', '.edition-mint-section');
        if (mintContainer) {
            const mintInterface = new EditionMintInterface(this.state.edition, this.adapter);
            const mintElement = document.createElement('div');
            mintContainer.appendChild(mintElement);
            mintInterface.mount(mintElement);
            mintInterface._parent = this; // Set parent reference for refresh
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

    onStateUpdate(oldState, newState) {
        // Setup child components when edition loads
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

