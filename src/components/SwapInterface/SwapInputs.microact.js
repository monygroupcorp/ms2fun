/**
 * SwapInputs - Microact Version
 *
 * Handles the two input fields (top and bottom) for ETH and EXEC amounts.
 * Displays token symbols and balances for each input.
 */

import { Component, h } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class SwapInputs extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
    }

    /**
     * Override shouldUpdate to prevent re-render during typing
     * This preserves input focus
     */
    shouldUpdate(oldProps, newProps) {
        // Direction change needs full re-render (swaps input positions)
        if (oldProps.direction !== newProps.direction) return true;
        if (oldProps.freeMint !== newProps.freeMint) return true;

        // For other changes, update DOM directly
        if (oldProps.ethAmount !== newProps.ethAmount ||
            oldProps.execAmount !== newProps.execAmount ||
            oldProps.calculatingAmount !== newProps.calculatingAmount) {
            this.updateInputValues(newProps);
            return false;
        }

        return false;
    }

    updateInputValues(props) {
        if (!this.element) return;

        const { direction, ethAmount, execAmount, calculatingAmount } = props || this.props;
        const topInput = this.element.querySelector('.top-input');
        const bottomInput = this.element.querySelector('.bottom-input');

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

    handleTopInput(e) {
        const { onInput } = this.props;
        if (onInput) {
            onInput('top', e.target.value);
        }
    }

    handleBottomInput(e) {
        const { onInput } = this.props;
        if (onInput) {
            onInput('bottom', e.target.value);
        }
    }

    render() {
        const { direction, ethAmount, execAmount, calculatingAmount, freeMint } = this.props;

        const balances = this.store.selectBalances();
        const formattedEthBalance = parseFloat(balances.eth || 0).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec || 0).toLocaleString();

        // Calculate available balance for selling
        const availableExecBalance = direction === 'sell' && freeMint
            ? `Available: ${(parseInt(balances.exec || 0) - 1000000).toLocaleString()}`
            : `Balance: ${formattedExecBalance}`;

        const topValue = direction === 'buy' ? ethAmount : execAmount;
        const bottomValue = direction === 'buy'
            ? (calculatingAmount ? 'Loading...' : execAmount)
            : (calculatingAmount ? 'Loading...' : ethAmount);

        const topSymbol = direction === 'buy' ? 'ETH' : '$EXEC';
        const bottomSymbol = direction === 'buy' ? '$EXEC' : 'ETH';

        const topBalance = direction === 'buy'
            ? `Balance: ${formattedEthBalance}`
            : availableExecBalance;
        const bottomBalance = direction === 'buy'
            ? `Balance: ${formattedExecBalance}`
            : `Balance: ${formattedEthBalance}`;

        return h('div', { className: 'swap-inputs' },
            h('div', { className: 'input-container' },
                h('input', {
                    type: 'text',
                    className: 'top-input',
                    value: topValue,
                    placeholder: '0.0',
                    pattern: '^[0-9]*[.]?[0-9]*$',
                    onInput: this.bind(this.handleTopInput)
                }),
                h('div', { className: 'token-info' },
                    h('span', { className: 'token-symbol' }, topSymbol),
                    h('span', { className: 'token-balance' }, topBalance)
                )
            ),
            h('div', { className: 'direction-switch-slot' }),
            h('div', { className: 'input-container' },
                h('input', {
                    type: 'text',
                    className: 'bottom-input',
                    value: bottomValue,
                    placeholder: '0.0',
                    pattern: '^[0-9]*[.]?[0-9]*$',
                    onInput: this.bind(this.handleBottomInput)
                }),
                h('div', { className: 'token-info' },
                    h('span', { className: 'token-symbol' }, bottomSymbol),
                    h('span', { className: 'token-balance' }, bottomBalance)
                )
            )
        );
    }
}

export default SwapInputs;
