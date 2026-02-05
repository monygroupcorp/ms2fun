/**
 * MintModal - Microact Version
 *
 * Modal for minting NFTs with amount controls.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';

export class MintModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            mintAmount: 1,
            isVisible: false,
            buttonText: 'Mint NFTs',
            buttonDisabled: false,
            error: null
        };
    }

    get maxMintable() {
        return this.props.maxMintable || 10;
    }

    get blockchainService() {
        return this.props.blockchainService;
    }

    didMount() {
        const unsub1 = eventBus.on('transaction:pending', (e) => this.handleTransactionEvents(e));
        const unsub2 = eventBus.on('transaction:confirmed', (e) => this.handleTransactionEvents(e));
        const unsub3 = eventBus.on('transaction:success', (e) => this.handleTransactionEvents(e));
        const unsub4 = eventBus.on('transaction:error', (e) => this.handleTransactionEvents(e));

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
        });
    }

    show() {
        this.setState({ isVisible: true });
    }

    hide() {
        this.setState({ isVisible: false });
    }

    handleIncrement() {
        if (this.state.mintAmount < this.maxMintable) {
            this.setState({ mintAmount: this.state.mintAmount + 1 });
        }
    }

    handleDecrement() {
        if (this.state.mintAmount > 1) {
            this.setState({ mintAmount: this.state.mintAmount - 1 });
        }
    }

    handleInputChange(e) {
        let value = parseInt(e.target.value) || 0;
        value = Math.max(1, Math.min(value, this.maxMintable));
        this.setState({ mintAmount: value });
    }

    handleTransactionEvents(event) {
        if (!event || !event.type) return;

        const { mintAmount } = this.state;

        if (event.type === 'mint') {
            this.setState({ buttonText: 'Waiting for confirmation...', buttonDisabled: true });
            eventBus.emit('notification:info', {
                title: 'Transaction Pending',
                message: `Minting ${mintAmount} NFT${mintAmount > 1 ? 's' : ''}. Please confirm in your wallet...`
            });
        }

        if (event.hash) {
            this.setState({ buttonText: 'Transaction Processing...' });
            eventBus.emit('notification:info', {
                title: 'Transaction Confirmed',
                message: 'Transaction confirmed, minting in progress...'
            });
        }

        if (event.receipt) {
            eventBus.emit('notification:success', {
                title: 'Transaction Complete',
                message: `Successfully minted ${mintAmount} NFT${mintAmount > 1 ? 's' : ''}!`
            });

            this.hide();
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');

            this.setState({ buttonText: 'Mint NFTs', buttonDisabled: false });
        }

        if (event.error) {
            const errorMessage = event.error?.message || 'Transaction failed';
            eventBus.emit('notification:error', {
                title: 'Transaction Failed',
                message: errorMessage
            });

            this.setState({ buttonText: 'Mint NFTs', buttonDisabled: false, error: errorMessage });
        }
    }

    async handleMint() {
        try {
            this.setState({ buttonDisabled: true, buttonText: 'Preparing Transaction...' });
            await this.blockchainService.balanceMint(this.state.mintAmount);
        } catch (error) {
            console.error('Minting failed:', error);
            this.handleTransactionEvents({ error });
        }
    }

    handleClose() {
        this.hide();
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('mint-modal-overlay')) {
            this.handleClose();
        }
    }

    render() {
        const { mintAmount, isVisible, buttonText, buttonDisabled, error } = this.state;

        if (!isVisible) {
            return h('div', { className: 'mint-modal-hidden' });
        }

        return h('div', {
            className: 'mint-modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'mint-modal' },
                h('button', {
                    className: 'mint-modal-close',
                    onClick: this.bind(this.handleClose)
                }, '×'),
                h('div', { className: 'mint-modal-content' },
                    h('h2', null, 'Mint NFTs'),
                    h('p', null, `You can mint up to ${this.maxMintable} NFTs`),
                    h('div', { className: 'mint-amount-controls' },
                        h('button', {
                            className: 'decrement-button',
                            onClick: this.bind(this.handleDecrement)
                        }, '-'),
                        h('input', {
                            type: 'number',
                            className: 'mint-amount-input',
                            value: mintAmount,
                            min: '1',
                            max: this.maxMintable.toString(),
                            onInput: this.bind(this.handleInputChange)
                        }),
                        h('button', {
                            className: 'increment-button',
                            onClick: this.bind(this.handleIncrement)
                        }, '+')
                    ),
                    error && h('div', { className: 'mint-error' }, error),
                    h('button', {
                        className: 'confirm-mint-button',
                        disabled: buttonDisabled,
                        onClick: this.bind(this.handleMint)
                    }, buttonText)
                )
            )
        );
    }
}

export default MintModal;
