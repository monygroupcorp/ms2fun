/**
 * FloatingWalletButton - Microact Version
 *
 * Persistent floating wallet button (bottom-right corner) with dropdown menu.
 * Design: Metal plaque style - Silver when disconnected, Gold when connected.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class FloatingWalletButton extends Component {
    constructor(props = {}) {
        super(props);
        this._walletModal = null;
        this._clickOutsideHandler = null;
        this.state = {
            walletConnected: false,
            address: null,
            balance: '0.00',
            loading: true,
            menuOpen: false
        };
    }

    async didMount() {
        await this.checkWalletConnection();
        this.setupEventListeners();
        this.setupClickOutsideHandler();
    }

    async checkWalletConnection() {
        try {
            if (walletService.isConnected()) {
                const address = walletService.getAddress();
                if (address) {
                    await this.loadWalletInfo(address);
                    return;
                }
            }

            if (typeof window.ethereum !== 'undefined') {
                try {
                    const accounts = await window.ethereum.request({ method: 'eth_accounts' });

                    if (accounts && accounts.length > 0) {
                        const lastWallet = localStorage.getItem('ms2fun_lastWallet');
                        await walletService.syncWithExistingConnection(accounts[0], lastWallet);

                        this.setState({
                            walletConnected: true,
                            address: accounts[0],
                            loading: false
                        });

                        await this.loadWalletInfo(accounts[0]);
                        return;
                    }
                } catch (error) {
                    console.log('[FloatingWalletButton] Could not check accounts:', error.message);
                }
            }

            this.setState({ loading: false, walletConnected: false });
        } catch (error) {
            console.error('[FloatingWalletButton] Error checking wallet:', error);
            this.setState({ loading: false, walletConnected: false });
        }
    }

    async loadWalletInfo(address) {
        try {
            let provider = walletService.ethersProvider;

            if (!provider && typeof window.ethereum !== 'undefined') {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }

            let balance = '0.00';
            if (provider && address) {
                try {
                    const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                    const balanceWei = await provider.getBalance(address);
                    balance = parseFloat(ethers.utils.formatEther(balanceWei)).toFixed(4);
                } catch (balanceError) {
                    console.log('[FloatingWalletButton] Could not fetch balance:', balanceError.message);
                }
            }

            this.setState({
                walletConnected: true,
                address,
                balance,
                loading: false
            });
        } catch (error) {
            console.error('[FloatingWalletButton] Failed to load wallet info:', error);
            this.setState({
                walletConnected: true,
                address,
                loading: false
            });
        }
    }

    setupEventListeners() {
        const unsub1 = eventBus.on('wallet:connected', async (data) => {
            await this.loadWalletInfo(data.address);
        });

        const unsub2 = eventBus.on('wallet:disconnected', () => {
            this.setState({
                walletConnected: false,
                address: null,
                balance: '0.00',
                menuOpen: false
            });
        });

        const unsub3 = eventBus.on('wallet:changed', async (data) => {
            await this.loadWalletInfo(data.address);
        });

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
        });
    }

    setupClickOutsideHandler() {
        this._clickOutsideHandler = (e) => {
            if (!this._element) return;

            if (!this._element.contains(e.target) && this.state.menuOpen) {
                this.setState({ menuOpen: false });
            }
        };

        document.addEventListener('click', this._clickOutsideHandler);

        this.registerCleanup(() => {
            if (this._clickOutsideHandler) {
                document.removeEventListener('click', this._clickOutsideHandler);
            }
        });
    }

    async handleButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();

        if (this.state.walletConnected) {
            this.setState({ menuOpen: !this.state.menuOpen });
        } else {
            await this.showWalletModal();
        }
    }

    async showWalletModal() {
        const providerMap = {
            rabby: () => window.ethereum?.isRabby ? window.ethereum : null,
            rainbow: () => window.ethereum?.isRainbow ? window.ethereum : null,
            phantom: () => window.phantom?.ethereum || null,
            metamask: () => window.ethereum || null
        };

        const walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/MetaMask.webp'
        };

        if (!this._walletModal) {
            const { WalletModal } = await import('../WalletModal/WalletModal.js');
            this._walletModal = new WalletModal(
                providerMap,
                walletIcons,
                async (walletType) => {
                    await this.handleWalletSelection(walletType);
                }
            );
        }

        this._walletModal.show();
    }

    async handleWalletSelection(walletType) {
        try {
            await walletService.selectWallet(walletType);
            await walletService.connect();
        } catch (error) {
            console.error('[FloatingWalletButton] Error connecting wallet:', error);
        }
    }

    handleMenuItemClick(route) {
        this.setState({ menuOpen: false });

        if (window.router) {
            window.router.navigate(route);
        } else {
            window.location.href = route;
        }
    }

    async handleDisconnect(e) {
        e.preventDefault();
        e.stopPropagation();

        try {
            await walletService.disconnect();
            this.setState({ menuOpen: false });
        } catch (error) {
            console.error('[FloatingWalletButton] Failed to disconnect:', error);
        }
    }

    willUnmount() {
        if (this._walletModal) {
            this._walletModal.hide();
            this._walletModal = null;
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { walletConnected, address, balance, loading, menuOpen } = this.state;

        if (loading) {
            return h('div', { className: 'floating-wallet-button loading' },
                h('div', { className: 'wallet-btn' },
                    h('div', { className: 'wallet-spinner' })
                )
            );
        }

        if (!walletConnected) {
            return h('div', { className: 'floating-wallet-button disconnected' },
                h('button', {
                    className: 'wallet-btn',
                    onClick: this.bind(this.handleButtonClick)
                },
                    h('span', { className: 'wallet-icon' }),
                    h('span', { className: 'wallet-text' }, 'Connect')
                )
            );
        }

        const truncatedAddress = this.truncateAddress(address);

        return h('div', { className: `floating-wallet-button connected ${menuOpen ? 'menu-open' : ''}` },
            h('button', {
                className: 'wallet-btn',
                title: address,
                onClick: this.bind(this.handleButtonClick)
            },
                h('span', { className: 'wallet-icon' }),
                h('span', { className: 'wallet-address' }, truncatedAddress)
            ),

            menuOpen && h('div', { className: 'wallet-dropdown-menu' },
                h('div', { className: 'dropdown-header' },
                    h('div', { className: 'dropdown-address' }, truncatedAddress),
                    h('div', { className: 'dropdown-balance' }, `${balance} ETH`)
                ),

                h('div', { className: 'dropdown-divider' }),

                h('div', { className: 'dropdown-items' },
                    h('button', {
                        className: 'dropdown-item',
                        onClick: () => this.handleMenuItemClick('/portfolio')
                    },
                        h('span', { className: 'item-icon' }, '\u25C6'),
                        h('span', { className: 'item-label' }, 'Portfolio')
                    ),
                    h('button', {
                        className: 'dropdown-item',
                        onClick: () => this.handleMenuItemClick('/staking')
                    },
                        h('span', { className: 'item-icon' }, '\u25C7'),
                        h('span', { className: 'item-label' }, 'Staking')
                    )
                ),

                h('div', { className: 'dropdown-divider' }),

                h('div', { className: 'dropdown-items' },
                    h('button', {
                        className: 'dropdown-item disconnect',
                        onClick: this.bind(this.handleDisconnect)
                    },
                        h('span', { className: 'item-icon' }, '\u2715'),
                        h('span', { className: 'item-label' }, 'Disconnect')
                    )
                )
            )
        );
    }
}

export default FloatingWalletButton;
