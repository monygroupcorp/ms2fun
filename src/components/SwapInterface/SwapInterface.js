import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { TransactionOptions } from '../TransactionOptions/TransactionOptions.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { eventBus } from '../../core/EventBus.js';
import PriceDisplay  from '../PriceDisplay/PriceDisplay.js';

export default class SwapInterface extends Component {
    constructor(blockchainService) {
        super();
        this.blockchainService = blockchainService;
        this.store = tradingStore;
        this.state = {
            direction: 'buy',
            ethAmount: '',
            execAmount: '',
            activeInput: null,
            calculatingAmount: false
        };
        
        // Initialize child components
        this.transactionOptions = new TransactionOptions();
        this.messagePopup = new MessagePopup('status-message');
        this.priceDisplay = new PriceDisplay();
        this.messagePopup.initialize();
        
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
    }

    // Add new method to handle balance updates
    handleBalanceUpdate() {
        // Update only the balance displays without full re-render
        const balances = this.store.selectBalances();
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();

        // Update all balance displays
        const balanceDisplays = this.element.querySelectorAll('.token-balance');
        balanceDisplays.forEach(display => {
            const isEthBalance = display.previousElementSibling.textContent.includes('ETH');
            display.textContent = `Balance: ${isEthBalance ? formattedEthBalance : formattedExecBalance}`;
        });
    }

    updateElements() {
        const { activeInput, calculatingAmount, direction } = this.state;
        
        // Update inactive input
        if (activeInput === 'top') {
            const bottomInput = this.element.querySelector('.bottom-input');
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.execAmount : this.state.ethAmount);
            }
        } else if (activeInput === 'bottom') {
            const topInput = this.element.querySelector('.top-input');
            if (topInput && !topInput.matches(':focus')) {
                topInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.ethAmount : this.state.execAmount);
            }
        }

        // Update action button
        const actionButton = this.element.querySelector('.swap-button');
        if (actionButton) {
            actionButton.textContent = this.state.direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';
        }
    }

    async calculateSwapAmount(amount, inputType) {
        // Handle empty or invalid input
        if (!amount || isNaN(parseFloat(amount))) {
            return '';
        }

        try {
            if (inputType === 'eth') {
                // Calculate how much EXEC user will receive for their ETH
                const execAmount = await this.blockchainService.getExecForEth(amount);
                console.log('EXEC amount:', execAmount);
                // Round down to ensure we don't exceed maxCost
                return Math.floor(execAmount).toString();
            } else {
                // Calculate how much ETH user will receive for their EXEC
                const ethAmount = await this.blockchainService.getEthForExec(amount);
                console.log('ETH amount:', ethAmount);
                // Reduce the minRefund slightly (0.1% less) to account for any calculation differences
                // This ensures we stay above the actual minRefund requirement
                return (parseFloat(ethAmount) * 0.999).toFixed(18); // Use more decimals for precision
            }
        } catch (error) {
            console.error('Error calculating swap amount:', error);
            return '';
        }
    }

    onMount() {
        this.bindEvents();
        
        // Mount transaction options
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        if (optionsContainer) {
            this.transactionOptions.mount(optionsContainer);
        }
        this.priceDisplay.mount(this.element.querySelector('.price-display-container'));

        // Subscribe to transaction events
        eventBus.on('transaction:pending', this.handleTransactionEvents);
        eventBus.on('transaction:confirmed', this.handleTransactionEvents);
        eventBus.on('transaction:success', this.handleTransactionEvents);
        eventBus.on('transaction:error', this.handleTransactionEvents);
        eventBus.on('balances:updated', this.handleBalanceUpdate);
        
        // Subscribe to transaction options updates
        eventBus.on('transactionOptions:update', this.handleTransactionOptionsUpdate);
        
    }

    onUnmount() {
        if (this.transactionOptions) {
            this.transactionOptions.unmount();
        }
        this.priceDisplay.unmount();

        // Unsubscribe from transaction events
        eventBus.off('transaction:pending', this.handleTransactionEvents);
        eventBus.off('transaction:confirmed', this.handleTransactionEvents);
        eventBus.off('transaction:success', this.handleTransactionEvents);
        eventBus.off('transaction:error', this.handleTransactionEvents);
        eventBus.off('balances:updated', this.handleBalanceUpdate);
        
        // Unsubscribe from transaction options updates
        eventBus.off('transactionOptions:update', this.handleTransactionOptionsUpdate);
    }

    handleTransactionEvents(event) {
        
        const direction = this.state.direction === 'buy' ? 'Buy' : 'Sell';

        // Check if this is a transaction event
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        // For transaction events
        if (event.type === 'buy' || event.type === 'sell') {
            this.messagePopup.info(
                `${direction} transaction submitted. Waiting for confirmation...`,
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
        if (event.receipt) {
            const amount = this.state.direction === 'buy' 
                ? this.state.execAmount + ' EXEC'
                : this.state.ethAmount + ' ETH';
                
            this.messagePopup.success(
                `Successfully ${direction.toLowerCase() == 'buy' ? 'bought' : 'sold'} ${amount}`,
                'Transaction Complete'
            );

            // Clear inputs after successful transaction
            this.setState({
                ethAmount: '',
                execAmount: '',
                calculatingAmount: false
            });

            // Re-mount child components after state update
            const optionsContainer = this.element.querySelector('.transaction-options-container');
            const priceContainer = this.element.querySelector('.price-display-container');
            
            if (optionsContainer) {
                this.transactionOptions.mount(optionsContainer);
            }
            
            if (priceContainer) {
                this.priceDisplay.mount(priceContainer);
            }
        }

        // For error transactions
        if (event.error) {
            const errorMessage = event.error?.message || 'Transaction failed';
            this.messagePopup.error(
                errorMessage,
                'Transaction Failed'
            );
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

        // Update state immediately to show we're calculating
        this.state.activeInput = inputType;
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
        this.state.calculatingAmount = true;
        this.updateElements();

        // Set debounced calculation
        this.calculateTimer = setTimeout(async () => {
            try {
                const isEthInput = (this.state.direction === 'buy') === (inputType === 'top');
                const calculatedAmount = await this.calculateSwapAmount(value, isEthInput ? 'eth' : 'exec');
                
                // Update the opposite input after calculation
                if (isEthInput) {
                    this.state.execAmount = calculatedAmount;
                } else {
                    this.state.ethAmount = calculatedAmount;
                }
                this.state.calculatingAmount = false;
                this.updateElements();
            } catch (error) {
                console.error('Error calculating swap amount:', error);
                this.state.calculatingAmount = false;
                this.updateElements();
            }
        }, 750);
    }

    events() {
        return {
            'input .top-input': (e) => this.handleInput('top', e.target.value),
            'input .bottom-input': (e) => this.handleInput('bottom', e.target.value),
            'click .direction-switch': (e) => this.handleDirectionSwitch(e),
            'click .swap-button': (e) => this.handleSwap(),
            'click [data-amount]': (e) => this.handleQuickFill(e),
            'click [data-percentage]': (e) => this.handleQuickFill(e)
        };
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
        
        // Store current values but DON'T swap them
        // Just change the direction
        this.state = {
            ...this.state,
            direction: newDirection,
            calculatingAmount: false,
            activeInput: null
        };

        // Unbind events before updating content
        this.unbindEvents();
        
        // Force full re-render
        const newContent = this.render();
        this.element.innerHTML = newContent;
        
        // Re-mount both transaction options and price display
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        const priceContainer = this.element.querySelector('.price-display-container');
        
        if (optionsContainer) {
            this.transactionOptions.mount(optionsContainer);
        }
        
        if (priceContainer) {
            this.priceDisplay.mount(priceContainer);
        }
        
        console.log('SwapInterface - after direction switch, options state:', this.transactionOptionsState);
        
        // Rebind events
        this.bindEvents();
    }

    async handleSwap() {
        try {
            console.log('SwapInterface - handleSwap called');
            
            // Remove any commas from execAmount and convert to string
            const cleanExecAmount = this.state.execAmount.replace(/,/g, '');
            
            // Parse amounts with proper decimal handling for contract interaction
            const ethValue = this.blockchainService.parseEther(this.state.ethAmount);
            const execAmount = this.blockchainService.parseExec(cleanExecAmount);
            
            // Get merkle proof
            const proof = await this.blockchainService.getMerkleProof(
                await this.store.selectConnectedAddress()
            );

            console.log('Parsed values for contract:', {
                ethValue,
                execAmount,
                direction: this.state.direction
            });

            if (this.state.direction === 'buy') {
                await this.blockchainService.buyBonding({
                    amount: execAmount,      // Will be like "1000000000000000000000000" for 1M EXEC
                    maxCost: ethValue,       // Will be like "2500000000000000" for 0.0025 ETH
                    mintNFT: this.transactionOptionsState.nftMintingEnabled,
                    proof: proof.proof,
                    message: this.transactionOptionsState.message
                }, ethValue);
            } else {
                await this.blockchainService.sellBonding({
                    amount: execAmount,      // Will be like "1000000000000000000000000" for 1M EXEC
                    minReturn: ethValue,     // Will be like "2500000000000000" for 0.0025 ETH
                    proof: proof.proof,
                    message: this.transactionOptionsState.message
                });
            }
        } catch (error) {
            console.error('Swap failed:', error);
            this.messagePopup.error(error.message, 'Swap Failed');
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
            const readableBalance = BigInt(execBalance) / BigInt(1e18);
            // Calculate percentage
            const amount = (readableBalance * BigInt(percentage)) / BigInt(100);
            value = amount.toString();
        }

        // Update the top input with the new value
        this.handleInput('top', value);
        
        // Update the input element directly
        const topInput = this.element.querySelector('.top-input');
        if (topInput) {
            topInput.value = value;
        }
    }

    render() {
        const { direction, ethAmount, execAmount, calculatingAmount } = this.state;
        const balances = this.store.selectBalances();
        
        // Format balances with appropriate decimals
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();
        
        console.log('Rendering with values:', { direction, ethAmount, execAmount, balances });
        return `
            <div class="swap-interface">
                <div class="price-display-container"></div>
                <div class="quick-fill-buttons">
                    ${direction === 'buy' ? 
                        `
                        <button data-amount="0.0025">0.0025</button>
                        <button data-amount="0.01">0.01</button>
                        <button data-amount="0.05">0.05</button>
                        <button data-amount="0.1">0.1</button>
                        `
                    :
                        `
                        <button data-percentage="25">25%</button>
                        <button data-percentage="50">50%</button>
                        <button data-percentage="75">75%</button>
                        <button data-percentage="100">100%</button>
                        `
                    }
                </div>
                <div class="swap-inputs">
                    <div class="input-container">
                        <input type="text" 
                               class="top-input" 
                               value="${direction === 'buy' ? ethAmount : execAmount}" 
                               placeholder="0.0"
                               pattern="^[0-9]*[.]?[0-9]*$">
                        <div class="token-info">
                            <span class="token-symbol">${direction === 'buy' ? 'ETH' : '$EXEC'}</span>
                            <span class="token-balance">Balance: ${direction === 'buy' ? formattedEthBalance : formattedExecBalance}</span>
                        </div>
                    </div>
                    <button class="direction-switch">↑↓</button>
                    <div class="input-container">
                        <input type="text" 
                               class="bottom-input" 
                               value="${direction === 'buy' ? execAmount : ethAmount}" 
                               placeholder="0.0"
                               pattern="^[0-9]*[.]?[0-9]*$">
                        <div class="token-info">
                            <span class="token-symbol">${direction === 'buy' ? '$EXEC' : 'ETH'}</span>
                            <span class="token-balance">Balance: ${direction === 'buy' ? formattedExecBalance : formattedEthBalance}</span>
                        </div>
                    </div>
                </div>
                <div class="transaction-options-container"></div>
                <button class="swap-button">
                    ${direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC'}
                </button>
            </div>
        `;
    }
}