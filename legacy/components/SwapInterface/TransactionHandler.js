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
        console.log('[DEBUG-TransactionHandler] handleApprovalComplete triggered');
        try {
            const address = await this.swap.getAddress();
            if (!address) {
                console.error('[DEBUG-TransactionHandler] No address available for swap after approval');
                return;
            }
            console.log('[DEBUG-TransactionHandler] Retrieved address:', address);
            
            // Get the current state from the swap interface
            const execAmount = this.swap.state?.execAmount;
            if (!execAmount) {
                console.error('[DEBUG-TransactionHandler] No EXEC amount available for swap after approval');
                return;
            }
            console.log('[DEBUG-TransactionHandler] Retrieved EXEC amount:', execAmount);
            
            console.log(`[DEBUG-TransactionHandler] Approval complete, executing token swap with amount: ${execAmount}`);
            await this.blockchainService.swapExactTokenForEthSupportingFeeOnTransfer(
                address, 
                { amount: execAmount }
            );
            console.log('[DEBUG-TransactionHandler] Swap completed successfully');
        } catch (error) {
            console.error('[DEBUG-TransactionHandler] Error executing swap after approval:', error);
            this.swap.messagePopup?.error(
                `Swap Failed: ${error.message}`,
                'Transaction Failed'
            );
        }
    }

    async handleApprovalFlow(execAmount, routerAddress) {
        console.log('[DEBUG-TransactionHandler] handleApprovalFlow called with amount:', execAmount);
        try {
            // Get the user address
            const address = await this.swap.getAddress();
            if (!address) {
                console.error('[DEBUG-TransactionHandler] No address available for approval flow');
                return;
            }
            console.log('[DEBUG-TransactionHandler] Retrieved address:', address);
            
            // Clean up any existing modal
            if (this.swap.approveModal) {
                console.log('[DEBUG-TransactionHandler] Existing modal found, cleaning up');
                // Remove the previous event listener to prevent memory leaks
                eventBus.off('approve:complete', this.handleApprovalComplete);
                
                // Try to properly close the existing modal
                try {
                    this.swap.approveModal.handleClose();
                    console.log('[DEBUG-TransactionHandler] Existing modal closed successfully');
                } catch (e) {
                    console.warn('[DEBUG-TransactionHandler] Error closing existing approval modal:', e);
                }
                
                // Clear the reference
                this.swap.approveModal = null;
            }
            
            // Create and mount a new modal
            console.log('[DEBUG-TransactionHandler] Creating new ApproveModal instance');
            this.swap.approveModal = new ApproveModal(
                execAmount,
                this.blockchainService,
                address
            );
            
            // Mount the modal to the document body
            console.log('[DEBUG-TransactionHandler] Mounting modal to document body');
            this.swap.approveModal.mount(document.body);
            
            // Set up the event listener for approval completion
            console.log('[DEBUG-TransactionHandler] Setting up approve:complete event listener');
            eventBus.once('approve:complete', this.handleApprovalComplete);
            
            // Listen for modal closed event to clean up resources
            console.log('[DEBUG-TransactionHandler] Setting up approveModal:closed event listener');
            eventBus.once('approveModal:closed', () => {
                console.log('[DEBUG-TransactionHandler] ApproveModal closed event received, cleaning up');
                // The approval listener will automatically clean itself up
                this.swap.approveModal = null;
            });
            
            // Show the modal
            console.log('[DEBUG-TransactionHandler] Showing the approval modal');
            this.swap.approveModal.show();
        } catch (error) {
            console.error('[DEBUG-TransactionHandler] Error in approval flow:', error);
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