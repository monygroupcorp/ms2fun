/**
 * EditionMintInterface Component
 * 
 * Interface for minting editions (quantity selector, mint button).
 */

import { Component } from '../../core/Component.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { eventBus } from '../../core/EventBus.js';

export class EditionMintInterface extends Component {
    constructor(edition, adapter) {
        super();
        this.edition = edition;
        this.adapter = adapter;
        this.state = {
            quantity: 1,
            loading: false,
            error: null
        };
    }

    render() {
        const price = this.parsePrice(this.edition.price);
        const totalCost = (price * this.state.quantity).toFixed(4);
        const isSoldOut = this.edition.maxSupply !== '0' && 
                         BigInt(this.edition.currentSupply) >= BigInt(this.edition.maxSupply);
        const maxQuantity = this.edition.maxSupply === '0' 
            ? 100 // Arbitrary max for unlimited
            : parseInt(this.edition.maxSupply) - parseInt(this.edition.currentSupply);

        return `
            <div class="edition-mint-interface">
                ${this.state.error ? `
                    <div class="error-message">${this.escapeHtml(this.state.error)}</div>
                ` : ''}
                <div class="quantity-selector">
                    <label>Quantity:</label>
                    <input 
                        type="number" 
                        min="1" 
                        max="${maxQuantity}" 
                        value="${this.state.quantity}"
                        ref="quantity-input"
                        ${isSoldOut ? 'disabled' : ''}
                    />
                </div>
                <div class="cost-display">
                    <span class="label">Total Cost:</span>
                    <span class="value">${totalCost} ETH</span>
                </div>
                <button 
                    class="mint-button"
                    ref="mint-button"
                    ${isSoldOut || this.state.loading ? 'disabled' : ''}
                >
                    ${this.state.loading ? 'Minting...' : 'Mint Edition'}
                </button>
            </div>
        `;
    }

    parsePrice(priceWei) {
        try {
            // Try to use ethers if available
            if (typeof window !== 'undefined' && window.ethers) {
                return parseFloat(window.ethers.utils.formatEther(priceWei));
            }
            // Fallback
            const priceEth = parseFloat(priceWei) / 1e18;
            return priceEth;
        } catch (error) {
            // Fallback calculation
            return parseFloat(priceWei) / 1e18;
        }
    }

    setupDOMEventListeners() {
        const quantityInput = this.getRef('quantity-input', 'input[type="number"]');
        if (quantityInput) {
            quantityInput.addEventListener('input', (e) => {
                const quantity = parseInt(e.target.value) || 1;
                const maxQuantity = this.edition.maxSupply === '0' 
                    ? 100
                    : parseInt(this.edition.maxSupply) - parseInt(this.edition.currentSupply);
                const clampedQuantity = Math.max(1, Math.min(quantity, maxQuantity));
                this.setState({ quantity: clampedQuantity });
            });
        }

        const mintButton = this.getRef('mint-button', '.mint-button');
        if (mintButton) {
            mintButton.addEventListener('click', () => {
                this.handleMint();
            });
        }
    }

    async handleMint() {
        try {
            this.setState({ loading: true, error: null });

            const walletService = serviceFactory.getWalletService();
            if (!walletService.isConnected()) {
                throw new Error('Please connect your wallet');
            }

            // Import ethers dynamically
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
            
            const price = BigInt(this.edition.price);
            const totalCost = price * BigInt(this.state.quantity);

            const tx = await this.adapter.mintEdition(
                this.edition.id,
                this.state.quantity,
                totalCost.toString()
            );

            // Wait for confirmation (if it's a real transaction)
            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            // Emit success event
            eventBus.emit('erc1155:mint:success', {
                editionId: this.edition.id,
                quantity: this.state.quantity,
                txHash: tx.transactionHash || 'mock'
            });

            this.setState({ loading: false, quantity: 1, error: null });

            // Refresh parent component
            if (this._parent && typeof this._parent.loadUserBalance === 'function') {
                await this._parent.loadUserBalance();
            }

            // Reload editions if parent has loadEditions method
            if (this._parent && this._parent._parent && typeof this._parent._parent.loadEditions === 'function') {
                await this._parent._parent.loadEditions();
            }
        } catch (error) {
            console.error('[EditionMintInterface] Mint failed:', error);
            this.setState({ 
                loading: false, 
                error: error.message || 'Minting failed' 
            });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

