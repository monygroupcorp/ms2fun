import { Component } from '../../core/Component.js';
import { eventBus } from '../../core/EventBus.js';
import { tradingStore } from '../../store/tradingStore.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';

export class ReRollModal extends Component {
    constructor(blockchainService) {
        super();
        this.blockchainService = blockchainService;
        this.isVisible = false;
        this.hasConfirmed = false;
        this.skipNFTStatus = null;
        this.isCheckingSkipNFT = false;
        
        // Initialize message popup
        this.messagePopup = new MessagePopup('reroll-status-message');
        this.messagePopup.initialize();
        
        // Bind methods
        this.handleClose = this.handleClose.bind(this);
        this.handleConfirm = this.handleConfirm.bind(this);
        this.handleReroll = this.handleReroll.bind(this);
        this.handleTransactionEvents = this.handleTransactionEvents.bind(this);
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.checkSkipNFT = this.checkSkipNFT.bind(this);
    }

    show() {
        this.isVisible = true;
        this.hasConfirmed = false;
        this.skipNFTStatus = null;
        
        // Find the overlay element within the mounted container
        const overlay = this.element.querySelector('.reroll-modal-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            
            // Reset UI state - show warning section, hide confirmation section
            const warningSection = overlay.querySelector('.warning-section');
            const confirmSection = overlay.querySelector('.confirmation-section');
            if (warningSection) {
                warningSection.style.display = 'block';
            }
            if (confirmSection) {
                confirmSection.style.display = 'none';
            }
            
            // Reset skipNFT status display
            const skipNFTStatus = overlay.querySelector('.skipnft-status');
            if (skipNFTStatus) {
                skipNFTStatus.textContent = 'Loading...';
                skipNFTStatus.className = 'skipnft-status checking';
            }
        } else {
            // Fallback: show the entire element if overlay not found
            this.element.style.display = 'block';
        }
        
        // Update dynamic warning with current balance
        const calculations = this.getRerollCalculations();
        this.updateDynamicWarning(calculations);
        
        // Check skipNFT status when modal opens
        this.checkSkipNFT();
    }

    hide() {
        this.isVisible = false;
        this.hasConfirmed = false;
        
        // Find the overlay element within the mounted container
        const overlay = this.element.querySelector('.reroll-modal-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        } else {
            // Fallback: hide the entire element if overlay not found
            this.element.style.display = 'none';
        }
    }

    async checkSkipNFT() {
        try {
            this.isCheckingSkipNFT = true;
            const address = tradingStore.selectConnectedAddress();
            if (!address) {
                throw new Error('No wallet connected');
            }

            // Check skipNFT status using getSkipNFT
            const skipNFT = await this.blockchainService.getSkipNFT(address);
            this.skipNFTStatus = skipNFT;
            
            // Update UI to show status
            this.updateSkipNFTStatus();
        } catch (error) {
            console.error('Error checking skipNFT status:', error);
            this.messagePopup.error(
                'Failed to check skipNFT status. Please try again.',
                'Error'
            );
        } finally {
            this.isCheckingSkipNFT = false;
        }
    }

    getRerollCalculations() {
        const balances = tradingStore.selectBalances();
        const execBalance = BigInt(balances.exec || '0');
        const currentNFTs = parseInt(balances.nfts || '0');
        
        // 1,000,000 EXEC = 1 NFT (1M EXEC in wei = 1000000000000000000000000)
        const execForOneNFT = BigInt('1000000000000000000000000');
        const nftsToMint = execBalance > 0n ? Number(execBalance / execForOneNFT) : 0;
        
        return {
            execBalance: execBalance.toString(),
            execBalanceFormatted: (Number(execBalance) / 1e18).toLocaleString(),
            currentNFTs,
            nftsToMint,
            nftsToBurn: currentNFTs
        };
    }

    updateSkipNFTStatus() {
        const statusElement = this.element.querySelector('.skipnft-status');
        const confirmButton = this.element.querySelector('.confirm-reroll-button');
        const calculations = this.getRerollCalculations();
        
        if (statusElement) {
            if (this.skipNFTStatus === false) {
                statusElement.textContent = '✓ setSkipNFT is set to false - Re-roll is available';
                statusElement.className = 'skipnft-status available';
                if (confirmButton) {
                    confirmButton.disabled = false;
                }
            } else {
                statusElement.textContent = '✗ setSkipNFT is set to true - Will be set to false automatically';
                statusElement.className = 'skipnft-status will-set';
                if (confirmButton) {
                    confirmButton.disabled = false;
                    const calculations = this.getRerollCalculations();
                    confirmButton.textContent = `Start Re-roll (2 transactions)`;
                }
            }
            
            // Update button text based on whether setSkipNFT needs to be set
            if (confirmButton && this.skipNFTStatus === false) {
                confirmButton.textContent = 'Confirm Re-roll';
            }
        }
        
        // Update dynamic warning
        this.updateDynamicWarning(calculations);
    }

    updateDynamicWarning(calculations) {
        const warningText = this.element.querySelector('.dynamic-warning-text');
        if (warningText && calculations.nftsToMint > 0) {
            warningText.innerHTML = `
                <strong>⚠️ YOU HAVE ${calculations.execBalanceFormatted} EXEC AND ${calculations.currentNFTs} NFTs!</strong><br><br>
                This means you will be paying Ethereum gas for:<br>
                • Burning ${calculations.nftsToBurn} NFT${calculations.nftsToBurn !== 1 ? 's' : ''}<br>
                • Minting ${calculations.nftsToMint} NFT${calculations.nftsToMint !== 1 ? 's' : ''}<br><br>
                <strong>That's ${calculations.nftsToBurn + calculations.nftsToMint} total NFT operations in gas fees!!!</strong>
            `;
        }
    }

    handleClose() {
        this.hide();
    }

    handleConfirm() {
        this.hasConfirmed = true;
        const confirmSection = this.element.querySelector('.confirmation-section');
        const warningSection = this.element.querySelector('.warning-section');
        
        if (confirmSection) {
            confirmSection.style.display = 'block';
        }
        if (warningSection) {
            warningSection.style.display = 'none';
        }
    }

    async handleReroll() {
        try {
            if (!this.hasConfirmed) {
                this.messagePopup.warning(
                    'Please confirm that you understand the consequences first.',
                    'Confirmation Required'
                );
                return;
            }

            const rerollButton = this.element.querySelector('.confirm-reroll-button');
            const stepIndicator = this.element.querySelector('.transaction-steps');
            
            // Get user's address
            const address = tradingStore.selectConnectedAddress();
            if (!address) {
                throw new Error('No wallet connected');
            }

            // Get current EXEC balance
            const balances = tradingStore.selectBalances();
            const execBalance = BigInt(balances.exec || '0');
            
            if (execBalance === 0n) {
                throw new Error('You have no EXEC tokens to re-roll');
            }

            // Show transaction steps
            if (stepIndicator) {
                stepIndicator.style.display = 'block';
                // Hide step 1 if setSkipNFT is already false
                const step1 = stepIndicator.querySelector('.step-1');
                if (step1 && this.skipNFTStatus === false) {
                    step1.style.display = 'none';
                } else if (step1) {
                    step1.style.display = 'block';
                }
            }

            // Step 1: Set setSkipNFT to false if needed
            if (this.skipNFTStatus === true) {
                if (rerollButton) {
                    rerollButton.disabled = true;
                    rerollButton.textContent = 'Step 1: Setting setSkipNFT to false...';
                }
                
                this.updateStepStatus(1, 'pending');
                this.messagePopup.info(
                    'Step 1: Setting setSkipNFT to false. Please confirm in your wallet...',
                    'Transaction 1 of 2'
                );
                
                await this.blockchainService.setSkipNFT(false);
                
                // Wait a moment for the transaction to be confirmed
                this.updateStepStatus(1, 'completed');
                this.messagePopup.success(
                    'Step 1 complete: setSkipNFT set to false',
                    'Transaction 1 Confirmed'
                );
                
                // Update status
                this.skipNFTStatus = false;
            }

            // Step 2: Transfer tokens to self (this triggers the re-roll)
            if (rerollButton) {
                rerollButton.textContent = 'Step 2: Transferring tokens to self...';
            }
            
            this.updateStepStatus(2, 'pending');
            this.messagePopup.info(
                'Step 2: Transferring EXEC tokens to yourself. Please confirm in your wallet...',
                'Transaction 2 of 2'
            );
            
            // Transfer tokens to self (this triggers the re-roll)
            // Amount should be in wei format (already is from balance)
            await this.blockchainService.transferTokensToSelf(execBalance.toString());
            
            // Note: Success/error handling will come through the event system
        } catch (error) {
            console.error('Re-roll failed:', error);
            this.handleTransactionEvents({ error });
        }
    }

    updateStepStatus(stepNumber, status) {
        const stepElement = this.element.querySelector(`.step-${stepNumber}`);
        if (stepElement) {
            stepElement.className = `step-${stepNumber} ${status}`;
            const statusText = stepElement.querySelector('.step-status');
            if (statusText) {
                if (status === 'pending') {
                    statusText.textContent = '⏳ Pending...';
                } else if (status === 'completed') {
                    statusText.textContent = '✓ Completed';
                } else if (status === 'error') {
                    statusText.textContent = '✗ Failed';
                }
            }
        }
    }

    handleTransactionEvents(event) {
        if (!event) return;
        
        const rerollButton = this.element.querySelector('.confirm-reroll-button');

        // Handle setSkipNFT transaction events
        if (event.type === 'setSkipNFT') {
            if (event.receipt) {
                this.updateStepStatus(1, 'completed');
                // Step 1 is handled in handleReroll, so we don't need to do anything else here
            } else if (event.error) {
                this.updateStepStatus(1, 'error');
                const errorMessage = event.error?.message || event.error || 'Failed to set skipNFT';
                this.messagePopup.error(
                    errorMessage,
                    'Transaction Failed'
                );
                if (rerollButton) {
                    rerollButton.disabled = false;
                    rerollButton.textContent = 'Confirm Re-roll';
                }
            }
            return;
        }

        // Handle transaction pending events
        if (event.type === 'reroll' && !event.receipt && !event.error && !event.hash) {
            if (rerollButton) {
                rerollButton.textContent = 'Waiting for confirmation...';
            }
            this.messagePopup.info(
                'Re-rolling your NFTs. Please confirm in your wallet...',
                'Transaction Pending'
            );
            return;
        }

        // Handle transaction confirmed events (with hash but no receipt yet)
        if (event.type === 'reroll' && event.hash && !event.receipt) {
            if (rerollButton) {
                rerollButton.textContent = 'Transaction Processing...';
            }
            this.messagePopup.info(
                'Transaction confirmed, re-roll in progress...',
                'Transaction Confirmed'
            );
            return;
        }

        // Handle transaction success events (with receipt)
        if (event.type === 'reroll' && event.receipt) {
            this.updateStepStatus(2, 'completed');
            this.messagePopup.success(
                'Successfully re-rolled your NFTs!',
                'Transaction Complete'
            );
            
            this.hide();
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');
            
            if (rerollButton) {
                rerollButton.disabled = false;
                rerollButton.textContent = 'Confirm Re-roll';
            }
            return;
        }

        // Handle transaction error events
        if (event.type === 'reroll' && event.error) {
            this.updateStepStatus(2, 'error');
            const errorMessage = event.error?.message || event.error || 'Transaction failed';
            this.messagePopup.error(
                errorMessage,
                'Transaction Failed'
            );
            
            if (rerollButton) {
                rerollButton.disabled = false;
                rerollButton.textContent = 'Confirm Re-roll';
            }
            return;
        }
    }

    mount(container) {
        super.mount(container);
        
        // Wait for DOM to be ready before setting up event listeners
        // Use requestAnimationFrame to ensure render has completed
        requestAnimationFrame(() => {
            this.setupEventListeners();
        });
        
        // Subscribe to transaction events - filter for reroll and setSkipNFT types
        this.handlePending = (event) => {
            if (event && (event.type === 'reroll' || event.type === 'setSkipNFT')) {
                this.handleTransactionEvents(event);
            }
        };
        this.handleConfirmed = (event) => {
            if (event && (event.type === 'reroll' || event.type === 'setSkipNFT')) {
                this.handleTransactionEvents(event);
            }
        };
        this.handleSuccess = (event) => {
            if (event && (event.type === 'reroll' || event.type === 'setSkipNFT')) {
                this.handleTransactionEvents(event);
            }
        };
        this.handleError = (event) => {
            if (event && (event.type === 'reroll' || event.type === 'setSkipNFT')) {
                this.handleTransactionEvents(event);
            }
        };

        eventBus.on('transaction:pending', this.handlePending);
        eventBus.on('transaction:confirmed', this.handleConfirmed);
        eventBus.on('transaction:success', this.handleSuccess);
        eventBus.on('transaction:error', this.handleError);
        
        // Hide initially after mounting
        this.hide();
    }

    onMount() {
        // This is called by the base Component class after mount
        // Event listeners are set up in mount() method above
    }

    unmount() {
        // Unsubscribe from transaction events
        if (this.handlePending) {
            eventBus.off('transaction:pending', this.handlePending);
        }
        if (this.handleConfirmed) {
            eventBus.off('transaction:confirmed', this.handleConfirmed);
        }
        if (this.handleSuccess) {
            eventBus.off('transaction:success', this.handleSuccess);
        }
        if (this.handleError) {
            eventBus.off('transaction:error', this.handleError);
        }
        
        super.unmount();
    }

    onUnmount() {
        // This is called by the base Component class during unmount
        // Cleanup is done in unmount() method above
    }

    setupEventListeners() {
        const closeButton = this.element.querySelector('.reroll-modal-close');
        const overlay = this.element.querySelector('.reroll-modal-overlay');
        const confirmButton = this.element.querySelector('.confirm-understand-button');
        const rerollButton = this.element.querySelector('.confirm-reroll-button');

        if (closeButton) {
            closeButton.addEventListener('click', this.handleClose);
        }

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.handleClose();
                }
            });
        }

        if (confirmButton) {
            confirmButton.addEventListener('click', this.handleConfirm);
        }

        if (rerollButton) {
            rerollButton.addEventListener('click', this.handleReroll);
        }
    }

    render() {
        return `
            <div class="reroll-modal-overlay" style="display: none;">
                <div class="reroll-modal">
                    <button class="reroll-modal-close">&times;</button>
                    <div class="reroll-modal-content">
                        <h2>Re-roll Exec NFTs</h2>
                        
                        <div class="warning-section">
                            <div class="warning-box">
                                <h3>⚠️ WARNING: RISK-ON PROCEDURE</h3>
                                <div class="dynamic-warning-text">
                                    <p>Loading your balance information...</p>
                                </div>
                                <p class="warning-text">
                                    <strong>CONSEQUENCES:</strong><br><br>
                                    In order to reroll your NFTs, you will have to set a value on the contract that makes it so that all of your EXEC will automatically mint NFTs. So if you have 100,000,000 EXEC, you will mint 100 NFTs in this transaction if you haven't minted them yet.<br><br>
                                    
                                    Furthermore, the cult exec badge NFTs that reside in your wallet when you perform this transaction will all be burnt, and you will mint all new ones.<br><br>
                                    
                                    <strong>We recommend that if you have NFT ids that you cherish, you should move them to another wallet for safe keeping.</strong> And if you have a lot of EXEC, you may want to move some excess EXEC elsewhere to perform the reroll with the amount of NFTs you want to re-roll with. <strong>Keep in mind: 1,000,000 EXEC = 1 Cult Executive Badge NFT.</strong><br><br>
                                    
                                    <strong>This feature requires setSkipNFT to be set to false. If it's currently true, we will automatically set it to false in the first transaction.</strong>
                                </p>
                            </div>
                            
                            <div class="skipnft-check">
                                <p>Checking skipNFT status...</p>
                                <div class="skipnft-status checking">Loading...</div>
                            </div>
                            
                            <button class="confirm-understand-button">
                                I Understand the Consequences
                            </button>
                        </div>
                        
                        <div class="confirmation-section" style="display: none;">
                            <div class="skipnft-status-message">
                                <div class="skipnft-status"></div>
                            </div>
                            
                            <p class="confirmation-text">
                                You have confirmed that you understand the consequences. 
                                Click below to proceed with the re-roll.
                            </p>
                            
                            <div class="transaction-steps" style="display: none;">
                                <div class="step step-1">
                                    <div class="step-number">Step 1</div>
                                    <div class="step-description">Set setSkipNFT to false</div>
                                    <div class="step-status">Waiting...</div>
                                </div>
                                <div class="step step-2">
                                    <div class="step-number">Step 2</div>
                                    <div class="step-description">Transfer EXEC tokens to self</div>
                                    <div class="step-status">Waiting...</div>
                                </div>
                            </div>
                            
                            <button class="confirm-reroll-button" disabled>
                                Confirm Re-roll
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    static get styles() {
        return `
            .reroll-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.75);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1001;
            }

            .reroll-modal {
                background-color: #111;
                border-radius: 8px;
                padding: 24px;
                position: relative;
                width: 90%;
                max-width: 500px;
                max-height: 80vh;
                overflow-y: auto;
                border: 2px solid #ff3366;
            }

            .reroll-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: none;
                border: none;
                font-size: 24px;
                color: #fff;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
            }

            .reroll-modal-close:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }

            .reroll-modal-content {
                margin-top: 16px;
            }

            .reroll-modal-content h2 {
                margin: 0 0 20px 0;
                color: #fff;
            }

            .warning-section {
                margin-bottom: 20px;
            }

            .warning-box {
                background-color: #2a1a1a;
                border: 2px solid #ff3366;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 20px;
            }

            .warning-box h3 {
                margin: 0 0 12px 0;
                color: #ff3366;
            }

            .warning-text {
                color: #fff;
                line-height: 1.6;
            }

            .warning-text ul {
                margin: 12px 0;
                padding-left: 24px;
            }

            .warning-text li {
                margin: 8px 0;
            }

            .skipnft-check {
                margin: 20px 0;
                padding: 12px;
                background-color: #1a1a1a;
                border-radius: 4px;
            }

            .skipnft-status {
                padding: 8px;
                border-radius: 4px;
                margin-top: 8px;
                font-weight: bold;
            }

            .skipnft-status.checking {
                color: #888;
            }

            .skipnft-status.available {
                background-color: #1a3a1a;
                color: #10b981;
            }

            .skipnft-status.unavailable {
                background-color: #3a1a1a;
                color: #ff3366;
            }

            .skipnft-status.will-set {
                background-color: #3a3a1a;
                color: #ffaa00;
            }

            .dynamic-warning-text {
                background-color: #2a1a1a;
                border: 1px solid #ff3366;
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 16px;
                color: #fff;
                line-height: 1.6;
            }

            .dynamic-warning-text strong {
                color: #ff3366;
            }

            .confirm-understand-button {
                width: 100%;
                padding: 12px 24px;
                background-color: #ff3366;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: background-color 0.2s;
            }

            .confirm-understand-button:hover {
                background-color: #ff5588;
            }

            .confirmation-section {
                margin-top: 20px;
            }

            .skipnft-status-message {
                margin-bottom: 20px;
            }

            .confirmation-text {
                color: #fff;
                margin-bottom: 20px;
                line-height: 1.6;
            }

            .confirm-reroll-button {
                width: 100%;
                padding: 12px 24px;
                background-color: #10b981;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: background-color 0.2s;
            }

            .confirm-reroll-button:hover:not(:disabled) {
                background-color: #059669;
            }

            .confirm-reroll-button:disabled {
                background-color: #666;
                cursor: not-allowed;
            }

            .transaction-steps {
                margin: 20px 0;
                padding: 16px;
                background-color: #1a1a1a;
                border-radius: 4px;
            }

            .step {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                margin-bottom: 8px;
                background-color: #222;
                border-radius: 4px;
                border-left: 3px solid #666;
            }

            .step.pending {
                border-left-color: #ffaa00;
                background-color: #2a2a1a;
            }

            .step.completed {
                border-left-color: #10b981;
                background-color: #1a2a1a;
            }

            .step.error {
                border-left-color: #ff3366;
                background-color: #2a1a1a;
            }

            .step-number {
                font-weight: bold;
                color: #888;
                min-width: 60px;
            }

            .step.pending .step-number {
                color: #ffaa00;
            }

            .step.completed .step-number {
                color: #10b981;
            }

            .step.error .step-number {
                color: #ff3366;
            }

            .step-description {
                flex: 1;
                color: #fff;
            }

            .step-status {
                color: #888;
                font-size: 14px;
            }

            .step.pending .step-status {
                color: #ffaa00;
            }

            .step.completed .step-status {
                color: #10b981;
            }

            .step.error .step-status {
                color: #ff3366;
            }
        `;
    }
}


