/**
 * WalletSplash - Microact Version
 *
 * Blocks access to content until wallet is connected.
 * Provides wallet selection modal and light node fallback.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import { WalletService } from '@monygroupcorp/micro-web3';

export class WalletSplash extends Component {
    constructor(props = {}) {
        super(props);
        this.walletService = props.walletService || null;
        this.state = {
            walletConnected: false,
            checking: true,
            walletAvailable: false,
            loadingLightNode: false,
            modalOpen: false
        };
    }

    get onConnected() {
        return this.props.onConnected;
    }

    async didMount() {
        await this.checkWalletConnection();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const unsubConnected = eventBus.on('wallet:connected', () => {
            this.setState({ walletConnected: true, modalOpen: false });
            if (this.onConnected) {
                this.onConnected();
            }
        });

        const unsubDisconnected = eventBus.on('wallet:disconnected', () => {
            this.setState({ walletConnected: false });
        });

        this.registerCleanup(() => {
            unsubConnected();
            unsubDisconnected();
        });
    }

    async checkWalletConnection() {
        try {
            const walletAvailable = typeof window.ethereum !== 'undefined';

            // Check if already connected
            let isConnected = false;
            if (this.walletService) {
                isConnected = this.walletService.isConnected();
            }

            // Try auto-reconnect if wallet available and has accounts
            if (!isConnected && walletAvailable) {
                try {
                    const lastWallet = localStorage.getItem('ms2fun_lastWallet');
                    if (lastWallet) {
                        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                        if (accounts && accounts.length > 0) {
                            // Silently reconnect
                            if (this.walletService) {
                                await this.walletService.selectWallet(lastWallet);
                                await this.walletService.connect();
                                isConnected = this.walletService.isConnected();
                            }
                        }
                    }
                } catch (e) {
                    console.log('[WalletSplash] Auto-reconnect not possible');
                }
            }

            this.setState({
                walletConnected: isConnected,
                checking: false,
                walletAvailable
            });

            if (isConnected && this.onConnected) {
                this.onConnected();
            }
        } catch (error) {
            console.error('[WalletSplash] Error checking wallet connection:', error);
            this.setState({
                walletConnected: false,
                checking: false,
                walletAvailable: typeof window.ethereum !== 'undefined'
            });
        }
    }

    handleOpenModal() {
        if (this.state.walletAvailable) {
            this.setState({ modalOpen: true });
        }
    }

    handleCloseModal() {
        this.setState({ modalOpen: false });
    }

    async handleWalletSelection(walletType) {
        try {
            if (this.walletService) {
                await this.walletService.selectWallet(walletType);
                localStorage.setItem('ms2fun_lastWallet', walletType);
                await this.walletService.connect();
                this.setState({ walletConnected: true, modalOpen: false });
                if (this.onConnected) {
                    this.onConnected();
                }
            }
        } catch (error) {
            console.error('[WalletSplash] Error connecting wallet:', error);
        }
    }

    async handleContinueWithoutWallet() {
        if (this.state.walletAvailable) {
            // Can use wallet RPC even without connection
            if (this.onConnected) {
                this.onConnected();
            }
            return;
        }

        // Load light node
        this.setState({ loadingLightNode: true });
        try {
            const { initializeReadOnlyMode } = await import('../../index.js');
            const success = await initializeReadOnlyMode();
            if (success && this.onConnected) {
                this.onConnected();
            } else {
                this.setState({ loadingLightNode: false });
            }
        } catch (error) {
            console.error('[WalletSplash] Error loading light node:', error);
            this.setState({ loadingLightNode: false });
        }
    }

    renderWalletOption(walletType, label, iconPath) {
        return h('button', {
            className: 'wallet-option',
            'data-wallet': walletType,
            onClick: () => this.handleWalletSelection(walletType)
        },
            h('img', { src: iconPath, alt: label }),
            h('span', null, label)
        );
    }

    render() {
        const { checking, walletConnected, walletAvailable, loadingLightNode, modalOpen } = this.state;

        if (checking) {
            return h('div', { className: 'wallet-splash' },
                h('div', { className: 'splash-content marble-bg' },
                    h('div', { className: 'splash-spinner' }),
                    h('h2', null, 'Checking wallet connection...')
                )
            );
        }

        if (walletConnected) {
            return h('div', { className: 'wallet-splash-connected', style: { display: 'none' } });
        }

        return h('div', { className: 'wallet-splash' },
            h('div', { className: 'splash-content marble-bg' },
                h('div', { className: 'splash-header' },
                    h('h1', null, 'Connect Your Wallet'),
                    h('p', { className: 'splash-subtitle' },
                        'Connect your wallet to access the MS2.FUN launchpad'
                    )
                ),

                h('div', { className: 'splash-description' },
                    h('p', null, 'This application requires a connected wallet to access on-chain data and interact with projects.'),
                    h('p', null, walletAvailable
                        ? "You can connect your wallet or continue using your wallet's RPC for read-only access."
                        : 'No wallet detected. You can continue with read-only mode using a light node.'
                    )
                ),

                h('div', { className: 'wallet-connector-container' },
                    h('div', { className: 'contract-status' },
                        h('div', { id: 'contractStatus', className: 'status-message' },
                            loadingLightNode ? 'DOWNLOADING LIGHT NODE...' : 'INITIALIZING SYSTEM...'
                        ),

                        h('button', {
                            id: 'selectWallet',
                            className: 'connect-button',
                            disabled: !walletAvailable,
                            style: { opacity: walletAvailable ? 1 : 0.5 },
                            onClick: this.bind(this.handleOpenModal)
                        },
                            h('span', { className: 'button-text' }, 'SELECT WALLET')
                        ),

                        h('button', {
                            id: 'continueButton',
                            className: 'connect-button',
                            style: { marginTop: '1rem', opacity: loadingLightNode ? 0.7 : 1 },
                            onClick: this.bind(this.handleContinueWithoutWallet)
                        },
                            h('span', { className: 'button-text' },
                                loadingLightNode ? 'LOADING...' : 'CONTINUE'
                            )
                        ),

                        !walletAvailable && h('p', {
                            className: 'light-node-explainer',
                            style: {
                                marginTop: '1rem',
                                fontSize: '0.875rem',
                                color: 'rgba(255, 255, 255, 0.7)',
                                textAlign: 'center',
                                maxWidth: '400px',
                                marginLeft: 'auto',
                                marginRight: 'auto'
                            }
                        }, 'This will download and run a light node to enable read-only blockchain access without a wallet.')
                    )
                ),

                // Wallet Modal
                modalOpen && h('div', {
                    className: 'wallet-modal active',
                    onClick: (e) => {
                        if (e.target.classList.contains('wallet-modal')) {
                            this.handleCloseModal();
                        }
                    }
                },
                    h('div', { className: 'wallet-modal-content' },
                        h('div', { className: 'wallet-modal-header' },
                            h('h3', null, 'Select Your Wallet'),
                            h('button', {
                                className: 'wallet-modal-close',
                                onClick: this.bind(this.handleCloseModal)
                            }, '\u00d7')
                        ),
                        h('div', { className: 'wallet-options' },
                            this.renderWalletOption('rabby', 'Rabby', '/public/wallets/rabby.webp'),
                            this.renderWalletOption('rainbow', 'Rainbow', '/public/wallets/rainbow.webp'),
                            this.renderWalletOption('phantom', 'Phantom', '/public/wallets/phantom.webp'),
                            this.renderWalletOption('metamask', 'MetaMask', '/public/wallets/MetaMask.webp')
                        )
                    )
                )
            )
        );
    }
}

export default WalletSplash;
