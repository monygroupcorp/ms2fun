/**
 * EditionMintInterface Component
 *
 * Interface for minting editions (quantity selector, mint button, optional message).
 * Enhanced with live cost calculation and mintWithMessage support.
 */

import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import { eventBus } from '../../core/EventBus.js';

export class EditionMintInterface extends Component {
    constructor(edition, adapter) {
        super();
        this.edition = edition;
        this.adapter = adapter;
        this.state = {
            quantity: 1,
            loading: false,
            error: null,
            success: null,
            liveCost: null,
            includeMessage: false,
            message: ''
        };
    }

    async onMount() {
        await this.updateLiveCost();
    }

    async updateLiveCost() {
        try {
            const cost = await this.adapter.calculateMintCost(this.edition.id, this.state.quantity);
            this.setState({ liveCost: cost });
        } catch (error) {
            console.error('[EditionMintInterface] Failed to calculate live cost:', error);
            // Fallback to static calculation
            this.setState({ liveCost: null });
        }
    }

    render() {
        const price = this.parsePrice(this.edition.price);
        const fallbackCost = (price * this.state.quantity).toFixed(4);

        // Use live cost if available, otherwise fallback
        const totalCost = this.state.liveCost
            ? this.formatPrice(this.state.liveCost)
            : fallbackCost;

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
                ${this.state.success ? `
                    <div class="success-message">${this.escapeHtml(this.state.success)}</div>
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
                    ${this.state.liveCost ? '<span class="live-indicator">(live)</span>' : ''}
                </div>
                <div class="message-option">
                    <label class="message-checkbox-label">
                        <input
                            type="checkbox"
                            ref="message-checkbox"
                            ${this.state.includeMessage ? 'checked' : ''}
                        />
                        <span>Add message (appears in activity feed)</span>
                    </label>
                    ${this.state.includeMessage ? `
                        <div class="message-input-wrapper">
                            <textarea
                                class="message-input"
                                ref="message-input"
                                placeholder="Your message (optional)"
                                maxlength="200"
                            >${this.escapeHtml(this.state.message)}</textarea>
                            <span class="message-char-count ${this.state.message.length > 180 ? 'warning' : ''} ${this.state.message.length >= 200 ? 'error' : ''}">${this.state.message.length}/200</span>
                        </div>
                    ` : ''}
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

    setupDOMEventListeners() {
        const quantityInput = this.getRef('quantity-input', 'input[type="number"]');
        if (quantityInput) {
            quantityInput.addEventListener('input', async (e) => {
                const quantity = parseInt(e.target.value) || 1;
                const maxQuantity = this.edition.maxSupply === '0'
                    ? 100
                    : parseInt(this.edition.maxSupply) - parseInt(this.edition.currentSupply);
                const clampedQuantity = Math.max(1, Math.min(quantity, maxQuantity));
                this.setState({ quantity: clampedQuantity });

                // Update live cost when quantity changes
                await this.updateLiveCost();
            });
        }

        const messageCheckbox = this.getRef('message-checkbox', 'input[type="checkbox"]');
        if (messageCheckbox) {
            messageCheckbox.addEventListener('change', (e) => {
                this.setState({ includeMessage: e.target.checked });
            });
        }

        const messageInput = this.getRef('message-input', '.message-input');
        if (messageInput) {
            messageInput.addEventListener('input', (e) => {
                // Update state directly without triggering re-render to prevent focus loss
                this.state.message = e.target.value;
                // Update character count if present
                this.updateMessageCharCount();
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

            if (!walletService.isConnected()) {
                throw new Error('Please connect your wallet');
            }

            // Import ethers dynamically
            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            // Use live cost if available, otherwise calculate
            let totalCost;
            if (this.state.liveCost) {
                totalCost = this.state.liveCost;
            } else {
                const price = BigInt(this.edition.price);
                totalCost = (price * BigInt(this.state.quantity)).toString();
            }

            let tx;

            // Use mintWithMessage if message is provided
            if (this.state.includeMessage && this.state.message.trim()) {
                tx = await this.adapter.mintWithMessage(
                    this.edition.id,
                    this.state.quantity,
                    this.state.message.trim()
                );
            } else {
                tx = await this.adapter.mintEdition(
                    this.edition.id,
                    this.state.quantity,
                    totalCost
                );
            }

            // Wait for confirmation (if it's a real transaction)
            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            // Emit success event
            eventBus.emit('erc1155:mint:success', {
                editionId: this.edition.id,
                quantity: this.state.quantity,
                message: this.state.includeMessage ? this.state.message : null,
                txHash: tx.transactionHash || 'mock'
            });

            this.setState({
                loading: false,
                quantity: 1,
                includeMessage: false,
                message: '',
                error: null,
                success: `Successfully minted ${this.state.quantity} edition${this.state.quantity > 1 ? 's' : ''}!`
            });

            // Clear success message after 5 seconds
            this.setTimeout(() => {
                this.setState({ success: null });
            }, 5000);

            // Update live cost for new quantity
            await this.updateLiveCost();

            // Note: Don't reload parent components here as it causes unmounting
            // Parent components should listen for 'erc1155:mint:success' event to update themselves
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

    /**
     * Update message character count without triggering full re-render
     */
    updateMessageCharCount() {
        const charCount = this.element?.querySelector('.message-char-count');
        if (charCount) {
            const count = this.state.message.length;
            charCount.textContent = `${count}/200`;
            charCount.classList.toggle('warning', count > 180);
            charCount.classList.toggle('error', count >= 200);
        }
    }

    /**
     * Override shouldUpdate to prevent re-renders when only message text changes
     * Message text changes are handled directly via updateMessageCharCount
     */
    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;

        // Allow update for structural changes (loading, error, success, includeMessage, quantity)
        // but NOT for message text changes alone
        const structuralKeys = ['loading', 'error', 'success', 'includeMessage', 'quantity', 'liveCost'];
        for (const key of structuralKeys) {
            if (oldState[key] !== newState[key]) {
                return true;
            }
        }

        // If only message changed, don't re-render (handled by updateMessageCharCount)
        return false;
    }
}
