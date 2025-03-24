import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';

export class MintModal extends Component {
    constructor(maxMintable, blockchainService) {
        super();
        this.maxMintable = maxMintable;
        this.blockchainService = blockchainService;
        this.mintAmount = 1;
        this.isVisible = false;
        
        // Initialize message popup
        this.messagePopup = new MessagePopup('status-message');
        this.messagePopup.initialize();
        
        // Bind methods
        this.handleClose = this.handleClose.bind(this);
        this.handleIncrement = this.handleIncrement.bind(this);
        this.handleDecrement = this.handleDecrement.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleMint = this.handleMint.bind(this);
        this.handleTransactionEvents = this.handleTransactionEvents.bind(this);
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
    }

    show() {
        this.isVisible = true;
        this.element.style.display = 'block';
    }

    hide() {
        this.isVisible = false;
        this.element.style.display = 'none';
    }

    handleIncrement() {
        if (this.mintAmount < this.maxMintable) {
            this.mintAmount++;
            this.updateMintAmount();
        }
    }

    handleDecrement() {
        if (this.mintAmount > 1) {
            this.mintAmount--;
            this.updateMintAmount();
        }
    }

    handleInputChange(event) {
        let value = parseInt(event.target.value) || 0;
        value = Math.max(1, Math.min(value, this.maxMintable));
        this.mintAmount = value;
        this.updateMintAmount();
    }

    updateMintAmount() {
        const input = this.element.querySelector('.mint-amount-input');
        if (input) {
            input.value = this.mintAmount;
        }
    }

    handleTransactionEvents(event) {
        // Check if this is a transaction event
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        const mintButton = this.element.querySelector('.confirm-mint-button');

        // For transaction events
        if (event.type === 'mint') {
            if (mintButton) {
                mintButton.textContent = 'Waiting for confirmation...';
            }
            this.messagePopup.info(
                `Minting ${this.mintAmount} NFT${this.mintAmount > 1 ? 's' : ''}. Please confirm in your wallet...`,
                'Transaction Pending'
            );
        }

        // For confirmed transactions
        if (event.hash) {
            if (mintButton) {
                mintButton.textContent = 'Transaction Processing...';
            }
            this.messagePopup.info(
                `Transaction confirmed, minting in progress...`,
                'Transaction Confirmed'
            );
        }

        // For successful transactions
        if (event.receipt) {
            this.messagePopup.success(
                `Successfully minted ${this.mintAmount} NFT${this.mintAmount > 1 ? 's' : ''}!`,
                'Transaction Complete'
            );
            
            // Hide the mint modal
            this.hide();
            
            // Close portfolio and reopen it fresh
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');
            
            // Reset button state (in case modal is reopened)
            if (mintButton) {
                mintButton.disabled = false;
                mintButton.textContent = 'Mint NFTs';
            }
        }

        // For error transactions
        if (event.error) {
            const errorMessage = event.error?.message || 'Transaction failed';
            this.messagePopup.error(
                errorMessage,
                'Transaction Failed'
            );
            
            // Reset button state
            if (mintButton) {
                mintButton.disabled = false;
                mintButton.textContent = 'Mint NFTs';
            }
        }
    }

    async handleMint() {
        try {
            const mintButton = this.element.querySelector('.confirm-mint-button');
            mintButton.disabled = true;
            mintButton.textContent = 'Preparing Transaction...';

            // Call blockchain service to perform mint
            await this.blockchainService.balanceMint(this.mintAmount);
            
            // Note: Success/error handling will come through the event system
        } catch (error) {
            console.error('Minting failed:', error);
            // Don't emit event here, just pass to handler
            this.handleTransactionEvents({ error });
        }
    }

    handleClose() {
        this.hide();
    }

    mount(container) {
        super.mount(container);
        this.setupEventListeners();
        
        // Subscribe to transaction events
        eventBus.on('transaction:pending', this.handleTransactionEvents);
        eventBus.on('transaction:confirmed', this.handleTransactionEvents);
        eventBus.on('transaction:success', this.handleTransactionEvents);
        eventBus.on('transaction:error', this.handleTransactionEvents);
        
        // Hide initially after mounting
        this.hide();
    }

    unmount() {
        // Unsubscribe from transaction events
        eventBus.off('transaction:pending', this.handleTransactionEvents);
        eventBus.off('transaction:confirmed', this.handleTransactionEvents);
        eventBus.off('transaction:success', this.handleTransactionEvents);
        eventBus.off('transaction:error', this.handleTransactionEvents);
        
        super.unmount();
    }

    setupEventListeners() {
        // Setup event listeners
        const closeButton = this.element.querySelector('.mint-modal-close');
        const overlay = this.element.querySelector('.mint-modal-overlay');
        const incrementButton = this.element.querySelector('.increment-button');
        const decrementButton = this.element.querySelector('.decrement-button');
        const amountInput = this.element.querySelector('.mint-amount-input');
        const mintButton = this.element.querySelector('.confirm-mint-button');
        
        closeButton?.addEventListener('click', this.handleClose);
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.handleClose();
        });
        incrementButton?.addEventListener('click', this.handleIncrement);
        decrementButton?.addEventListener('click', this.handleDecrement);
        amountInput?.addEventListener('input', this.handleInputChange);
        mintButton?.addEventListener('click', this.handleMint);
    }

    render() {
        return `
            <div class="mint-modal-overlay">
                <div class="mint-modal">
                    <button class="mint-modal-close">&times;</button>
                    <div class="mint-modal-content">
                        <h2>Mint NFTs</h2>
                        <p>You can mint up to ${this.maxMintable} NFTs</p>
                        <div class="mint-amount-controls">
                            <button class="decrement-button">-</button>
                            <input type="number" 
                                   class="mint-amount-input" 
                                   value="${this.mintAmount}"
                                   min="1"
                                   max="${this.maxMintable}">
                            <button class="increment-button">+</button>
                        </div>
                        <div class="mint-error" style="display: none;"></div>
                        <button class="confirm-mint-button">
                            Mint NFTs
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    static get styles() {
        return `
            .mint-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.85);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1100;
            }

            .mint-modal {
                background-color: #111;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 400px;
            }

            .mint-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: white;
            }

            .mint-modal-content {
                text-align: center;
            }

            .mint-amount-controls {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 16px;
                margin: 24px 0;
            }

            .mint-amount-input {
                width: 80px;
                padding: 8px;
                text-align: center;
                background: #222;
                border: 1px solid #333;
                border-radius: 4px;
                color: white;
            }

            .increment-button,
            .decrement-button {
                padding: 8px 16px;
                background: #333;
                border: none;
                border-radius: 4px;
                color: white;
                cursor: pointer;
                font-size: 18px;
            }

            .confirm-mint-button {
                background: #00ff00;
                color: black;
                border: none;
                padding: 12px 24px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                width: 100%;
                margin-top: 16px;
            }

            .confirm-mint-button:disabled {
                background: #666;
                cursor: not-allowed;
            }

            .mint-error {
                color: #ff4444;
                margin-top: 16px;
            }
        `;
    }
}