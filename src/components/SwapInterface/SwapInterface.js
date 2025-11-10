import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { TransactionOptions } from '../TransactionOptions/TransactionOptions.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { eventBus } from '../../core/EventBus.js';
import PriceDisplay  from '../PriceDisplay/PriceDisplay.js';
import { ApproveModal } from '../ApprovalModal/ApprovalModal.js';
import SwapInputs from './SwapInputs.js';
import SwapButton from './SwapButton.js';

export default class SwapInterface extends Component {
    constructor(blockchainService , address = null) {
        super();
        console.log('🔵 SwapInterface constructed');
        this.blockchainService = blockchainService;
        this.store = tradingStore;
        this.state = {
            direction: 'buy',
            ethAmount: '',
            execAmount: '',
            activeInput: null,
            freeMint: false,
            freeSupply: 0,
            calculatingAmount: false,
            isPhase2: null, // null means phase is not yet determined
            dataReady: false
        };
        
        // Store the address - could be a promise or a direct value
        this._address = address;
        
        // Initialize child components that don't depend on phase
        this.transactionOptions = new TransactionOptions();
        this.messagePopup = new MessagePopup('status-message');
        this.priceDisplay = new PriceDisplay();
        console.log('🔵 SwapInterface created PriceDisplay instance');
        this.messagePopup.initialize();
        
        // Don't initialize SwapInputs here - wait until phase is known
        // This prevents rendering with wrong phase configuration
        this.swapInputs = null;
        
        this.swapButton = new SwapButton({
            direction: this.state.direction,
            disabled: false,
            onClick: this.handleSwap.bind(this)
        });
        
        // Debounce timer
        this.calculateTimer = null;
        
        // Bind event handlers
        this.handleTransactionEvents = this.handleTransactionEvents.bind(this);
        this.handleBalanceUpdate = this.handleBalanceUpdate.bind(this);
        
        // Add handler for transaction options updates
        this.handleTransactionOptionsUpdate = this.handleTransactionOptionsUpdate.bind(this);
        
        // Add transaction options state to SwapInterface
        this.transactionOptionsState = {
            message: '',
            nftMintingEnabled: false
        };

        this.approveModal = null;
        
        // Track event listeners
        this.eventListeners = [];
        
        // Add instance ID to track instances and prevent duplicate events
        this.instanceId = Math.random().toString(36).substring(2, 9);
        console.log(`🔵 SwapInterface instance created: ${this.instanceId}`);
    }

    // Add new method to handle balance updates
    handleBalanceUpdate() {
        const { freeSupply, freeMint } = this.store.selectFreeSituation();
        console.log('handleBalanceUpdate freeMint', freeMint);
        
        // Update state directly without triggering re-render
        // Only update if values actually changed
        if (this.state.freeMint !== freeMint || this.state.freeSupply !== freeSupply) {
            this.state.freeMint = freeMint;
            this.state.freeSupply = freeSupply;
            
            // Update swap inputs component with new balance info directly
            if (this.swapInputs) {
                this.swapInputs.updateProps({
                    freeMint: freeMint
                });
            }
        }
    }

    updateElements() {
        // Update child components with new props
        // Use requestAnimationFrame to batch updates and prevent multiple renders
        requestAnimationFrame(() => {
            if (this.swapInputs) {
                this.swapInputs.updateProps({
                    direction: this.state.direction,
                    ethAmount: this.state.ethAmount,
                    execAmount: this.state.execAmount,
                    calculatingAmount: this.state.calculatingAmount,
                    freeMint: this.state.freeMint,
                    isPhase2: this.state.isPhase2
                });
            }
            
            if (this.swapButton) {
                this.swapButton.updateProps({
                    direction: this.state.direction
                });
            }
        });
    }

    async calculateSwapAmount(amount, inputType) {
        // Handle empty or invalid input
        if (!amount || isNaN(parseFloat(amount))) {
            return '';
        }

        try {
            if (this.isLiquidityDeployed()) {
                // Phase 2: Use Uniswap-style calculations
                const price = this.store.selectPrice().current;
                console.log('calculateSwapAmount price', price);
                
                if (inputType === 'eth') {
                    // Calculate EXEC amount based on ETH input
                    const ethAmount = parseFloat(amount);
                    // Apply a 5% reduction to account for 4% tax + slippage
                    const execAmount = (ethAmount / price * 1000000) * 0.95;
                    console.log('calculateSwapAmount execAmount', execAmount);
                    return execAmount.toFixed(0); // Use integer amounts for EXEC
                } else {
                    // Calculate ETH amount based on EXEC input
                    const execAmount = parseFloat(amount);
                    // Add a 5.5% buffer for 4% tax + slippage + price impact
                    const ethAmount = (execAmount / 1000000) * price * 1.055;
                    console.log('calculateSwapAmount ethAmount', ethAmount);
                    return ethAmount.toFixed(6);
                }
            } else {
                // Phase 1: Use bonding curve logic
                if (inputType === 'eth') {
                    // Calculate how much EXEC user will receive for their ETH
                    const execAmount = await this.blockchainService.getExecForEth(amount);

                    // Check if user is eligible for free mint
                    const { freeSupply, freeMint } = this.store.selectFreeSituation();
                    console.log('calculateSwapAmount freeMint', freeMint);
                    // If free supply is available and user hasn't claimed their free mint
                    const freeMintBonus = (freeSupply > 0 && !freeMint) ? 1000000 : 0;
                    
                    // Round down to ensure we don't exceed maxCost
                    return Math.floor(execAmount + freeMintBonus).toString();
                } else {
                    // Calculate how much ETH user will receive for their EXEC
                    const ethAmount = await this.blockchainService.getEthForExec(amount);
                    // Reduce the minRefund slightly (0.1% less) to account for any calculation differences
                    // This ensures we stay above the actual minRefund requirement

                    // Update lets do this tailoring amount at the contract call in handle swap
                    return ethAmount.toString(); // Use more decimals for precision
                }
            }
        } catch (error) {
            console.error('Error calculating swap amount:', error);
            return '';
        }
    }

    onMount() {
        console.log(`[${this.instanceId}] SwapInterface onMount called`);
        this.bindEvents();
        
        // Create a more structured approach to event registration
        // Each entry is [eventName, handler, priority]
        // This helps debug subscription issues and ensure proper cleanup
        const eventSubscriptions = [
            ['contractData:updated', this.handleContractDataUpdate.bind(this), 'high'],
            ['transaction:pending', this.handleTransactionEvents, 'normal'],
            ['transaction:confirmed', this.handleTransactionEvents, 'normal'],
            ['transaction:success', this.handleTransactionEvents, 'normal'],
            ['transaction:error', this.handleTransactionEvents, 'normal'],
            ['balances:updated', this.handleBalanceUpdate, 'high'],
            ['transactionOptions:update', this.handleTransactionOptionsUpdate, 'low']
        ];
        
        // Register all events and store unsubscribe functions
        this.eventListeners = eventSubscriptions.map(([event, handler, priority]) => {
            console.log(`[${this.instanceId}] Subscribing to ${event} with priority ${priority}`);
            return eventBus.on(event, handler);
        });

        // Check if we already have data and can determine phase immediately
        const contractData = this.store.selectContractData();
        if (contractData && contractData.liquidityPool !== undefined) {
            const isPhase2 = this.isLiquidityDeployed();
            this.setState({ 
                isPhase2: isPhase2,
                dataReady: true
            });
            // Initialize child components now that phase is known
            this.initializeChildComponents();
        }
        
        // Always render the full interface (it will show loading state if phase is not known)
        // Use the Component's update method to trigger proper render cycle
        this.update();
            
        // Mount child components after render (only if they're initialized)
        requestAnimationFrame(() => {
            this.mountChildComponents();
        });
    }
    
    /**
     * Initialize child components that depend on phase
     * This is called once phase is determined (either in onMount or handleContractDataUpdate)
     */
    initializeChildComponents() {
        // Only initialize if phase is known and SwapInputs hasn't been created yet
        if (this.state.isPhase2 === null) {
            console.log(`[${this.instanceId}] Phase not yet determined, skipping SwapInputs initialization`);
            return;
        }
        
        if (!this.swapInputs) {
            console.log(`[${this.instanceId}] Initializing SwapInputs with phase ${this.state.isPhase2 ? '2' : '1'}`);
            this.swapInputs = new SwapInputs({
                direction: this.state.direction,
                ethAmount: this.state.ethAmount,
                execAmount: this.state.execAmount,
                calculatingAmount: this.state.calculatingAmount,
                freeMint: this.state.freeMint,
                isPhase2: this.state.isPhase2,
                onInput: this.handleInput.bind(this)
            });
        }
    }
    
    // Add method to explicitly mount child components
    mountChildComponents() {
        // Mount price display
        const priceContainer = this.element.querySelector('.price-display-container');
        if (priceContainer && (!this.priceDisplay.element || !priceContainer.contains(this.priceDisplay.element))) {
            console.log(`[${this.instanceId}] Mounting PriceDisplay component`);
            this.priceDisplay.mount(priceContainer);
        }
        
        // Mount transaction options
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        if (optionsContainer && this.transactionOptions && 
            (!this.transactionOptions.element || !optionsContainer.contains(this.transactionOptions.element))) {
            console.log(`[${this.instanceId}] Mounting TransactionOptions component`);
            this.transactionOptions.mount(optionsContainer);
        }
        
        // Mount swap inputs
        const inputsContainer = this.element.querySelector('.swap-inputs-container');
        if (inputsContainer && this.swapInputs) {
            this.swapInputs.mount(inputsContainer);
        }
        
        // Mount quick fill buttons
        const quickFillContainer = this.element.querySelector('.quick-fill-buttons-container');
        if (quickFillContainer) {
            // Create a wrapper for just the quick fill buttons
            quickFillContainer.innerHTML = '<div class="quick-fill-buttons"></div>';
            const quickFillButtons = quickFillContainer.querySelector('.quick-fill-buttons');
            if (quickFillButtons) {
                // Render quick fill buttons directly
                const { direction } = this.state;
                quickFillButtons.innerHTML = direction === 'buy' ? 
                    `<button data-amount="0.0025">0.0025</button>
                    <button data-amount="0.01">0.01</button>
                    <button data-amount="0.05">0.05</button>
                    <button data-amount="0.1">0.1</button>`
                :
                    `<button data-percentage="25">25%</button>
                    <button data-percentage="50">50%</button>
                    <button data-percentage="75">75%</button>
                    <button data-percentage="100">100%</button>`;
                
                // Attach event listeners
                quickFillButtons.addEventListener('click', (e) => {
                    if (e.target.dataset.amount || e.target.dataset.percentage) {
                        this.handleQuickFill(e);
                    }
                });
            }
        }
        
        // Mount direction switch in the slot within swap-inputs
        const directionSwitchSlot = this.element.querySelector('.direction-switch-slot');
        if (directionSwitchSlot) {
            directionSwitchSlot.innerHTML = '<button class="direction-switch">↑↓</button>';
            directionSwitchSlot.querySelector('.direction-switch').addEventListener('click', (e) => {
                this.handleDirectionSwitch(e);
            });
        }
        
        // Mount swap button
        const buttonContainer = this.element.querySelector('.swap-button-container');
        if (buttonContainer && this.swapButton) {
            this.swapButton.mount(buttonContainer);
        }
    }

    onUnmount() {
        console.log(`[${this.instanceId}] SwapInterface onUnmount called`);
        // Unsubscribe from all events
        this.eventListeners.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        
        // Clear the list
        this.eventListeners = [];
        
        // Remove child components
        if (this.transactionOptions && this.transactionOptions.element) {
            this.transactionOptions.element.remove();
        }
        
        // Ensure price display is cleaned up
        if (this.priceDisplay) {
            try {
                this.priceDisplay.unmount();
            } catch (e) {
                console.warn('Error unmounting price display:', e);
            }
            this.priceDisplay = null;
        }
        
        // Unmount sub-components
        if (this.swapInputs) {
            try {
                this.swapInputs.unmount();
            } catch (e) {
                console.warn('Error unmounting swap inputs:', e);
            }
            this.swapInputs = null;
        }
        
        // Quick fill and direction switch are handled inline, no unmount needed
        
        if (this.swapButton) {
            try {
                this.swapButton.unmount();
            } catch (e) {
                console.warn('Error unmounting swap button:', e);
            }
            this.swapButton = null;
        }
        
        // Make sure to close and clean up any open approval modal
        if (this.approveModal) {
            try {
                // Close the modal - this will trigger the approveModal:closed event
                // which will clean up related event listeners
                this.approveModal.handleClose();
            } catch (e) {
                console.warn('Error closing approval modal during unmount:', e);
            }
            this.approveModal = null;
        }
        
        // Clear any pending timers
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
            this.calculateTimer = null;
        }
    }

    handleTransactionEvents(event) {
        console.log(`[${this.instanceId}] handleTransactionEvents called with:`, {
            type: event?.type,
            hasError: !!event?.error,
            hasHash: !!event?.hash,
            eventId: event?.id || 'none',
            handled: event?.handled || false
        });
        
        // Skip if this event has already been handled by this instance
        if (event?.handledBy?.includes(this.instanceId)) {
            console.log(`[${this.instanceId}] Event already handled by this instance, skipping`);
            return;
        }
        
        // Mark this event as handled by this instance
        if (!event.handledBy) {
            event.handledBy = [];
        }
        event.handledBy.push(this.instanceId);
        
        const direction = this.state.direction === 'buy' ? 'Buy' : 'Sell';

        // Check if this is a transaction event
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        // For transaction events - only show if it's not an error
        if ((event.type === 'buy' || event.type === 'sell' || event.type === 'swap') && !event.error) {
            console.log(`[${this.instanceId}] Showing transaction pending message for type:`, event.type);
            this.messagePopup.info(
                `${direction} transaction. Simulating...`,
                'Transaction Pending'
            );
        }

        // For confirmed transactions
        if (event.hash) {
            this.messagePopup.info(
                `Transaction confirmed, waiting for completion...`,
                'Transaction Confirmed'
            );
        }

        // For successful transactions
        if (event.receipt && (event.type === 'buy' || event.type === 'sell' || event.type === 'swap')) {
            const amount = this.state.direction === 'buy' 
                ? this.state.execAmount + ' EXEC'
                : this.state.ethAmount + ' ETH';
                
            this.messagePopup.success(
                `Successfully ${direction.toLowerCase() === 'buy' ? 'bought' : 'sold'} ${amount}`,
                'Transaction Complete'
            );

            // Clear inputs after successful transaction
            this.state.ethAmount = '';
            this.state.execAmount = '';
            this.state.calculatingAmount = false;
            
            // Update child components directly
            if (this.swapInputs) {
                this.swapInputs.updateProps({
                    ethAmount: '',
                    execAmount: '',
                    calculatingAmount: false
                });
            }

            // Re-mount child components after state update
            this.mountChildComponents();
        }

        // For error transactions
        if (event.error && !event.handled) {
            console.log(`[${this.instanceId}] Handling error in handleTransactionEvents:`, event.error);
            
            let errorMessage = event.error?.message || 'Transaction failed';
            
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            const context = this.state.direction === 'buy' ? 
                'Buy Failed' : 
                'Sell Failed';
            
            this.messagePopup.error(
                `${context}: ${errorMessage}`,
                'Transaction Failed'
            );

            event.handled = true;
        }
    }

    handleTransactionOptionsUpdate(options) {
        this.transactionOptionsState = {
            message: options.message,
            nftMintingEnabled: options.nftMintingEnabled
        };
    }

    handleInput(inputType, value) {
        // Clear any existing timer
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        // Update state directly without triggering re-render
        // We'll update the child components directly instead
        this.state.activeInput = inputType;
        this.state.calculatingAmount = true;
        
        if (this.state.direction === 'buy') {
            if (inputType === 'top') {
                this.state.ethAmount = value;
            } else {
                this.state.execAmount = value;
            }
        } else {
            if (inputType === 'top') {
                this.state.execAmount = value;
            } else {
                this.state.ethAmount = value;
            }
        }
        
        // Update child components directly without triggering parent re-render
        if (this.swapInputs) {
            this.swapInputs.updateProps({
                direction: this.state.direction,
                ethAmount: this.state.ethAmount,
                execAmount: this.state.execAmount,
                calculatingAmount: this.state.calculatingAmount,
                freeMint: this.state.freeMint,
                isPhase2: this.state.isPhase2
            });
        }

        // Set debounced calculation
        this.calculateTimer = setTimeout(async () => {
            try {
                const isEthInput = (this.state.direction === 'buy') === (inputType === 'top');
                const calculatedAmount = await this.calculateSwapAmount(value, isEthInput ? 'eth' : 'exec');
                
                // Update the opposite input after calculation
                if (isEthInput) {
                    this.state.execAmount = calculatedAmount;
                    this.state.calculatingAmount = false;
                    
                    // Update child component directly
                    if (this.swapInputs) {
                        this.swapInputs.updateProps({
                            execAmount: calculatedAmount,
                            calculatingAmount: false
                        });
                    }
                } else {
                    this.state.ethAmount = calculatedAmount;
                    this.state.calculatingAmount = false;
                    
                    // Update child component directly
                    if (this.swapInputs) {
                        this.swapInputs.updateProps({
                            ethAmount: calculatedAmount,
                            calculatingAmount: false
                        });
                    }
                }
            } catch (error) {
                console.error('Error calculating swap amount:', error);
                this.state.calculatingAmount = false;
                
                // Update child component directly
                if (this.swapInputs) {
                    this.swapInputs.updateProps({
                        calculatingAmount: false
                    });
                }
            }
        }, 750);
    }

    events() {
        // Events are now handled by child components
        return {};
    }

    /**
     * Override shouldUpdate to prevent re-renders on input changes
     * Input changes are handled by child components directly
     */
    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;
        
        // Don't update if only input values changed (ethAmount, execAmount, activeInput, calculatingAmount)
        // These are handled by child components directly
        const inputOnlyChanges = 
            oldState.ethAmount !== newState.ethAmount ||
            oldState.execAmount !== newState.execAmount ||
            oldState.activeInput !== newState.activeInput ||
            oldState.calculatingAmount !== newState.calculatingAmount;
        
        // If only input values changed, don't re-render (child components handle it)
        if (inputOnlyChanges && 
            oldState.direction === newState.direction &&
            oldState.freeMint === newState.freeMint &&
            oldState.freeSupply === newState.freeSupply &&
            oldState.isPhase2 === newState.isPhase2 &&
            oldState.dataReady === newState.dataReady) {
            return false;
        }
        
        // Update for other state changes (direction, phase, dataReady, etc.)
        return true;
    }

    handleDirectionSwitch(e) {
        // Prevent default button behavior and stop propagation
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // Clear any pending calculations
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        const newDirection = this.state.direction === 'buy' ? 'sell' : 'buy';
        
        console.log('Direction Switch - Current State:', {
            direction: this.state.direction,
            newDirection,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply
        });

        // Use setState instead of directly modifying state
        // This will trigger update() which handles re-rendering properly
        this.setState({
            direction: newDirection,
            calculatingAmount: false,
            activeInput: null
        });

        this.store.setDirection(newDirection === 'buy');

        // Update child components with new direction
        // Don't replace innerHTML - let Component.update() handle it
        requestAnimationFrame(() => {
            this.mountChildComponents();
        });
    }

    isLiquidityDeployed() {
        const contractData = this.store.selectContractData();
        // Handle case where contractData might be null/undefined or liquidityPool not set yet
        if (!contractData || !contractData.liquidityPool) {
            return false;
        }
        const result = contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';
        console.log('isLiquidityDeployed check:', {
            liquidityPool: contractData.liquidityPool,
            result: result
        });
        return result;
    }

    async handleSwap() {
        try {
            // Validate inputs
            if (this.state.calculatingAmount) {
                this.messagePopup.info('Please wait for the calculation to complete', 'Loading');
                return;
            }
            
            const { ethAmount, execAmount, direction } = this.state;
            
            if (!ethAmount || !execAmount || parseFloat(ethAmount) <= 0 || parseFloat(execAmount) <= 0) {
                this.messagePopup.info('Please enter valid amounts', 'Invalid Input');
                return;
            }
            
            // Check if user has enough balance
            const balances = this.store.selectBalances();
            
            if (direction === 'buy') {
                // Convert ETH balance from wei to ETH if needed
                // balances.eth might be in wei (string) or already in ETH (number)
                let ethBalance;
                if (typeof balances.eth === 'string' && balances.eth.length > 10) {
                    // Likely in wei, convert to ETH
                    ethBalance = this.blockchainService.formatEther(balances.eth);
                } else {
                    // Already in ETH format
                    ethBalance = parseFloat(balances.eth || 0);
                }
                
                const ethNeeded = parseFloat(ethAmount);
                
                if (isNaN(ethNeeded) || isNaN(ethBalance) || ethNeeded > ethBalance) {
                    this.messagePopup.info(`Not enough ETH balance. You have ${ethBalance.toFixed(6)} ETH, need ${ethNeeded} ETH`, 'Insufficient Balance');
                    return;
                }
            } else {
                // Selling EXEC - need to check EXEC balance
                // balances.exec is stored as an integer (base units, not wei)
                // Compare directly after removing commas
                const execAmountClean = execAmount.replace(/,/g, '');
                const execBalance = BigInt(balances.exec || 0);
                const execNeeded = BigInt(parseInt(execAmountClean) || 0);
                
                if (execNeeded > execBalance) {
                    const execBalanceFormatted = parseInt(balances.exec || 0).toLocaleString();
                    const execNeededFormatted = parseInt(execAmountClean).toLocaleString();
                    this.messagePopup.info(`Not enough EXEC balance. You have ${execBalanceFormatted} EXEC, need ${execNeededFormatted} EXEC`, 'Insufficient Balance');
                    return;
                }
            }

            // Check if a free mint token is being sold
            if (direction === 'sell' && parseInt(execAmount.replace(/,/g, '')) <= 1000000 && this.state.freeMint) {
                this.messagePopup.info(
                    'Free minted tokens cannot be sold directly. Please trade more tokens or use a different address.', 
                    'Free Mint Restriction'
                );
                return;
            }
            
            const isLiquidityDeployed = this.isLiquidityDeployed();
            console.log('isLiquidityDeployed', isLiquidityDeployed);
            const cleanExecAmount = this.state.execAmount.replace(/,/g, '');

            if (isLiquidityDeployed) {
                const ethValue = this.blockchainService.parseEther(this.state.ethAmount);
                const execAmount = this.blockchainService.parseExec(cleanExecAmount);
                
                // Make sure we have the address resolved
                const address = await this.getAddress();
                
                // Check if we have a valid address
                if (!address) {
                    console.error('No wallet address available for transaction');
                    this.messagePopup.error(
                        'No wallet address available. Please reconnect your wallet.',
                        'Wallet Error'
                    );
                    return;
                }
                
                console.log(`Using address for transaction: ${address}`);

                if (this.state.direction === 'buy') {
                    // For buying, don't specify an expected output amount - this will be calculated in the service
                    await this.blockchainService.swapExactEthForTokenSupportingFeeOnTransfer(address, {
                        amount: execAmount, // Pass the full amount - it will be adjusted in the service
                    }, ethValue);
                } else {
                    // Check router allowance before selling
                    console.log(`Checking approval for ${address} to spend ${execAmount} tokens`);
                    
                    // Get the router address (could be a string or an object with address)
                    const routerAddress = this.blockchainService.swapRouter?.address || this.blockchainService.swapRouter;
                    console.log(`Router address for approval check: ${routerAddress}`);
                    
                    const routerAllowance = await this.blockchainService.getApproval(address, routerAddress);
                    console.log(`Current allowance: ${routerAllowance}, Required: ${execAmount}`);
                    
                    if (BigInt(routerAllowance) < BigInt(execAmount)) {
                        // Clean up any existing approval modal
                        if (this.approveModal) {
                            // Try to properly close the existing modal
                            try {
                                eventBus.off('approve:complete');
                                this.approveModal.handleClose();
                            } catch (e) {
                                console.warn('Error closing existing approval modal:', e);
                            }
                            this.approveModal = null;
                        }
                        
                        // Create and mount a new modal
                        this.approveModal = new ApproveModal(cleanExecAmount, this.blockchainService, address);
                        this.approveModal.mount(document.body);
                        
                        // Listen for approval completion
                        const approvalCompleteHandler = async () => {
                            console.log('[DEBUG-SwapInterface] approvalCompleteHandler triggered');
                            try {
                                console.log('[DEBUG-SwapInterface] Approval complete, proceeding with token swap');
                                console.log('[DEBUG-SwapInterface] Address:', address);
                                console.log('[DEBUG-SwapInterface] Amount:', execAmount);
                                await this.blockchainService.swapExactTokenForEthSupportingFeeOnTransferV2(address, {
                                    amount: execAmount,
                                });
                                console.log('[DEBUG-SwapInterface] Swap transaction completed successfully');
                            } catch (error) {
                                console.error('[DEBUG-SwapInterface] Error during post-approval swap:', error);
                                this.messagePopup.error(
                                    `Swap Failed: ${error.message}`,
                                    'Transaction Failed'
                                );
                            }
                        };
                        
                        // Use eventBus.once for one-time event handling
                        console.log('[DEBUG-SwapInterface] Setting up approve:complete event listener');
                        eventBus.once('approve:complete', approvalCompleteHandler);
                        
                        // Listen for modal closed event to clean up resources
                        console.log('[DEBUG-SwapInterface] Setting up approveModal:closed event listener');
                        eventBus.once('approveModal:closed', () => {
                            console.log('[DEBUG-SwapInterface] ApproveModal closed event received, cleaning up');
                            // The approval listener will automatically clean itself up
                            this.approveModal = null;
                        });
                        
                        // Show the modal
                        this.approveModal.show();
                        return;
                    }

                    await this.blockchainService.swapExactTokenForEthSupportingFeeOnTransferV2(address, {
                        amount: execAmount,
                    });
                }
            } else {
                // Get merkle proof with proper error handling
                let proof;
                try {
                    const currentTier = await this.blockchainService.getCurrentTier();
                    proof = await this.blockchainService.getMerkleProof(
                        this.address,
                        currentTier
                    );
                    
                    if (!proof) {
                        this.messagePopup.error(
                            `You are not whitelisted for Tier ${currentTier + 1}. Please wait for your tier to be activated.`,
                            'Not Whitelisted'
                        );
                        return;
                    }
                } catch (error) {
                    this.messagePopup.error(
                        'Failed to verify whitelist status. Please try again later.',
                        'Whitelist Check Failed'
                    );
                    return;
                }
                // Use original bonding curve logic
                let adjustedExecAmount = cleanExecAmount;
                if (this.state.direction === 'buy') {
                    const { freeSupply, freeMint } = this.store.selectFreeSituation();
                    if (freeSupply > 0 && !freeMint) {
                        const numAmount = parseInt(cleanExecAmount);
                        adjustedExecAmount = Math.max(0, numAmount - 1000000).toString();
                    }
                }

                const ethValue = this.blockchainService.parseEther(this.state.ethAmount);
                const execAmount = this.blockchainService.parseExec(adjustedExecAmount);

                if (this.state.direction === 'buy') {
                    await this.blockchainService.buyBonding({
                        amount: execAmount,
                        maxCost: ethValue,
                        mintNFT: this.transactionOptionsState.nftMintingEnabled,
                        proof: proof.proof,
                        message: this.transactionOptionsState.message
                    }, ethValue);
                } else {
                    const minReturn = BigInt(ethValue) * BigInt(999) / BigInt(1000);
                    await this.blockchainService.sellBonding({
                        amount: execAmount,
                        minReturn: minReturn,
                        proof: proof.proof,
                        message: this.transactionOptionsState.message
                    });
                }
            }
        } catch (error) {
            console.error('Swap failed:', error);
            
            // Clean up the error message but preserve the Tx Reverted prefix
            let errorMessage = error.message;
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            // Add context based on the operation
            const context = this.state.direction === 'buy' ? 
                'Buy Failed' : 
                'Sell Failed';
            
            this.messagePopup.error(
                `${context}: ${errorMessage}`,
                'Transaction Failed'
            );
        }
    }

    handleQuickFill(e) {
        e.preventDefault();
        
        const amount = e.target.dataset.amount;
        const percentage = e.target.dataset.percentage;
        
        let value;
        
        if (amount) {
            // Direct amount fill
            value = amount;
        } else if (percentage) {
            // Percentage of balance (only used for selling EXEC)
            const balances = this.store.selectBalances();
            const execBalance = balances.exec;
            
            if (!execBalance || execBalance === '0') {
                console.warn('No EXEC balance available for quick fill');
                return;
            }

            // Convert from full decimal representation to human-readable number first
            let readableBalance = BigInt(execBalance) / BigInt(1e18);
            
            // If user has free mint, subtract 1M from available balance
            if (this.state.freeMint) {
                readableBalance = readableBalance - BigInt(1000000);    
                // Check if there's any sellable balance after subtracting free mint
                if (readableBalance <= 0) {
                    this.messagePopup.info(
                        'You only have free mint tokens which cannot be sold.',
                        'Cannot Quick Fill'
                    );
                    return;
                }
            }

            // Calculate percentage of sellable balance
            const amount = (readableBalance * BigInt(percentage)) / BigInt(100);
            value = amount.toString();
        }

        // Update the top input with the new value
        this.handleInput('top', value);
    }

    handleContractDataUpdate() {
        try {
            // Store the previous phase state before updating
            const previousPhase = this.state.isPhase2;
            const wasDataReady = this.state.dataReady;
            const phaseWasUnknown = previousPhase === null;
            
            // Get fresh contract data from store
            const contractData = this.store.selectContractData();
            const isPhase2 = this.isLiquidityDeployed();
            
            // Update state directly first
            this.state.isPhase2 = isPhase2;
            this.state.dataReady = true;
            
            // If phase was unknown and is now determined, initialize child components
            if (phaseWasUnknown && this.state.isPhase2 !== null) {
                console.log(`[${this.instanceId}] Phase determined: ${isPhase2 ? 'Phase 2' : 'Phase 1'}, initializing child components`);
                this.initializeChildComponents();
                // Trigger re-render now that phase is known
                this.setState({ dataReady: true, isPhase2 });
                requestAnimationFrame(() => {
                    this.mountChildComponents();
                });
                return;
            }
            
            // If data just became ready, we need to mount all child components
            if (!wasDataReady && this.state.dataReady) {
                console.log(`[${this.instanceId}] Data just became ready, mounting all child components`);
                // Use setState to trigger initial render, but only once
                this.setState({ dataReady: true, isPhase2 });
                requestAnimationFrame(() => {
                    this.mountChildComponents();
                });
                return;
            }
            
            // If phase changed, we need to update child components but NOT full re-render
            // The UI structure doesn't actually change much between phases
            if (previousPhase !== this.state.isPhase2) {
                console.log(`Phase changed from ${previousPhase ? 'Phase 2' : 'Phase 1'} to ${this.state.isPhase2 ? 'Phase 2' : 'Phase 1'}`);
                
                // Update child components with new phase info
                if (this.swapInputs) {
                    this.swapInputs.updateProps({
                        isPhase2: this.state.isPhase2
                    });
                }
                
                // Only update PriceDisplay if it's not already mounted
                const priceContainer = this.element.querySelector('.price-display-container');
                if (priceContainer && this.priceDisplay) {
                    const shouldRemount = !this.priceDisplay.element || 
                        !priceContainer.contains(this.priceDisplay.element);
                        
                    if (shouldRemount) {
                        console.log('Remounting PriceDisplay due to phase change');
                        this.priceDisplay.mount(priceContainer);
                    } else {
                        // Just update the price display
                        this.priceDisplay.update();
                    }
                }
                
                // Don't trigger full re-render - child components handle phase changes
                return;
            }
            
            // Only update PriceDisplay if it's not already mounted
            const priceContainer = this.element.querySelector('.price-display-container');
            if (priceContainer && this.priceDisplay) {
                // We only need to remount if the price display hasn't been properly mounted yet
                const shouldRemount = !this.priceDisplay.element || 
                    !priceContainer.contains(this.priceDisplay.element);
                    
                if (shouldRemount) {
                    console.log('Remounting PriceDisplay due to missing element');
                    this.priceDisplay.mount(priceContainer);
                } else {
                    // Just tell the price display to update its internal state if needed
                    this.priceDisplay.update();
                }
            }
        } catch (error) {
            console.error('Error in handleContractDataUpdate:', error);
            // Don't let errors break the component - ensure it still renders
            if (!this.state.dataReady) {
                this.state.dataReady = true;
                this.state.isPhase2 = this.isLiquidityDeployed();
                // Only trigger render if we haven't rendered yet
                if (!this.element || !this.element.innerHTML) {
                    this.update();
                }
            }
        }
    }

    render() {
        console.log('🎨 SwapInterface.render - Starting render');
        const { direction, ethAmount, execAmount, calculatingAmount, isPhase2, dataReady } = this.state;

        // Wait for both dataReady AND phase to be determined before showing full UI
        // This prevents flash of incorrect phase UI
        if (!dataReady || isPhase2 === null) {
            return `
                <div class="price-display-container"></div>
                <div class="quick-fill-buttons-container"></div>
                <div class="swap-inputs-container">
                    <div style="padding: 20px; text-align: center;">Loading swap interface...</div>
                </div>
                <div class="transaction-options-container"></div>
                <div class="swap-button-container"></div>
            `;
        }

        console.log('Render - Current State:', {
            direction,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply,
            isPhase2: this.state.isPhase2
        });
        
        const balances = this.store.selectBalances();
        
        // Format balances with appropriate decimals
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();
        // Calculate available balance for selling
        const availableExecBalance = direction === 'sell' && this.state.freeMint
        ? `Available: ${(parseInt(balances.exec) - 1000000).toLocaleString()}`
        : `Balance: ${formattedExecBalance}`;
        
        const result = `
            <div class="price-display-container"></div>
            ${direction === 'sell' && this.state.freeMint && !isPhase2 ? 
                `<div class="free-mint-notice">
                    You have 1,000,000 $EXEC you received for free that cannot be sold here.
                </div>` 
                : direction === 'buy' && this.state.freeSupply > 0 && !this.state.freeMint && !isPhase2 ?
                `<div class="free-mint-notice free-mint-bonus">
                    1,000,000 $EXEC will be added to your purchase. Thank you.
                </div>`
                : ''
            }
            <div class="quick-fill-buttons-container"></div>
            <div class="swap-inputs-container"></div>
            <div class="transaction-options-container"></div>
            <div class="swap-button-container"></div>
        `;
        console.log('🎨 SwapInterface.render - Completed render');
        return result;
    }

    /**
     * Get the user's wallet address, resolving any promise if needed
     * @returns {Promise<string>} Resolved address
     */
    async getAddress() {
        try {
            // If address is not set, try to get it from the store
            if (!this._address) {
                const walletState = this.store.selectWallet();
                if (walletState && walletState.address) {
                    this._address = walletState.address;
                }
            }
            
            // Resolve the address if it's a Promise
            const resolvedAddress = await Promise.resolve(this._address);
            
            // Log the resolved address for debugging
            console.log(`[${this.instanceId}] Resolved address: ${resolvedAddress}`);
            
            return resolvedAddress;
        } catch (error) {
            console.error(`[${this.instanceId}] Error resolving address:`, error);
            return null;
        }
    }
    
    /**
     * Update the user's wallet address
     * @param {string} newAddress - The new wallet address
     */
    setAddress(newAddress) {
        this._address = newAddress;
    }
    
    /**
     * Property to maintain backward compatibility with old code
     */
    get address() {
        return this._address;
    }
    
    /**
     * Property setter to maintain backward compatibility
     */
    set address(newAddress) {
        this._address = newAddress;
    }
}