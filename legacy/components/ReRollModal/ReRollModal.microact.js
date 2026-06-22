/**
 * ReRollModal - Microact Version
 *
 * Multi-step modal for re-rolling ERC404 NFTs:
 * - Check skipNFT status
 * - Set skipNFT to false if needed (first transaction)
 * - Transfer tokens to self (second transaction, triggers re-roll)
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { tradingStore } from '../../store/tradingStore.js';

export class ReRollModal extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            isVisible: false,
            hasConfirmed: false,
            skipNFTStatus: null,
            isCheckingSkipNFT: false,
            execBalance: '0',
            execBalanceFormatted: '0',
            currentNFTs: 0,
            nftsToMint: 0,
            nftsToBurn: 0,
            currentStep: 0,
            step1Status: 'waiting',
            step2Status: 'waiting',
            txPending: false,
            error: null
        };
    }

    get blockchainService() {
        return this.props.blockchainService;
    }

    async didMount() {
        const unsub1 = eventBus.on('transaction:pending', (e) => this.handleTransactionEvent(e));
        const unsub2 = eventBus.on('transaction:confirmed', (e) => this.handleTransactionEvent(e));
        const unsub3 = eventBus.on('transaction:success', (e) => this.handleTransactionEvent(e));
        const unsub4 = eventBus.on('transaction:error', (e) => this.handleTransactionEvent(e));
        const unsub5 = eventBus.on('reroll:open', () => this.show());
        const unsub6 = eventBus.on('reroll:close', () => this.hide());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
            unsub4();
            unsub5();
            unsub6();
        });
    }

    show() {
        this.setState({
            isVisible: true,
            hasConfirmed: false,
            skipNFTStatus: null,
            currentStep: 0,
            step1Status: 'waiting',
            step2Status: 'waiting',
            error: null
        });
        this.updateCalculations();
        this.checkSkipNFT();
    }

    hide() {
        this.setState({ isVisible: false, hasConfirmed: false });
    }

    updateCalculations() {
        const balances = tradingStore.selectBalances();
        const execBalance = BigInt(balances.exec || '0');
        const currentNFTs = parseInt(balances.nfts || '0');

        // 1,000,000 EXEC = 1 NFT (1M EXEC in wei = 1000000000000000000000000)
        const execForOneNFT = BigInt('1000000000000000000000000');
        const nftsToMint = execBalance > 0n ? Number(execBalance / execForOneNFT) : 0;

        this.setState({
            execBalance: execBalance.toString(),
            execBalanceFormatted: (Number(execBalance) / 1e18).toLocaleString(),
            currentNFTs,
            nftsToMint,
            nftsToBurn: currentNFTs
        });
    }

    async checkSkipNFT() {
        try {
            this.setState({ isCheckingSkipNFT: true });
            const address = tradingStore.selectConnectedAddress();
            if (!address) {
                throw new Error('No wallet connected');
            }

            const skipNFT = await this.blockchainService.getSkipNFT(address);
            this.setState({ skipNFTStatus: skipNFT, isCheckingSkipNFT: false });
        } catch (error) {
            console.error('[ReRollModal] Error checking skipNFT status:', error);
            this.setState({
                isCheckingSkipNFT: false,
                error: 'Failed to check skipNFT status'
            });
        }
    }

    handleConfirm() {
        this.setState({ hasConfirmed: true });
    }

    handleClose() {
        this.hide();
    }

    async handleReroll() {
        if (!this.state.hasConfirmed) {
            this.setState({ error: 'Please confirm that you understand the consequences first' });
            return;
        }

        try {
            const address = tradingStore.selectConnectedAddress();
            if (!address) {
                throw new Error('No wallet connected');
            }

            const balances = tradingStore.selectBalances();
            const execBalance = BigInt(balances.exec || '0');

            if (execBalance === 0n) {
                throw new Error('You have no EXEC tokens to re-roll');
            }

            this.setState({ txPending: true, error: null });

            // Step 1: Set setSkipNFT to false if needed
            if (this.state.skipNFTStatus === true) {
                this.setState({ currentStep: 1, step1Status: 'pending' });

                await this.blockchainService.setSkipNFT(false);

                this.setState({ step1Status: 'completed', skipNFTStatus: false });
            }

            // Step 2: Transfer tokens to self
            this.setState({ currentStep: 2, step2Status: 'pending' });

            await this.blockchainService.transferTokensToSelf(execBalance.toString());

            // Success handled by event system
        } catch (error) {
            console.error('[ReRollModal] Re-roll failed:', error);
            this.handleTransactionEvent({ type: 'reroll', error });
        }
    }

    handleTransactionEvent(event) {
        if (!event) return;
        if (event.type !== 'reroll' && event.type !== 'setSkipNFT') return;

        // Handle setSkipNFT transaction
        if (event.type === 'setSkipNFT') {
            if (event.error) {
                this.setState({
                    step1Status: 'error',
                    txPending: false,
                    error: event.error?.message || 'Failed to set skipNFT'
                });
            }
            return;
        }

        // Handle reroll transaction
        if (event.receipt) {
            this.setState({
                step2Status: 'completed',
                txPending: false
            });
            this.hide();
            eventBus.emit('portfolio:close');
            eventBus.emit('portfolio:open');
        } else if (event.error) {
            this.setState({
                step2Status: 'error',
                txPending: false,
                error: event.error?.message || 'Transaction failed'
            });
        }
    }

    renderWarningSection() {
        const { execBalanceFormatted, currentNFTs, nftsToMint, nftsToBurn, skipNFTStatus, isCheckingSkipNFT } = this.state;

        return h('div', { className: 'warning-section' },
            h('div', { className: 'warning-box' },
                h('h3', null, '⚠️ WARNING: RISK-ON PROCEDURE'),

                h('div', { className: 'dynamic-warning-text' },
                    nftsToMint > 0
                        ? [
                            h('strong', { key: 'warn' }, `⚠️ YOU HAVE ${execBalanceFormatted} EXEC AND ${currentNFTs} NFTs!`),
                            h('br', { key: 'br1' }),
                            h('br', { key: 'br2' }),
                            'This means you will be paying Ethereum gas for:',
                            h('br', { key: 'br3' }),
                            `• Burning ${nftsToBurn} NFT${nftsToBurn !== 1 ? 's' : ''}`,
                            h('br', { key: 'br4' }),
                            `• Minting ${nftsToMint} NFT${nftsToMint !== 1 ? 's' : ''}`,
                            h('br', { key: 'br5' }),
                            h('br', { key: 'br6' }),
                            h('strong', { key: 'total' }, `That's ${nftsToBurn + nftsToMint} total NFT operations in gas fees!!!`)
                        ]
                        : h('p', null, 'Loading your balance information...')
                ),

                h('p', { className: 'warning-text' },
                    'In order to reroll your NFTs, you will have to set a value on the contract that makes it so that all of your EXEC will automatically mint NFTs. The cult exec badge NFTs that reside in your wallet will all be burnt, and you will mint all new ones. ',
                    h('strong', null, 'We recommend that if you have NFT ids that you cherish, you should move them to another wallet for safe keeping.'),
                    ' Keep in mind: 1,000,000 EXEC = 1 Cult Executive Badge NFT.'
                )
            ),

            h('div', { className: 'skipnft-check' },
                h('p', null, 'Checking skipNFT status...'),
                h('div', {
                    className: `skipnft-status ${isCheckingSkipNFT ? 'checking' : skipNFTStatus === false ? 'available' : 'will-set'}`
                },
                    isCheckingSkipNFT
                        ? 'Loading...'
                        : skipNFTStatus === false
                            ? '✓ setSkipNFT is set to false - Re-roll is available'
                            : '✗ setSkipNFT is set to true - Will be set to false automatically'
                )
            ),

            h('button', {
                className: 'confirm-understand-button',
                onClick: this.bind(this.handleConfirm)
            }, 'I Understand the Consequences')
        );
    }

    renderConfirmationSection() {
        const { skipNFTStatus, step1Status, step2Status, txPending, currentStep } = this.state;
        const showStep1 = skipNFTStatus === true || skipNFTStatus === null;

        return h('div', { className: 'confirmation-section' },
            h('div', { className: 'skipnft-status-message' },
                h('div', {
                    className: `skipnft-status ${skipNFTStatus === false ? 'available' : 'will-set'}`
                },
                    skipNFTStatus === false
                        ? '✓ setSkipNFT is set to false - Re-roll is available'
                        : '✗ setSkipNFT is set to true - Will be set to false automatically'
                )
            ),

            h('p', { className: 'confirmation-text' },
                'You have confirmed that you understand the consequences. Click below to proceed with the re-roll.'
            ),

            currentStep > 0 && h('div', { className: 'transaction-steps' },
                showStep1 && h('div', { className: `step step-1 ${step1Status}` },
                    h('div', { className: 'step-number' }, 'Step 1'),
                    h('div', { className: 'step-description' }, 'Set setSkipNFT to false'),
                    h('div', { className: 'step-status' },
                        step1Status === 'pending' ? '⏳ Pending...'
                            : step1Status === 'completed' ? '✓ Completed'
                                : step1Status === 'error' ? '✗ Failed'
                                    : 'Waiting...'
                    )
                ),
                h('div', { className: `step step-2 ${step2Status}` },
                    h('div', { className: 'step-number' }, 'Step 2'),
                    h('div', { className: 'step-description' }, 'Transfer EXEC tokens to self'),
                    h('div', { className: 'step-status' },
                        step2Status === 'pending' ? '⏳ Pending...'
                            : step2Status === 'completed' ? '✓ Completed'
                                : step2Status === 'error' ? '✗ Failed'
                                    : 'Waiting...'
                    )
                )
            ),

            h('button', {
                className: 'confirm-reroll-button',
                onClick: this.bind(this.handleReroll),
                disabled: txPending
            },
                txPending
                    ? (currentStep === 1 ? 'Step 1: Setting setSkipNFT to false...' : 'Step 2: Transferring tokens to self...')
                    : skipNFTStatus === true
                        ? 'Start Re-roll (2 transactions)'
                        : 'Confirm Re-roll'
            )
        );
    }

    render() {
        const { isVisible, hasConfirmed, error } = this.state;

        if (!isVisible) {
            return h('div', { className: 'reroll-modal-container', style: { display: 'none' } });
        }

        return h('div', { className: 'reroll-modal-overlay', onClick: (e) => {
            if (e.target.classList.contains('reroll-modal-overlay')) {
                this.handleClose();
            }
        }},
            h('div', { className: 'reroll-modal' },
                h('button', {
                    className: 'reroll-modal-close',
                    onClick: this.bind(this.handleClose)
                }, '×'),

                h('div', { className: 'reroll-modal-content' },
                    h('h2', null, 'Re-roll Exec NFTs'),

                    error && h('div', { className: 'error-banner' }, error),

                    !hasConfirmed
                        ? this.renderWarningSection()
                        : this.renderConfirmationSection()
                )
            )
        );
    }
}

export default ReRollModal;
