import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { tradingStore } from '../../store/tradingStore.js';
export class SendModal extends Component {
    constructor(tokenId, blockchainService) {
        super();
        this.tokenId = tokenId;
        this.blockchainService = blockchainService;
        this.isVisible = false;
        this.tradingStore = tradingStore;
        // Initialize message popup
        this.messagePopup = new MessagePopup('status-message');
        this.messagePopup.initialize();
        
        // Bind methods
        this.handleClose = this.handleClose.bind(this);
        this.handleSend = this.handleSend.bind(this);
        this.handleAddressInput = this.handleAddressInput.bind(this);
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

    handleAddressInput(event) {
        this.recipientAddress = event.target.value;
        // Enable/disable send button based on address validity
        const sendButton = this.element.querySelector('.confirm-send-button');
        if (sendButton) {
            sendButton.disabled = !this.isValidAddress(this.recipientAddress);
        }
    }

    isValidAddress(address) {
        // Basic Ethereum address validation
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    handleTransactionEvents(event) {
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        const sendButton = this.element.querySelector('.confirm-send-button');

        if (event.type === 'send') {
            if (sendButton) {
                sendButton.textContent = 'Waiting for confirmation...';
            }
            this.messagePopup.info(
                `Sending NFT #${this.tokenId}. Please confirm in your wallet...`,
                'Transaction Pending'
            );
        }

        if (event.hash) {
            if (sendButton) {
                sendButton.textContent = 'Transaction Processing...';
            }
            this.messagePopup.info(
                `Transaction confirmed, transfer in progress...`,
                'Transaction Confirmed'
            );
        }

        if (event.receipt) {
            this.messagePopup.success(
                `Successfully sent NFT #${this.tokenId}!`,
                'Transaction Complete'
            );
            
            this.hide();
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');
            
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent = 'Send NFT';
            }
        }

        if (event.error) {
            const errorMessage = event.error?.message || 'Transaction failed';
            this.messagePopup.error(
                errorMessage,
                'Transaction Failed'
            );
            
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent = 'Send NFT';
            }
        }
    }

    async handleSend() {
        try {
            const sendButton = this.element.querySelector('.confirm-send-button');
            const address = this.tradingStore.selectConnectedAddress();
            sendButton.disabled = true;
            sendButton.textContent = 'Preparing Transaction...';

            // Call blockchain service to perform transfer
            await this.blockchainService.transferNFT(address, this.recipientAddress, this.tokenId);
            
        } catch (error) {
            console.error('Transfer failed:', error);
            this.handleTransactionEvents({ error });
        }
    }

    handleClose() {
        this.hide();
    }

    mount(container) {
        super.mount(container);
        this.setupEventListeners();
        
        eventBus.on('transaction:pending', this.handleTransactionEvents);
        eventBus.on('transaction:confirmed', this.handleTransactionEvents);
        eventBus.on('transaction:success', this.handleTransactionEvents);
        eventBus.on('transaction:error', this.handleTransactionEvents);
        
        this.hide();
    }

    unmount() {
        eventBus.off('transaction:pending', this.handleTransactionEvents);
        eventBus.off('transaction:confirmed', this.handleTransactionEvents);
        eventBus.off('transaction:success', this.handleTransactionEvents);
        eventBus.off('transaction:error', this.handleTransactionEvents);
        
        super.unmount();
    }

    setupEventListeners() {
        const closeButton = this.element.querySelector('.send-modal-close');
        const overlay = this.element.querySelector('.send-modal-overlay');
        const addressInput = this.element.querySelector('.address-input');
        const sendButton = this.element.querySelector('.confirm-send-button');
        
        closeButton?.addEventListener('click', this.handleClose);
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.handleClose();
        });
        addressInput?.addEventListener('input', this.handleAddressInput);
        sendButton?.addEventListener('click', this.handleSend);
    }

    render() {
        return `
            <div class="send-modal-overlay">
                <div class="send-modal">
                    <button class="send-modal-close">&times;</button>
                    <div class="send-modal-content">
                        <h2>Send NFT #${this.tokenId}</h2>
                        <p>Enter the recipient's Ethereum address:</p>
                        <input type="text" 
                               class="address-input" 
                               placeholder="0x..."
                               spellcheck="false">
                        <div class="send-error" style="display: none;"></div>
                        <button class="confirm-send-button" disabled>
                            Send NFT
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    static get styles() {
        return `
            .send-modal-overlay {
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

            .send-modal {
                background-color: #111;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 400px;
            }

            .send-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: white;
            }

            .send-modal-content {
                text-align: center;
            }

            .address-input {
                width: 100%;
                padding: 12px;
                margin: 24px 0;
                background: #222;
                border: 1px solid #333;
                border-radius: 4px;
                color: white;
                font-family: monospace;
            }

            .confirm-send-button {
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

            .confirm-send-button:disabled {
                background: #666;
                cursor: not-allowed;
            }

            .send-error {
                color: #ff4444;
                margin-top: 16px;
            }
        `;
    }
}