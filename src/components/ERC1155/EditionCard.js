/**
 * EditionCard Component
 * 
 * Displays individual edition with image, price, supply, and mint button.
 */

import { Component } from '../../core/Component.js';
import { EditionMintInterface } from './EditionMintInterface.js';
import serviceFactory from '../../services/ServiceFactory.js';

export class EditionCard extends Component {
    constructor(edition, adapter) {
        super();
        this.edition = edition;
        this.adapter = adapter;
        this.state = {
            userBalance: '0',
            loading: false
        };
    }

    async onMount() {
        await this.loadUserBalance();
    }

    async loadUserBalance() {
        try {
            const walletService = serviceFactory.getWalletService();
            const address = walletService.getAddress();
            if (address) {
                const balance = await this.adapter.getBalanceForEdition(address, this.edition.id);
                this.setState({ userBalance: balance });
            }
        } catch (error) {
            console.error('[EditionCard] Failed to load user balance:', error);
        }
    }

    render() {
        const imageUrl = this.edition.metadata?.image || 
                        this.edition.metadata?.image_url || 
                        '/placeholder-edition.png';
        const name = this.edition.metadata?.name || `Edition #${this.edition.id}`;
        const description = this.edition.metadata?.description || '';
        const price = this.formatPrice(this.edition.price);
        const currentSupply = BigInt(this.edition.currentSupply || '0');
        const maxSupply = BigInt(this.edition.maxSupply || '0');
        const supply = `${this.edition.currentSupply} / ${this.edition.maxSupply === '0' ? '∞' : this.edition.maxSupply}`;
        const isSoldOut = this.edition.maxSupply !== '0' && 
                         currentSupply >= maxSupply;

        return `
            <div class="edition-card" data-edition-id="${this.edition.id}">
                <div class="edition-image">
                    <img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(name)}" loading="lazy" />
                    ${isSoldOut ? '<div class="sold-out-badge">Sold Out</div>' : ''}
                </div>
                <div class="edition-info">
                    <h3 class="edition-name">${this.escapeHtml(name)}</h3>
                    ${description ? `<p class="edition-description">${this.escapeHtml(description)}</p>` : ''}
                    <div class="edition-stats">
                        <div class="stat">
                            <span class="stat-label">Price:</span>
                            <span class="stat-value">${price} ETH</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Supply:</span>
                            <span class="stat-value">${supply}</span>
                        </div>
                        ${this.state.userBalance !== '0' ? `
                            <div class="stat">
                                <span class="stat-label">You own:</span>
                                <span class="stat-value">${this.state.userBalance}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="edition-actions" ref="mint-interface">
                    <!-- EditionMintInterface will be mounted here -->
                </div>
            </div>
        `;
    }

    formatPrice(priceWei) {
        try {
            // Try to use ethers if available globally
            if (typeof window !== 'undefined' && window.ethers) {
                const priceEth = parseFloat(window.ethers.utils.formatEther(priceWei));
                return priceEth.toFixed(4);
            }
            // Fallback calculation
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        } catch (error) {
            // Fallback if ethers not available
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth.toFixed(4);
        }
    }

    setupChildComponents() {
        const mintContainer = this.getRef('mint-interface', '.edition-actions');
        if (mintContainer) {
            const mintInterface = new EditionMintInterface(this.edition, this.adapter);
            const mintElement = document.createElement('div');
            mintContainer.appendChild(mintElement);
            mintInterface.mount(mintElement);
            mintInterface._parent = this; // Set parent reference
            this.createChild('mint-interface', mintInterface);
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

