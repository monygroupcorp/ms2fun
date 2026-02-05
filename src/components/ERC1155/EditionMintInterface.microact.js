/**
 * EditionMintInterface - Microact Version
 *
 * Interface for minting editions (quantity selector, mint button, optional message).
 * Enhanced with live cost calculation and mintWithMessage support.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class EditionMintInterface extends Component {
    constructor(props = {}) {
        super(props);
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

    get edition() {
        return this.props.edition || {};
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.updateLiveCost();
    }

    async updateLiveCost() {
        try {
            const cost = await this.adapter?.calculateMintCost(this.edition.id, this.state.quantity);
            this.setState({ liveCost: cost });
        } catch (error) {
            console.error('[EditionMintInterface] Failed to calculate live cost:', error);
            this.setState({ liveCost: null });
        }
    }

    parsePrice(priceWei) {
        try {
            if (typeof window !== 'undefined' && window.ethers) {
                return parseFloat(window.ethers.utils.formatEther(priceWei));
            }
            return parseFloat(priceWei) / 1e18;
        } catch (error) {
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
            return (parseFloat(priceWei) / 1e18).toFixed(4);
        }
    }

    handleQuantityChange(e) {
        const quantity = parseInt(e.target.value) || 1;
        const maxQuantity = this.getMaxQuantity();
        const clampedQuantity = Math.max(1, Math.min(quantity, maxQuantity));
        this.setState({ quantity: clampedQuantity });
        this.updateLiveCost();
    }

    handleMessageToggle(e) {
        this.setState({ includeMessage: e.target.checked });
    }

    handleMessageInput(e) {
        // Update message directly without re-render
        this.state.message = e.target.value;
        // Update char count manually
        const charCount = this.element?.querySelector('.message-char-count');
        if (charCount) {
            const count = this.state.message.length;
            charCount.textContent = `${count}/200`;
            charCount.classList.toggle('warning', count > 180);
            charCount.classList.toggle('error', count >= 200);
        }
    }

    async handleMint() {
        try {
            this.setState({ loading: true, error: null });

            if (!walletService.isConnected()) {
                throw new Error('Please connect your wallet');
            }

            const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');

            let totalCost;
            if (this.state.liveCost) {
                totalCost = this.state.liveCost;
            } else {
                const price = BigInt(this.edition.price);
                totalCost = (price * BigInt(this.state.quantity)).toString();
            }

            let tx;

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

            if (tx && typeof tx.wait === 'function') {
                await tx.wait();
            }

            eventBus.emit('erc1155:mint:success', {
                editionId: this.edition.id,
                quantity: this.state.quantity,
                message: this.state.includeMessage ? this.state.message : null,
                txHash: tx.transactionHash || 'mock'
            });

            const mintedQuantity = this.state.quantity;
            this.setState({
                loading: false,
                quantity: 1,
                includeMessage: false,
                message: '',
                error: null,
                success: `Successfully minted ${mintedQuantity} edition${mintedQuantity > 1 ? 's' : ''}!`
            });

            this.setTimeout(() => this.setState({ success: null }), 5000);
            await this.updateLiveCost();

        } catch (error) {
            console.error('[EditionMintInterface] Mint failed:', error);
            this.setState({
                loading: false,
                error: error.message || 'Minting failed'
            });
        }
    }

    getMaxQuantity() {
        if (this.edition.maxSupply === '0') return 100;
        return parseInt(this.edition.maxSupply) - parseInt(this.edition.currentSupply);
    }

    isSoldOut() {
        return this.edition.maxSupply !== '0' &&
               BigInt(this.edition.currentSupply) >= BigInt(this.edition.maxSupply);
    }

    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;

        // Only re-render for structural changes
        const structuralKeys = ['loading', 'error', 'success', 'includeMessage', 'quantity', 'liveCost'];
        for (const key of structuralKeys) {
            if (oldState[key] !== newState[key]) return true;
        }
        return false;
    }

    render() {
        const { quantity, loading, error, success, liveCost, includeMessage, message } = this.state;
        const price = this.parsePrice(this.edition.price);
        const fallbackCost = (price * quantity).toFixed(4);
        const totalCost = liveCost ? this.formatPrice(liveCost) : fallbackCost;
        const isSoldOut = this.isSoldOut();
        const maxQuantity = this.getMaxQuantity();

        return h('div', { className: 'edition-mint-interface' },
            error && h('div', { className: 'error-message' }, error),
            success && h('div', { className: 'success-message' }, success),

            h('div', { className: 'quantity-selector' },
                h('label', null, 'Quantity:'),
                h('input', {
                    type: 'number',
                    min: '1',
                    max: maxQuantity.toString(),
                    value: quantity.toString(),
                    disabled: isSoldOut,
                    onInput: this.bind(this.handleQuantityChange)
                })
            ),

            h('div', { className: 'cost-display' },
                h('span', { className: 'label' }, 'Total Cost:'),
                h('span', { className: 'value' }, `${totalCost} ETH`),
                liveCost && h('span', { className: 'live-indicator' }, '(live)')
            ),

            h('div', { className: 'message-option' },
                h('label', { className: 'message-checkbox-label' },
                    h('input', {
                        type: 'checkbox',
                        checked: includeMessage,
                        onChange: this.bind(this.handleMessageToggle)
                    }),
                    h('span', null, 'Add message (appears in activity feed)')
                ),
                includeMessage && h('div', { className: 'message-input-wrapper' },
                    h('textarea', {
                        className: 'message-input',
                        placeholder: 'Your message (optional)',
                        maxLength: '200',
                        onInput: this.bind(this.handleMessageInput)
                    }, message),
                    h('span', {
                        className: `message-char-count ${message.length > 180 ? 'warning' : ''} ${message.length >= 200 ? 'error' : ''}`
                    }, `${message.length}/200`)
                )
            ),

            h('button', {
                className: 'mint-button',
                disabled: isSoldOut || loading,
                onClick: this.bind(this.handleMint)
            }, loading ? 'Minting...' : 'Mint Edition')
        );
    }
}

export default EditionMintInterface;
