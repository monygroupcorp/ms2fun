import { ApproveModal } from '../ApprovalModal/ApprovalModal.js';
import { eventBus } from '../../core/EventBus.js';

export class SwapTransactionHandler {
    constructor(swapInterface) {
        this.swap = swapInterface;
        this.blockchainService = swapInterface.blockchainService;
        this.store = swapInterface.store;
        
        // Bind event handler to this instance
        this.handleApprovalComplete = this.handleApprovalComplete.bind(this);
    }

    async executeSwap() {
        // Contains the core logic from handleSwap
        // ... refined transaction flow ...
    }

    // Separate method to handle approve:complete events
    async handleApprovalComplete() {
        try {
            const address = await this.swap.getAddress();
            if (!address) {
                console.error('No address available for swap after approval');
                return;
            }
            
            // Get the current state from the swap interface
            const execAmount = this.swap.state?.execAmount;
            if (!execAmount) {
                console.error('No EXEC amount available for swap after approval');
                return;
            }
            
            console.log(`Approval complete, executing token swap with amount: ${execAmount}`);
            await this.blockchainService.swapExactTokenForEthSupportingFeeOnTransfer(
                address, 
                { amount: execAmount }
            );
        } catch (error) {
            console.error('Error executing swap after approval:', error);
            this.swap.messagePopup?.error(
                `Swap Failed: ${error.message}`,
                'Transaction Failed'
            );
        }
    }

    async handleApprovalFlow(execAmount, routerAddress) {
        try {
            // Get the user address
            const address = await this.swap.getAddress();
            if (!address) {
                console.error('No address available for approval flow');
                return;
            }
            
            // Clean up any existing modal
            if (this.swap.approveModal) {
                // Remove the previous event listener to prevent memory leaks
                eventBus.off('approve:complete', this.handleApprovalComplete);
                
                // Try to properly close the existing modal
                try {
                    this.swap.approveModal.handleClose();
                } catch (e) {
                    console.warn('Error closing existing approval modal:', e);
                }
                
                // Clear the reference
                this.swap.approveModal = null;
            }
            
            // Create and mount a new modal
            this.swap.approveModal = new ApproveModal(
                execAmount,
                this.blockchainService,
                address
            );
            
            // Mount the modal to the document body
            this.swap.approveModal.mount(document.body);
            
            // Set up the event listener for approval completion
            eventBus.once('approve:complete', this.handleApprovalComplete);
            
            // Listen for modal closed event to clean up resources
            eventBus.once('approveModal:closed', () => {
                console.log('ApproveModal closed event received, cleaning up');
                eventBus.off('approve:complete', this.handleApprovalComplete);
                this.swap.approveModal = null;
            });
            
            // Show the modal
            this.swap.approveModal.show();
        } catch (error) {
            console.error('Error in approval flow:', error);
            this.swap.messagePopup?.error(
                `Approval Setup Failed: ${error.message}`,
                'Error'
            );
        }
    }

    validateSwapInputs() {
        const { ethAmount, execAmount, direction } = this.swap.state;
        if (!ethAmount || !execAmount || parseFloat(ethAmount) <= 0 || parseFloat(execAmount) <= 0) {
            this.swap.messagePopup.info('Please enter valid amounts', 'Invalid Input');
            return false;
        }
        return true;
    }
} 