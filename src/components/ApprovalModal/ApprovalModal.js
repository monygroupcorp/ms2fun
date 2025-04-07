import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import { tradingStore } from '../../store/tradingStore.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';

export class ApproveModal extends Component {
    constructor(amount, blockchainService) {
        super();
        this.amount = amount;
        this.blockchainService = blockchainService;
        this.messagePopup = new MessagePopup('approve-status');
        this.handleApprove = this.handleApprove.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.store = tradingStore;
    }

    async handleApprove() {
        try {
            const approveButton = this.element.querySelector('.approve-button');
            approveButton.disabled = true;
            approveButton.textContent = 'Approving...';

            await this.blockchainService.approveRouter(this.amount);
            
            // Emit success event
            eventBus.emit('approve:complete');
            
            // Close modal
            this.handleClose();

        } catch (error) {
            console.error('Approval failed:', error);
            
            let errorMessage = error.message;
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            this.messagePopup.error(
                `Approval Failed: ${errorMessage}`,
                'Transaction Failed'
            );

            // Re-enable button
            const approveButton = this.element.querySelector('.approve-button');
            approveButton.disabled = false;
            approveButton.textContent = 'Approve';
        }
    }

    handleClose() {
        this.element.remove();
    }

    show() {
        this.element.style.display = 'block';
    }

    hide() {
        this.element.style.display = 'none';
    }

    events() {
        return {
            'click .approve-button': this.handleApprove,
            'click .approve-modal-close': this.handleClose,
            'click .approve-modal-overlay': (e) => {
                if (e.target === e.currentTarget) {
                    this.handleClose();
                }
            }
        };
    }

    render() {
        const { router } = this.store.selectContracts();
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
                                <span class="value">${router}</span>
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
        `;
    }
}