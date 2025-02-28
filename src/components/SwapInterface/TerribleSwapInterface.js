import {Component} from '../../core/Component.js';
import {eventBus} from '../../core/EventBus.js';
import { debounce } from '../../utils/helper.js';
import PriceDisplay from '../PriceDisplay/PriceDisplay.js';
import { TransactionOptions } from '../TransactionOptions/TransactionOptions.js';
import BalanceDisplay from '../BalanceDisplay/BalanceDisplay.js';
import { tradingStore } from '../../store/tradingStore.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Add event name constants at the top
const EVENTS = {
    INPUT: {
        AMOUNT: 'swap:input:amount',
        TOKEN: 'swap:input:token'
    },
    CLICK: {
        SWITCH: 'swap:click:switch',
        SWAP: 'swap:click:swap',
        QUICK_FILL: 'swap:click:quick-fill'
    },
    UPDATE: {
        PRICE: 'price:updated',
        BALANCE: 'balance:updated'
    }
};

export default class SwapInterface extends Component {
    constructor(blockchainService) {
        super();
        
        // Use tradingStore instead of local store
        this.store = tradingStore;
        this.blockchainService = blockchainService;
        // Bind handlers using arrow functions for consistency
        this.handleInputChange = (data) => {
            console.group('handleInputChange Flow');
            console.log('3. handleInputChange triggered:', data);
            
            const value = data.value.replace(/[^\d.]/g, '');
            console.log('4. Processed value:', value);
            
            if (value === '.' || value === '0.') {
                console.log('Skipping store update for incomplete number');
                console.groupEnd();
                return;
            }
            
            if (value === '' || isNaN(parseFloat(value))) {
                console.log('5a. Invalid number - updating store with empty values');
                this.store.updateAmounts('', '');
                console.groupEnd();
                return;
            }
            
            const { isEthToExec } = this.store.selectDirection();
            const isFromInput = data.isFromInput;
            
            console.log('5b. Processing valid input:', {
                value,
                isEthToExec,
                isFromInput
            });
            
            if (isEthToExec) {
                if (isFromInput) {
                    console.log('6. Updating store with ETH amount:', value);
                    this.store.updateAmounts(value, '');
                    this.debouncedInputUpdate(value);
                }
            } else {
                if (isFromInput) {
                    console.log('6. Updating store with EXEC amount:', value);
                    this.store.updateAmounts('', value);
                    this.debouncedInputUpdate(value);
                }
            }
            this.store.setError(null);
            console.groupEnd();
        };

        this.handleDirectionSwitch = () => {
            const currentDirection = this.store.selectDirection();
            this.store.setDirection(!currentDirection);
            this.store.updateAmounts('', ''); // Reset amounts
            this.store.setError(null);
        };

        this.handlePriceUpdate = (data) => {
            const amounts = this.store.selectAmounts();
            const inputAmount = this.store.selectDirection() ? amounts.eth : amounts.exec;
            if (parseFloat(inputAmount) > 0) {
                this.updateOutputAmount(inputAmount);
            }
        };

        this.handleBalanceUpdate = ({ eth, exec }) => {
            this.store.updateBalances({ eth, exec });
        };
        
        // Create debounced input handler
        this.debouncedInputUpdate = debounce(this.updateOutputAmount.bind(this), 300);

        // Initialize child components
        this.priceDisplay = new PriceDisplay();
        this.transactionOptions = new TransactionOptions();
        this.balanceDisplay = new BalanceDisplay();

        // Add handler for transaction validation
        this.handleTransactionValidation = ({ isValid, errors }) => {
            this.store.setTransactionValidity(isValid);
            if (!isValid && errors.length > 0) {
                this.store.setError(errors[0]); // Show first error
            }
        };

        this.handleQuickFill = (data) => {
            console.log('Quick fill event detected', data);
            const value = data.value;
            const { isEthToExec } = this.store.selectDirection();
            const currentPrice = this.store.selectPrice().current;
            
            console.log('Direction:', isEthToExec ? 'ETH -> EXEC' : 'EXEC -> ETH');
            console.log('Input value:', value);
            console.log('Current price:', currentPrice);
            
            if (isEthToExec) {
                // Buying EXEC - use fixed ETH amounts
                const ethAmount = value.toString();
                console.log('Setting ETH amount for EXEC purchase:', ethAmount);
                this.store.updateAmounts(ethAmount, '');
                this.updateOutputAmount(ethAmount);
            } else {
                // Selling EXEC - use percentages of balance
                const balances = this.store.selectBalances();
                const execBalance = ethers.utils.formatUnits(balances.exec, 0);
                console.log('EXEC balance for percentage calc:', execBalance);
                const percentage = parseFloat(value);
                const execAmount = Math.floor(parseFloat(execBalance) * (percentage / 100)).toString();
                console.log('Calculated EXEC amount from percentage:', execAmount);
                this.store.updateAmounts('', execAmount);
                this.updateOutputAmount(execAmount);
            }
            
            this.store.setError(null);
        };
    }

    mount(container) {
        super.mount(container); // This will set this.element
        
        // Setup event listeners after we have a DOM element
        this.setupDOMEventListeners();
        
        // Any other mount-time initialization
        if (this.onMount) {
            this.onMount();
        }
    }

    onMount() {
        // Subscribe to store changes
        this.unsubscribeStore = this.store.subscribe(() => this.update());

        // Subscribe to all events using EventBus
        this.unsubscribeHandlers = [
            eventBus.on(EVENTS.INPUT.AMOUNT, this.handleInputChange),
            eventBus.on(EVENTS.INPUT.TOKEN, this.handleInputChange),
            eventBus.on(EVENTS.CLICK.SWITCH, this.handleDirectionSwitch),
            eventBus.on(EVENTS.UPDATE.PRICE, this.handlePriceUpdate),
            eventBus.on(EVENTS.UPDATE.BALANCE, this.handleBalanceUpdate),
            eventBus.on('transactionValidation', this.handleTransactionValidation),
            eventBus.on(EVENTS.CLICK.QUICK_FILL, this.handleQuickFill)
        ];

        // Add DOM event delegation
        this.setupDOMEventListeners();

        // Initial price fetch
        this.fetchPrice();

        // Mount child components
        const priceContainer = this.element.querySelector('#price-display-container');
        const balanceContainer = this.element.querySelector('#balance-display-container');
        const transactionContainer = this.element.querySelector('#transaction-options-container');

        if (priceContainer) this.priceDisplay.mount(priceContainer);
        if (balanceContainer) this.balanceDisplay.mount(balanceContainer);
        
        // Add debug logs
        //console.log('Transaction container found:', transactionContainer);
        //console.log('Transaction container dimensions:', transactionContainer?.getBoundingClientRect());
        
        if (transactionContainer) {
            console.log('Mounting transaction options to container');
            this.transactionOptions.mount(transactionContainer);
        } else {
            console.error('Transaction container not found!');
        }
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        let activeInputElement = null;
        let activeInputValue = null;  // Add this to track the current input value
        let isProcessingUpdate = false;
        
        const handleInput = (e) => {
            console.group('Input Event Flow');
            const input = e.target;
            activeInputElement = input;
            activeInputValue = input.value;  // Store the current input value
            const value = input.value;
            const isFromInput = input.dataset.input === 'from';
            
            isProcessingUpdate = true;
            
            eventBus.emit(EVENTS.INPUT.AMOUNT, { 
                value,
                isFromInput
            });
            
            setTimeout(() => {
                isProcessingUpdate = false;
            }, 0);
            
            console.groupEnd();
        };

        const handleFocus = (e) => {
            activeInputElement = e.target;
        };

        const handleBlur = (e) => {
            // Only clear activeInputElement if we're not processing an update
            if (!isProcessingUpdate) {
                activeInputElement = null;
            }
        };

        const handleClick = (e) => {
            console.log('Click event detected', e.target);
            
            // Handle direction switch
            const switchButton = e.target.closest('.swap-arrow-button');
            if (switchButton) {
                console.log('Switch button clicked');
                eventBus.emit(EVENTS.CLICK.SWITCH);
                return;
            }

            // Handle quick fill buttons
            const quickFillButton = e.target.closest('.quick-fill');
            if (quickFillButton) {
                console.log('Quick fill button clicked');
                const value = parseFloat(quickFillButton.dataset.value);
                eventBus.emit(EVENTS.CLICK.QUICK_FILL, { value });
                return;
            }
        };

        // Clean up existing listeners
        if (this._clickHandler) {
            this.element.removeEventListener('click', this._clickHandler);
        }
        if (this._inputHandler) {
            this.element.removeEventListener('input', this._inputHandler);
        }

        this._clickHandler = handleClick;
        this._inputHandler = handleInput;
        
        this.element.addEventListener('click', this._clickHandler);
        
        // Set up input event listeners with focus tracking
        const inputs = this.element.querySelectorAll('.token-input');
        inputs.forEach(input => {
            input.addEventListener('input', this._inputHandler);
            input.addEventListener('focus', handleFocus);
            input.addEventListener('blur', handleBlur);
        });

        // Update restore focus function to also restore value
        this._restoreFocus = () => {
            if (activeInputElement) {
                const cursorPosition = activeInputElement.selectionStart;
                requestAnimationFrame(() => {
                    activeInputElement.value = activeInputValue;  // Restore the value
                    activeInputElement.focus();
                    activeInputElement.setSelectionRange(cursorPosition, cursorPosition);
                });
            }
        };
    }

    onUnmount() {
        // Clean up store subscription
        if (this.unsubscribeStore) this.unsubscribeStore();

        // Clean up event subscriptions
        if (this.unsubscribeHandlers) {
            this.unsubscribeHandlers.forEach(unsubscribe => unsubscribe());
        }

        // Clean up DOM event listeners
        if (this._clickHandler && this.element) {
            this.element.removeEventListener('click', this._clickHandler);
        }
        if (this._inputHandler && this.element) {
            this.element.removeEventListener('input', this._inputHandler);
        }

        // Clean up input-related event listeners
        if (this.element) {
            const inputs = this.element.querySelectorAll('.token-input');
            inputs.forEach(input => {
                input.removeEventListener('input', this._inputHandler);
                input.removeEventListener('focus', handleFocus);
                input.removeEventListener('blur', handleBlur);
            });
        }

        // Clear any pending operations
        if (this.debouncedInputUpdate) {
            this.debouncedInputUpdate.cancel();
        }

        // Unmount child components
        this.priceDisplay.unmount();
        this.balanceDisplay.unmount();
        this.transactionOptions.unmount();
    }

    template() {
        const isEthToExec = this.store.selectDirection();
        const amounts = this.store.selectAmounts();
        const balances = this.store.selectBalances();
        
        // Helper function to get input value
        const getInputValue = (isFromInput) => {
            const activeElement = document.activeElement;
            if (activeElement && activeElement.classList.contains('token-input')) {
                const isActiveFromInput = activeElement.dataset.input === 'from';
                if (isFromInput === isActiveFromInput) {
                    // Return the current value of the active input
                    return activeElement.value;
                }
            }
            // Otherwise return the store value
            return isEthToExec ? 
                (isFromInput ? amounts.eth : amounts.exec) :
                (isFromInput ? amounts.exec : amounts.eth);
        };

        return `
            <div class="swap-interface">
                <div class="swap-header">
                    <h2>Swap</h2>
                    ${this.store.selectConnectedAddress() ? `
                        <div class="connection-status">
                            Connected: 
                            <span class="connected-address">
                                ${this.store.selectConnectedAddress().slice(0,6)}...${this.store.selectConnectedAddress().slice(-4)}
                            </span>
                        </div>
                    ` : ''}
                </div>
                
                <div id="price-display-container"></div>
                <div id="balance-display-container"></div>
                
                <div class="swap-module">
                    <div class="quick-fill-buttons">
                        ${isEthToExec ? `
                            <button class="quick-fill" data-value="0.0025">0.0025 ETH</button>
                            <button class="quick-fill" data-value="0.01">0.01 ETH</button>
                            <button class="quick-fill" data-value="0.05">0.05 ETH</button>
                            <button class="quick-fill" data-value="0.1">0.1 ETH</button>
                        ` : `
                            <button class="quick-fill" data-value="25">25%</button>
                            <button class="quick-fill" data-value="50">50%</button>
                            <button class="quick-fill" data-value="75">75%</button>
                            <button class="quick-fill" data-value="100">100%</button>
                        `}
                    </div>

                    <div class="input-group">
                        <input type="text" 
                            class="token-input" 
                            value="${getInputValue(true)}"
                            data-input="from"
                            pattern="[0-9]*[.]?[0-9]*"
                            placeholder="0.0"
                        >
                        <span class="currency-label">
                            ${isEthToExec ? 'ETH' : 'EXEC'}
                        </span>
                        <div class="balance">
                            Balance: ${isEthToExec ? balances.eth : balances.exec}
                        </div>
                    </div>

                    <button class="swap-arrow-button" data-action="switch">
                        <span class="arrow">↓</span>
                    </button>

                    <div class="input-group">
                        <input type="text" 
                            class="token-input" 
                            value="${getInputValue(false)}"
                            data-input="to"
                            disabled
                            pattern="[0-9]*[.]?[0-9]*"
                            placeholder="0.0"
                        >
                        <span class="currency-label">
                            ${isEthToExec ? 'EXEC' : 'ETH'}
                        </span>
                        <div class="balance">
                            Balance: ${isEthToExec ? balances.exec : balances.eth}
                        </div>
                    </div>
                </div>

                <div id="transaction-options-container" 
                     class="transaction-options-wrapper"
                     style="border: 1px solid red; padding: 10px; margin: 10px 0;">
                </div>

                <button class="swap-button" 
                    ${this.store.selectStatus().loading || (!this.store.selectTransactionValidity?.() ?? true) ? 'disabled' : ''}
                    data-action="swap">
                    ${this.store.selectStatus().loading ? 'Loading...' : 'Swap'}
                </button>
                
                ${this.store.selectStatus().error ? `
                    <div class="error-message">${this.store.selectStatus().error}</div>
                ` : ''}
            </div>
        `;
    }

    async updateOutputAmount(inputAmount) {
        console.group('updateOutputAmount Flow');
        console.log('9. updateOutputAmount triggered:', {
            inputAmount,
            activeElement: document.activeElement
        });
        try {
            this.store.setLoading(true);
            this.store.setError(null);
            
            const isEthToExec = this.store.selectDirection();
            const currentPrice = this.store.selectPrice().current;
            
            console.log('Updating output amount:', {
                inputAmount,
                isEthToExec,
                currentPrice
            });

            if (isEthToExec) {
                // Converting ETH to EXEC
                // If user inputs 0.1 ETH and price is 0.0025 ETH/1M EXEC
                // Then they should receive (0.1 / 0.0025) * 1M = 40M EXEC
                const execAmount = Math.floor(parseFloat(inputAmount) / currentPrice * 1000000).toString();
                
                console.log('Calculated EXEC amount:', execAmount);
                
                // Verify with blockchain - only if we have a valid amount
                if (execAmount && !isNaN(execAmount)) {
                    const cost = await this.blockchainService.calculateCost(execAmount);
                    console.log('Blockchain verified cost:', cost);
                }
                
                this.store.updateAmounts(inputAmount, execAmount);
            } else {
                // Converting EXEC to ETH
                // If user inputs 40M EXEC and price is 0.0025 ETH/1M EXEC
                // Then they should receive (40 * 0.0025) = 0.1 ETH
                const ethAmount = (parseFloat(inputAmount) * currentPrice / 1000000).toFixed(18); // ETH has 18 decimals
                this.store.updateAmounts(ethAmount, inputAmount);
            }
            
            this.store.setLoading(false);
        } catch (error) {
            console.error('Error updating output amount:', error);
            this.store.setError('Failed to calculate swap amount');
            this.store.setLoading(false);
        }
        console.groupEnd();
    }

    fetchPrice() {
        // Implementation of fetchPrice method
    }

    render() {
        console.group('Render Flow');
        console.log('7. Render triggered:', {
            activeElement: document.activeElement,
            storeAmounts: this.store.selectAmounts()
        });
        const result = this.template();
        setTimeout(() => {
            console.log('8. Post-render focus restoration:', {
                activeElement: document.activeElement,
                restoreFocusFunction: !!this._restoreFocus
            });
            this._restoreFocus?.();
        }, 0);
        console.groupEnd();
        return result;
    }
} 