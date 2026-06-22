import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import { tradingStore } from '../../store/tradingStore.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';

export class ApproveModal extends Component {
    constructor(amount, blockchainService, userAddress = null) {
        super();
        console.log('[DEBUG] ApproveModal constructor called with amount:', amount, 'and address:', userAddress);
        this.amount = amount;
        this.blockchainService = blockchainService;
        this.userAddress = userAddress;
        this.messagePopup = new MessagePopup('approve-status');
        this.handleApprove = this.handleApprove.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.store = tradingStore;
        this.isClosing = false; // Flag to prevent double closing
        this.modalId = Math.random().toString(36).substring(2, 9); // Unique ID for tracking
        console.log(`[DEBUG] ApproveModal instance created with ID: ${this.modalId}`);
    }

    onMount() {
        console.log(`[DEBUG-${this.modalId}] ApproveModal mounted to DOM`);
        super.onMount();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const approveButton = this.element.querySelector('.approve-button');
        const closeButton = this.element.querySelector('.approve-modal-close');
        const overlay = this.element.querySelector('.approve-modal-overlay');
        
        approveButton?.addEventListener('click', this.handleApprove);
        closeButton?.addEventListener('click', this.handleClose);
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.handleClose();
        });
    }

    async handleApprove() {
        console.log(`[DEBUG-${this.modalId}] Approve button clicked`);
        try {
            // Disable the button immediately to prevent multiple clicks
            const approveButton = this.element.querySelector('.approve-button');
            if (!approveButton) {
                console.error(`[DEBUG-${this.modalId}] Approve button not found in the modal`);
                return;
            }
            
            console.log(`[DEBUG-${this.modalId}] Approve button found, disabling and updating text`);
            const statusMessage = this.element.querySelector('.status-message') || 
                document.createElement('div');
            
            if (!statusMessage.classList.contains('status-message')) {
                statusMessage.className = 'status-message';
                const modalContent = this.element.querySelector('.approve-modal-content');
                if (modalContent) {
                    console.log(`[DEBUG-${this.modalId}] Adding status message to modal content`);
                    modalContent.appendChild(statusMessage);
                } else {
                    console.error(`[DEBUG-${this.modalId}] Modal content not found`);
                }
            }
            
            statusMessage.textContent = 'Waiting for wallet confirmation...';
            statusMessage.className = 'status-message pending';
            
            approveButton.disabled = true;
            approveButton.textContent = 'Approving...';

            // Get user address if not provided
            if (!this.userAddress) {
                console.log(`[DEBUG-${this.modalId}] No user address provided, attempting to get from signer`);
                if (this.blockchainService && this.blockchainService.signer) {
                    try {
                        this.userAddress = await this.blockchainService.signer.getAddress();
                        console.log(`[DEBUG-${this.modalId}] Retrieved user address for approval: ${this.userAddress}`);
                    } catch (addressError) {
                        console.error(`[DEBUG-${this.modalId}] Failed to get user address for approval:`, addressError);
                        throw new Error('Could not get wallet address for approval. Please reconnect your wallet.');
                    }
                } else {
                    console.error(`[DEBUG-${this.modalId}] No blockchain service or signer available`);
                    throw new Error('No wallet connected. Please connect your wallet first.');
                }
            } else {
                console.log(`[DEBUG-${this.modalId}] Using provided user address: ${this.userAddress}`);
            }

            // Format token amount with 18 decimals
            console.log(`[DEBUG-${this.modalId}] Parsing amount: ${this.amount}`);
            const parsedAmount = this.blockchainService.parseExec(this.amount);
            console.log(`[DEBUG-${this.modalId}] Parsed amount: ${parsedAmount}`);
            
            // Get router address
            const routerAddress = this.blockchainService.swapRouter?.address || this.blockchainService.swapRouter;
            console.log(`[DEBUG-${this.modalId}] Router address for approval: ${routerAddress}`);
            
            // Call the standard setApproval method
            console.log(`[DEBUG-${this.modalId}] Approving ${this.amount} EXEC tokens from ${this.userAddress} to ${routerAddress}`);
            
            statusMessage.textContent = 'Transaction submitted, waiting for confirmation...';
            
            // Send the approval transaction
            console.log(`[DEBUG-${this.modalId}] Calling blockchainService.setApproval`);
            try {
                const approvalResult = await this.blockchainService.setApproval(routerAddress, parsedAmount);
                console.log(`[DEBUG-${this.modalId}] Approval transaction result:`, approvalResult);
            } catch (txError) {
                console.error(`[DEBUG-${this.modalId}] Transaction error:`, txError);
                throw txError;
            }
            
            // Update status message
            statusMessage.textContent = 'Approval successful!';
            statusMessage.className = 'status-message success';
            
            // Wait briefly to show success message
            console.log(`[DEBUG-${this.modalId}] Approval successful, waiting before emitting event`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Emit success event
            console.log(`[DEBUG-${this.modalId}] Emitting approve:complete event`);
            eventBus.emit('approve:complete');
            
            // Close modal
            console.log(`[DEBUG-${this.modalId}] Calling handleClose after successful approval`);
            this.handleClose();

        } catch (error) {
            console.error(`[DEBUG-${this.modalId}] Approval failed:`, error);
            
            let errorMessage = error.message;
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            // Update status message in the modal
            const statusMessage = this.element.querySelector('.status-message') || 
                document.createElement('div');
            
            if (!statusMessage.classList.contains('status-message')) {
                statusMessage.className = 'status-message';
                const modalContent = this.element.querySelector('.approve-modal-content');
                if (modalContent) {
                    modalContent.appendChild(statusMessage);
                }
            }
            
            statusMessage.textContent = `Error: ${errorMessage}`;
            statusMessage.className = 'status-message error';
            
            this.messagePopup.error(
                `Approval Failed: ${errorMessage}`,
                'Transaction Failed'
            );

            // Re-enable button
            const approveButton = this.element.querySelector('.approve-button');
            if (approveButton) {
                approveButton.disabled = false;
                approveButton.textContent = 'Approve';
            }
        }
    }

    handleClose() {
        console.log(`[DEBUG-${this.modalId}] handleClose called`);
        // Prevent multiple close operations
        if (this.isClosing) {
            console.log(`[DEBUG-${this.modalId}] Already closing, skipping`);
            return;
        }
        this.isClosing = true;
        
        console.log(`[DEBUG-${this.modalId}] Closing approval modal`);
        
        try {
            // Remove the modal from the DOM
            if (this.element && this.element.parentNode) {
                console.log(`[DEBUG-${this.modalId}] Removing modal from DOM`);
                this.element.parentNode.removeChild(this.element);
            } else {
                console.warn(`[DEBUG-${this.modalId}] Modal element or parent not found during close`);
            }
            
            // Emit a closed event
            console.log(`[DEBUG-${this.modalId}] Emitting approveModal:closed event`);
            eventBus.emit('approveModal:closed');
            
            // Clean up any resources
            console.log(`[DEBUG-${this.modalId}] Calling dispose method`);
            this.dispose();
        } catch (error) {
            console.error(`[DEBUG-${this.modalId}] Error closing approval modal:`, error);
        }
    }
    
    // Properly dispose of the component
    dispose() {
        console.log(`[DEBUG-${this.modalId}] Disposing component resources`);
        
        // Remove event listeners
        const approveButton = this.element?.querySelector('.approve-button');
        const closeButton = this.element?.querySelector('.approve-modal-close');
        const overlay = this.element?.querySelector('.approve-modal-overlay');
        
        approveButton?.removeEventListener('click', this.handleApprove);
        closeButton?.removeEventListener('click', this.handleClose);
        
        // Clear references
        this.isClosing = true;
        this.blockchainService = null;
        this.userAddress = null;
        console.log(`[DEBUG-${this.modalId}] Component disposed`);
    }

    show() {
        console.log(`[DEBUG-${this.modalId}] Show method called`);
        this.isClosing = false;
        this.element.style.display = 'block';
        console.log(`[DEBUG-${this.modalId}] Modal set to display:block`);
    }

    hide() {
        console.log(`[DEBUG-${this.modalId}] Hide method called`);
        this.element.style.display = 'none';
    }

    events() {
        console.log(`[DEBUG-${this.modalId}] Setting up event handlers`);
        return {
            'click .approve-button': (e) => {
                console.log(`[DEBUG-${this.modalId}] Approve button clicked, calling handleApprove`);
                this.handleApprove();
            },
            'click .approve-modal-close': (e) => {
                console.log(`[DEBUG-${this.modalId}] Close button clicked, calling handleClose`);
                this.handleClose();
            },
            'click .approve-modal-overlay': (e) => {
                console.log(`[DEBUG-${this.modalId}] Overlay clicked`, e.target, e.currentTarget);
                if (e.target === e.currentTarget) {
                    console.log(`[DEBUG-${this.modalId}] Overlay direct click detected, calling handleClose`);
                    this.handleClose();
                }
            }
        };
    }

    render() {
        // Get router address directly from the blockchain service instead of the store
        const routerAddress = this.blockchainService.swapRouter?.address || this.blockchainService.swapRouter;
        const formattedAmount = parseInt(this.amount).toLocaleString();

        return `
            <div class="approve-modal-overlay">
                <div class="approve-modal">
                    <button class="approve-modal-close">&times;</button>
                    <div class="approve-modal-content">
                        <h2>Approve Router</h2>
                        <p>Before selling your $EXEC tokens, you need to approve the router contract to spend them.</p>
                        
                        <div class="approve-details">
                            <div class="approve-info">
                                <span class="label">Amount to Approve:</span>
                                <span class="value">${formattedAmount} $EXEC</span>
                            </div>
                            <div class="approve-info">
                                <span class="label">Router Address:</span>
                                <span class="value">${routerAddress}</span>
                            </div>
                        </div>

                        <button class="approve-button">
                            Approve
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    static get styles() {
        return `
            .approve-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.75);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .approve-modal {
                background-color: #111;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 500px;
            }

            .approve-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #fff;
            }

            .approve-modal h2 {
                margin: 0 0 16px 0;
                color: #fff;
            }

            .approve-details {
                background-color: #1a1a1a;
                border-radius: 8px;
                padding: 16px;
                margin: 16px 0;
            }

            .approve-info {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                word-break: break-all;
            }

            .approve-info:last-child {
                margin-bottom: 0;
            }

            .approve-info .label {
                color: #888;
                margin-right: 16px;
            }

            .approve-info .value {
                color: #fff;
                text-align: right;
            }

            .approve-button {
                width: 100%;
                padding: 12px;
                background-color: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                margin-top: 16px;
            }

            .approve-button:disabled {
                background-color: #555;
                cursor: not-allowed;
            }

            .approve-button:hover:not(:disabled) {
                background-color: #0056b3;
            }
            
            .status-message {
                margin-top: 12px;
                padding: 10px;
                border-radius: 4px;
                text-align: center;
                font-size: 14px;
            }
            
            .status-message.pending {
                background-color: #2c3e50;
                color: #f1c40f;
            }
            
            .status-message.success {
                background-color: #27ae60;
                color: white;
            }
            
            .status-message.error {
                background-color: #c0392b;
                color: white;
            }
        `;
    }
}