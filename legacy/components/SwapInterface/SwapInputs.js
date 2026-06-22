import { Component } from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';

/**
 * SwapInputs Component
 * 
 * Handles the two input fields (top and bottom) for ETH and EXEC amounts.
 * Displays token symbols and balances for each input.
 * 
 * @class SwapInputs
 * @extends Component
 */
export class SwapInputs extends Component {
    /**
     * @param {Object} props - Component props
     * @param {string} props.direction - Swap direction ('buy' or 'sell')
     * @param {string} props.ethAmount - Current ETH amount value
     * @param {string} props.execAmount - Current EXEC amount value
     * @param {boolean} props.calculatingAmount - Whether amount is being calculated
     * @param {Function} props.onInput - Callback when input value changes (inputType, value)
     * @param {boolean} props.freeMint - Whether user has free mint
     * @param {boolean} props.isPhase2 - Whether in Phase 2 (liquidity deployed)
     */
    constructor(props = {}) {
        super();
        this.props = props;
        this.store = tradingStore;
    }

    /**
     * Update component props
     * @param {Object} newProps - New props to merge
     */
    updateProps(newProps) {
        this.props = { ...this.props, ...newProps };
        // Don't call update() directly as it will destroy input elements and lose focus
        // Instead, update only the parts that changed
        this.updateSelectively(newProps);
    }
    
    /**
     * Update only specific parts of the UI without destroying inputs
     * @param {Object} changedProps - Props that changed
     */
    updateSelectively(changedProps) {
        if (!this.element) return;
        
        // Update balance displays if they changed
        if (changedProps.direction !== undefined || changedProps.freeMint !== undefined) {
            const balances = this.store.selectBalances();
            const formattedEthBalance = parseFloat(balances.eth || 0).toFixed(6);
            const formattedExecBalance = parseInt(balances.exec || 0).toLocaleString();
            const availableExecBalance = this.props.direction === 'sell' && this.props.freeMint
                ? `Available: ${(parseInt(balances.exec || 0) - 1000000).toLocaleString()}`
                : `Balance: ${formattedExecBalance}`;
            
            // Update balance displays without touching inputs
            const balanceDisplays = this.element.querySelectorAll('.token-balance');
            balanceDisplays.forEach((display, index) => {
                const isTopInput = index === 0;
                if (this.props.direction === 'buy') {
                    display.textContent = isTopInput ? `Balance: ${formattedEthBalance}` : `Balance: ${formattedExecBalance}`;
                } else {
                    display.textContent = isTopInput ? availableExecBalance : `Balance: ${formattedEthBalance}`;
                }
            });
            
            // Update token symbols
            const tokenSymbols = this.element.querySelectorAll('.token-symbol');
            tokenSymbols.forEach((symbol, index) => {
                const isTopInput = index === 0;
                if (this.props.direction === 'buy') {
                    symbol.textContent = isTopInput ? 'ETH' : '$EXEC';
                } else {
                    symbol.textContent = isTopInput ? '$EXEC' : 'ETH';
                }
            });
        }
        
        // Update input values only if they're not focused
        // This prevents destroying user input while typing
        const topInput = this.element.querySelector('.top-input');
        const bottomInput = this.element.querySelector('.bottom-input');
        
        if (changedProps.calculatingAmount !== undefined || changedProps.execAmount !== undefined || changedProps.ethAmount !== undefined) {
            const { direction, ethAmount, execAmount, calculatingAmount } = this.props;
            
            // Update top input only if not focused
            if (topInput && !topInput.matches(':focus')) {
                topInput.value = direction === 'buy' ? ethAmount : execAmount;
            }
            
            // Update bottom input only if not focused
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = direction === 'buy' 
                    ? (calculatingAmount ? 'Loading...' : execAmount)
                    : (calculatingAmount ? 'Loading...' : ethAmount);
            }
        }
    }

    /**
     * Handle input change events
     * @param {Event} e - Input event
     * @param {string} inputType - 'top' or 'bottom'
     */
    handleInput(e, inputType) {
        const value = e.target.value;
        if (this.props.onInput) {
            this.props.onInput(inputType, value);
        }
    }

    events() {
        return {
            'input .top-input': (e) => this.handleInput(e, 'top'),
            'input .bottom-input': (e) => this.handleInput(e, 'bottom')
        };
    }

    render() {
        const { direction, ethAmount, execAmount, calculatingAmount, freeMint, isPhase2 } = this.props;
        
        const balances = this.store.selectBalances();
        const formattedEthBalance = parseFloat(balances.eth || 0).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec || 0).toLocaleString();
        
        // Calculate available balance for selling
        const availableExecBalance = direction === 'sell' && freeMint
            ? `Available: ${(parseInt(balances.exec || 0) - 1000000).toLocaleString()}`
            : `Balance: ${formattedExecBalance}`;

        return `
            <div class="swap-inputs">
                <div class="input-container">
                    <input type="text" 
                           class="top-input" 
                           value="${direction === 'buy' ? ethAmount : execAmount}" 
                           placeholder="0.0"
                           pattern="^[0-9]*[.]?[0-9]*$">
                    <div class="token-info">
                        <span class="token-symbol">${direction === 'buy' ? 'ETH' : '$EXEC'}</span>
                        <span class="token-balance">Balance: ${direction === 'buy' ? formattedEthBalance : availableExecBalance}</span>
                    </div>
                </div>
                <div class="direction-switch-slot"></div>
                <div class="input-container">
                    <input type="text" 
                           class="bottom-input" 
                           value="${direction === 'buy' ? (calculatingAmount ? 'Loading...' : execAmount) : (calculatingAmount ? 'Loading...' : ethAmount)}" 
                           placeholder="0.0"
                           pattern="^[0-9]*[.]?[0-9]*$">
                    <div class="token-info">
                        <span class="token-symbol">${direction === 'buy' ? '$EXEC' : 'ETH'}</span>
                        <span class="token-balance">Balance: ${direction === 'buy' ? formattedExecBalance : formattedEthBalance}</span>
                    </div>
                </div>
            </div>
        `;
    }
}

export default SwapInputs;

