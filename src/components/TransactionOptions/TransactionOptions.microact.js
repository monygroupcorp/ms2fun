/**
 * TransactionOptions - Microact Version
 *
 * Transaction options including NFT minting toggle and message input.
 * Integrates with tradingStore for swap direction and balance info.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class TransactionOptions extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
        this.state = {
            nftMintingEnabled: false,
            message: '',
            isValid: true,
            nftBalance: 0,
            swapDirection: this.store.selectDirection() ? 'buy' : 'sell',
            lastValidationState: true,
            isPhase2: null // null means phase is not yet determined
        };
    }

    didMount() {
        const unsub1 = this.store.subscribe(() => this.handleStoreUpdate());
        const unsub2 = eventBus.on('contractData:updated', () => this.checkPhase2Status());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
        });

        this.checkPhase2Status();
    }

    /**
     * Override shouldUpdate to prevent re-render during message typing
     */
    shouldUpdate(oldState, newState) {
        // Full re-render needed for structural changes
        if (oldState.isPhase2 !== newState.isPhase2) return true;
        if (oldState.swapDirection !== newState.swapDirection) return true;

        // For message changes, update DOM directly to preserve focus
        if (oldState.message !== newState.message) {
            this.updateCharacterCount(newState.message);
            return false;
        }

        // For validation changes, update DOM directly
        if (oldState.isValid !== newState.isValid) {
            this.updateValidationDisplay(newState);
            return false;
        }

        return true;
    }

    updateCharacterCount(message) {
        if (!this.element) return;
        const countEl = this.element.querySelector('.character-count');
        if (countEl) {
            countEl.textContent = `${message.length}/140`;
            countEl.className = `character-count ${message.length > 140 ? 'error' : ''}`;
        }
    }

    updateValidationDisplay(state) {
        if (!this.element) return;
        const validationEl = this.element.querySelector('.validation-status');
        if (validationEl) {
            validationEl.className = `validation-status ${state.isValid ? 'valid' : 'invalid'}`;
            validationEl.innerHTML = this.getValidationErrors(state)
                .map(error => `<p class="error">${error}</p>`)
                .join('');
        }
    }

    validateTransaction() {
        const { message, nftMintingEnabled, nftBalance, lastValidationState } = this.state;
        const isMessageValid = message.length <= 140;
        const isNFTValid = !nftMintingEnabled || nftBalance < 10;
        const newIsValid = isMessageValid && isNFTValid;

        if (lastValidationState !== newIsValid) {
            this.setState({
                lastValidationState: newIsValid,
                isValid: newIsValid
            });

            eventBus.emit('transactionValidation', {
                isValid: newIsValid,
                errors: this.getValidationErrors(this.state)
            });
        }
    }

    getValidationErrors(state) {
        const errors = [];
        const { message, nftMintingEnabled, nftBalance } = state || this.state;

        if (message.length > 140) {
            errors.push('Message must be 140 characters or less');
        }

        if (nftMintingEnabled && nftBalance >= 10) {
            errors.push('Cannot mint more than 10 NFTs');
        }

        return errors;
    }

    handleMessageInput(e) {
        const newMessage = e.target.value || '';

        // Direct state mutation to preserve focus
        this.state.message = newMessage;
        this.updateCharacterCount(newMessage);

        this.emitStateUpdate();
        this.validateTransaction();
    }

    handleNFTToggle(e) {
        const isEnabled = e.target.checked;

        this.setState({ nftMintingEnabled: isEnabled });
        this.emitStateUpdate();
        this.validateTransaction();
    }

    emitStateUpdate() {
        eventBus.emit('transactionOptions:update', {
            message: this.state.message,
            nftMintingEnabled: this.state.nftMintingEnabled
        });
    }

    handleStoreUpdate() {
        const direction = this.store.selectDirection();
        const balance = this.store.selectBalances().nft || 0;
        const newDirection = direction ? 'buy' : 'sell';

        if (this.state.swapDirection !== newDirection || this.state.nftBalance !== balance) {
            this.setState({
                swapDirection: newDirection,
                nftBalance: balance
            });

            this.validateTransaction();
        }
    }

    checkPhase2Status() {
        const contractData = this.store.selectContractData();
        if (contractData && contractData.liquidityPool !== undefined) {
            const isPhase2 = contractData.liquidityPool &&
                contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';

            if (this.state.isPhase2 !== isPhase2) {
                this.setState({ isPhase2 });
            }
        }
    }

    render() {
        const { nftMintingEnabled, message, isValid, isPhase2, swapDirection } = this.state;

        // Wait for phase to be determined
        if (isPhase2 === null) {
            return h('div', { className: 'transaction-options-loading' });
        }

        // Phase 2: no transaction options needed
        if (isPhase2) {
            return h('div', { className: 'transaction-options-phase2' });
        }

        return h('div', { className: 'transaction-options' },
            h('div', {
                className: `option-group ${swapDirection === 'sell' ? 'hidden' : ''}`
            },
                h('label', { className: 'nft-toggle' },
                    h('input', {
                        type: 'checkbox',
                        id: 'nftToggle',
                        checked: nftMintingEnabled,
                        onChange: this.bind(this.handleNFTToggle)
                    }),
                    'Mint NFT with transaction'
                )
            ),

            h('div', { className: 'option-group' },
                h('label', { htmlFor: 'messageInput' }, 'Transaction Message'),
                h('textarea', {
                    id: 'messageInput',
                    maxlength: '140',
                    placeholder: 'Enter optional message...',
                    value: message,
                    onInput: this.bind(this.handleMessageInput)
                }),
                h('span', {
                    className: `character-count ${message.length > 140 ? 'error' : ''}`
                }, `${message.length}/140`)
            ),

            h('div', {
                className: `validation-status ${isValid ? 'valid' : 'invalid'}`
            },
                ...this.getValidationErrors(this.state).map(error =>
                    h('p', { className: 'error' }, error)
                )
            )
        );
    }
}

export default TransactionOptions;
