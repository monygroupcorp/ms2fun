/**
 * WalletDisplay - Microact Version
 *
 * Displays connected wallet address and ETH balance with disconnect button.
 * Handles auto-reconnection to previously connected wallets.
 */

import { Component, h } from '../../core/microact-setup.js';
import { eventBus } from '../../core/microact-setup.js';
import walletService from '../../services/WalletService.js';

export class WalletDisplay extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            address: null,
            balance: '0.00',
            loading: true
        };
    }

    async didMount() {
        await this.loadWalletInfo();
        this.setupSubscriptions();
    }

    async loadWalletInfo() {
        // Ensure wallet service is initialized
        if (!walletService.isInitialized) {
            await walletService.initialize();
        }

        let isConnected = walletService.isConnected();
        let address = walletService.getAddress();

        // Try to auto-reconnect if not connected but ethereum exists
        if (!isConnected && typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts?.length > 0) {
                    const lastWallet = localStorage.getItem('ms2fun_lastWallet');
                    const walletType = lastWallet || this.detectWalletType();

                    if (walletType) {
                        try {
                            await walletService.selectWallet(walletType);
                            await walletService.connect();
                            address = walletService.getAddress();
                            isConnected = walletService.isConnected();

                            if (!isConnected || !address) {
                                address = accounts[0];
                                isConnected = true;
                            }
                        } catch (connectError) {
                            if (connectError.code === 4001 || connectError.message?.includes('rejected')) {
                                this.setState({ loading: false });
                                return;
                            }
                            address = accounts[0];
                            isConnected = true;
                        }
                    }
                }
            } catch (error) {
                console.log('[WalletDisplay] Could not check accounts:', error);
            }
        }

        if (!isConnected || !address) {
            this.setState({ loading: false });
            return;
        }

        // Load ETH balance
        try {
            let provider = walletService.ethersProvider;
            if (!provider && typeof window.ethereum !== 'undefined') {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }

            if (provider && address) {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                const balance = await provider.getBalance(address);
                const balanceEth = parseFloat(ethers.utils.formatEther(balance)).toFixed(4);
                this.setState({ address, balance: balanceEth, loading: false });
            } else {
                this.setState({ address, loading: false });
            }
        } catch (error) {
            console.error('[WalletDisplay] Failed to load balance:', error);
            this.setState({ address, loading: false });
        }
    }

    setupSubscriptions() {
        const unsub1 = eventBus.on('wallet:connected', () => this.loadWalletInfo());
        const unsub2 = eventBus.on('wallet:disconnected', () => {
            this.setState({ address: null, balance: '0.00' });
        });
        const unsub3 = eventBus.on('wallet:changed', () => this.loadWalletInfo());

        this.registerCleanup(() => {
            unsub1();
            unsub2();
            unsub3();
        });
    }

    detectWalletType() {
        if (typeof window.ethereum === 'undefined') return null;
        if (window.ethereum.isRabby) return 'rabby';
        if (window.ethereum.isRainbow) return 'rainbow';
        if (window.phantom?.ethereum) return 'phantom';
        if (window.ethereum.isMetaMask) return 'metamask';
        return 'metamask';
    }

    async handleDisconnect() {
        try {
            await walletService.disconnect();
            const { onNavigate } = this.props;
            if (onNavigate) {
                onNavigate('/');
            } else if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('[WalletDisplay] Failed to disconnect:', error);
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { address, balance, loading } = this.state;

        if (loading) {
            return h('div', { className: 'wallet-display loading' }, 'Loading wallet info...');
        }

        if (!address) {
            return h('div', { className: 'wallet-display-empty' });
        }

        return h('div', { className: 'wallet-display' },
            h('div', { className: 'wallet-info' },
                h('span', { className: 'wallet-label' }, 'Connected:'),
                h('span', { className: 'wallet-address' }, this.truncateAddress(address)),
                h('span', { className: 'wallet-balance' }, `${balance} ETH`)
            ),
            h('button', {
                className: 'disconnect-button',
                onClick: this.bind(this.handleDisconnect)
            }, 'Disconnect')
        );
    }
}

export default WalletDisplay;
