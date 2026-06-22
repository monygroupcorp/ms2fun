/**
 * ApprovalModal - Microact Version
 *
 * Modal for approving token spending by router contract.
 * Used before selling tokens.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class ApprovalModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            status: 'idle', // idle, pending, success, error
            statusMessage: '',
            isOpen: true
        };
        this.modalId = Math.random().toString(36).substring(2, 9);
    }

    get amount() {
        return this.props.amount || '0';
    }

    get blockchainService() {
        return this.props.blockchainService;
    }

    get userAddress() {
        return this.props.userAddress;
    }

    didMount() {
        // ESC key handler
        const escHandler = (e) => {
            if (e.key === 'Escape' && this.state.isOpen) {
                this.handleClose();
            }
        };
        document.addEventListener('keydown', escHandler);
        this.registerCleanup(() => document.removeEventListener('keydown', escHandler));
    }

    async handleApprove() {
        console.log(`[ApprovalModal-${this.modalId}] Approve clicked`);

        try {
            this.setState({ status: 'pending', statusMessage: 'Waiting for wallet confirmation...' });

            let address = this.userAddress;
            if (!address && this.blockchainService?.signer) {
                try {
                    address = await this.blockchainService.signer.getAddress();
                } catch (err) {
                    throw new Error('Could not get wallet address. Please reconnect your wallet.');
                }
            }

            if (!address) {
                throw new Error('No wallet connected. Please connect your wallet first.');
            }

            const parsedAmount = this.blockchainService.parseExec(this.amount);
            const routerAddress = this.blockchainService.swapRouter?.address || this.blockchainService.swapRouter;

            this.setState({ statusMessage: 'Transaction submitted, waiting for confirmation...' });

            await this.blockchainService.setApproval(routerAddress, parsedAmount);

            this.setState({ status: 'success', statusMessage: 'Approval successful!' });

            await new Promise(resolve => this.setTimeout(resolve, 1500));

            eventBus.emit('approve:complete');
            this.handleClose();

        } catch (error) {
            console.error(`[ApprovalModal-${this.modalId}] Approval failed:`, error);

            let errorMessage = error.message;
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }

            this.setState({ status: 'error', statusMessage: `Error: ${errorMessage}` });
        }
    }

    handleClose() {
        console.log(`[ApprovalModal-${this.modalId}] Closing`);
        this.setState({ isOpen: false });
        eventBus.emit('approveModal:closed');

        const { onClose } = this.props;
        if (onClose) onClose();
    }

    handleOverlayClick(e) {
        if (e.target === e.currentTarget) {
            this.handleClose();
        }
    }

    render() {
        const { status, statusMessage, isOpen } = this.state;

        if (!isOpen) {
            return h('div', { className: 'approval-modal-container' });
        }

        const routerAddress = this.blockchainService?.swapRouter?.address ||
                             this.blockchainService?.swapRouter ||
                             'Loading...';
        const formattedAmount = parseInt(this.amount).toLocaleString();
        const isPending = status === 'pending';

        return h('div', {
            className: 'approve-modal-overlay',
            onClick: this.bind(this.handleOverlayClick)
        },
            h('div', { className: 'approve-modal' },
                h('button', {
                    className: 'approve-modal-close',
                    onClick: this.bind(this.handleClose)
                }, '×'),

                h('div', { className: 'approve-modal-content' },
                    h('h2', null, 'Approve Router'),
                    h('p', null, 'Before selling your $EXEC tokens, you need to approve the router contract to spend them.'),

                    h('div', { className: 'approve-details' },
                        h('div', { className: 'approve-info' },
                            h('span', { className: 'label' }, 'Amount to Approve:'),
                            h('span', { className: 'value' }, `${formattedAmount} $EXEC`)
                        ),
                        h('div', { className: 'approve-info' },
                            h('span', { className: 'label' }, 'Router Address:'),
                            h('span', { className: 'value' }, routerAddress)
                        )
                    ),

                    status !== 'idle' && h('div', {
                        className: `status-message ${status}`
                    }, statusMessage),

                    h('button', {
                        className: 'approve-button',
                        disabled: isPending,
                        onClick: this.bind(this.handleApprove)
                    }, isPending ? 'Approving...' : 'Approve')
                )
            )
        );
    }
}

export default ApprovalModal;
