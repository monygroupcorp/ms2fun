/**
 * SendModal - Microact Version
 *
 * Modal for sending NFTs to another address.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class SendModal extends Component {
    constructor(props = {}) {
        super(props);
        this.store = tradingStore;
        this.state = {
            isVisible: false,
            recipientAddress: '',
            buttonText: 'Send NFT',
            buttonDisabled: true,
            error: null
        };
    }

    get tokenId() {
        return this.props.tokenId;
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

    isValidAddress(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    handleAddressInput(e) {
        const address = e.target.value;
        this.setState({
            recipientAddress: address,
            buttonDisabled: !this.isValidAddress(address)
        });
    }

    handleTransactionEvents(event) {
        if (!event || !event.type) return;

        if (event.type === 'send') {
            this.setState({ buttonText: 'Waiting for confirmation...', buttonDisabled: true });
            eventBus.emit('notification:info', {
                title: 'Transaction Pending',
                message: `Sending NFT #${this.tokenId}. Please confirm in your wallet...`
            });
        }

        if (event.hash) {
            this.setState({ buttonText: 'Transaction Processing...' });
            eventBus.emit('notification:info', {
                title: 'Transaction Confirmed',
                message: 'Transaction confirmed, transfer in progress...'
            });
        }

        if (event.receipt) {
            eventBus.emit('notification:success', {
                title: 'Transaction Complete',
                message: `Successfully sent NFT #${this.tokenId}!`
            });

            this.hide();
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');

            this.setState({ buttonText: 'Send NFT', buttonDisabled: false });
        }

        if (event.error) {
            const errorMessage = event.error?.message || 'Transaction failed';
            eventBus.emit('notification:error', {
                title: 'Transaction Failed',
                message: errorMessage
            });

            this.setState({ buttonText: 'Send NFT', buttonDisabled: false, error: errorMessage });
        }
    }

    async handleSend() {
        try {
            const address = this.store.selectConnectedAddress();
            this.setState({ buttonDisabled: true, buttonText: 'Preparing Transaction...' });

            await this.blockchainService.transferNFT(
                address,
                this.state.recipientAddress,
                this.tokenId
            );
        } catch (error) {
            console.error('Transfer failed:', error);
            this.handleTransactionEvents({ error });
        }
    }

    handleClose() {
        this.hide();
    }

    handleOverlayClick(e) {
        if (e.target.classList.contains('send-modal-overlay')) {
            this.handleClose();
        }
    }

    render() {
        const { isVisible, recipientAddress, buttonText, buttonDisabled, error } = this.state;

        if (!isVisible) {
            return h('div', { className: 'send-modal-hidden' });
        }

        return h('div', {
            className: 'send-modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'send-modal' },
                h('button', {
                    className: 'send-modal-close',
                    onClick: this.bind(this.handleClose)
                }, '×'),
                h('div', { className: 'send-modal-content' },
                    h('h2', null, `Send NFT #${this.tokenId}`),
                    h('p', null, "Enter the recipient's Ethereum address:"),
                    h('input', {
                        type: 'text',
                        className: 'address-input',
                        placeholder: '0x...',
                        spellcheck: 'false',
                        value: recipientAddress,
                        onInput: this.bind(this.handleAddressInput)
                    }),
                    error && h('div', { className: 'send-error' }, error),
                    h('button', {
                        className: 'confirm-send-button',
                        disabled: buttonDisabled,
                        onClick: this.bind(this.handleSend)
                    }, buttonText)
                )
            )
        );
    }
}

export default SendModal;
