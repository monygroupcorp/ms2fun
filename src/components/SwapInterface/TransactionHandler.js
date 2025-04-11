export class SwapTransactionHandler {
    constructor(swapInterface) {
        this.swap = swapInterface;
        this.blockchainService = swapInterface.blockchainService;
        this.store = swapInterface.store;
    }

    async executeSwap() {
        // Contains the core logic from handleSwap
        // ... refined transaction flow ...
    }

    async handleApprovalFlow(execAmount, routerAddress) {
        // Approval modal handling logic
        if (!this.swap.approveModal) {
            this.swap.approveModal = new ApproveModal(
                execAmount,
                this.blockchainService,
                await this.swap.getAddress()
            );
            this.swap.approveModal.mount(document.body);
            
            eventBus.once('approve:complete', async () => {
                await this.blockchainService.swapExactTokenForEthSupportingFeeOnTransfer(
                    await this.swap.getAddress(), 
                    { amount: execAmount }
                );
            });
        }
        this.swap.approveModal.show();
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