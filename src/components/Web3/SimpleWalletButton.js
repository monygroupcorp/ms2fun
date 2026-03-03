/**
 * SimpleWalletButton - Gallery Brutalism wallet button
 *
 * Brutalist wallet button with status indicator
 * - Cyan indicator when connected
 * - Red indicator when disconnected
 *
 * @example
 * h(SimpleWalletButton)
 */

import { h, Component } from '@monygroupcorp/microact';
import { eventBus } from '../../core/EventBus.js';
import walletService from '../../services/WalletService.js';

export class SimpleWalletButton extends Component {
    constructor(props) {
        super(props);
        this.state = {
            connected: false,
            expanded: false,
            address: null,
            balance: '0.000'
            // TODO: Add indexing status back when we have a better design for it
            // currentBlock: 0,
            // blocksBehind: 0
        };
        this.walletService = walletService;
    }

    async didMount() {
        // Initialize wallet service
        if (!this.walletService.isInitialized) {
            await this.walletService.initialize();
        }

        // Get wallet service (already set in constructor)
        await this.walletService.initialize();

        // Check if already connected
        if (this.walletService.connected) {
            this.setState({
                connected: true,
                address: this.walletService.connectedAddress,
                balance: await this.getBalance()
            });
        }

        // Listen for wallet events
        this.unsubscribeConnected = eventBus.on('wallet:connected', async (data) => {
            this.setState({
                connected: true,
                address: data.address,
                balance: await this.getBalance(),
                expanded: false
            });
        });

        this.unsubscribeDisconnected = eventBus.on('wallet:disconnected', () => {
            this.setState({
                connected: false,
                expanded: false,
                address: null,
                balance: '0.000'
            });
        });

        document.addEventListener('click', this.handleClickOutside);
    }

    willUnmount() {
        if (this.unsubscribeConnected) this.unsubscribeConnected();
        if (this.unsubscribeDisconnected) this.unsubscribeDisconnected();
        document.removeEventListener('click', this.handleClickOutside);
    }

    async getBalance() {
        try {
            if (!this.walletService.ethersProvider) {
                console.log('[SimpleWalletButton] No ethersProvider available');
                return '0.000';
            }
            if (!this.walletService.connectedAddress) {
                console.log('[SimpleWalletButton] No connected address');
                return '0.000';
            }

            console.log('[SimpleWalletButton] Fetching balance for:', this.walletService.connectedAddress);
            const balance = await this.walletService.ethersProvider.getBalance(this.walletService.connectedAddress);
            const formatted = parseFloat(this.walletService.ethers.utils.formatEther(balance)).toFixed(3);
            console.log('[SimpleWalletButton] Balance:', formatted);
            return formatted;
        } catch (error) {
            console.error('[SimpleWalletButton] Error fetching balance:', error);
            return '0.000';
        }
    }

    handleButtonClick = async () => {
        const { connected } = this.state;

        if (!connected) {
            // Connect wallet
            try {
                // First select the wallet type
                await this.walletService.selectWallet('metamask');
                // Then connect
                await this.walletService.connect();

                // Check current network
                const currentNetwork = await this.walletService.provider.request({ method: 'eth_chainId' });
                console.log('[SimpleWalletButton] Current chain ID:', currentNetwork);

                // Ensure we're on the correct network (chain 1337 for local Anvil)
                console.log('[SimpleWalletButton] Calling ensureCorrectNetwork()...');
                await this.walletService.ensureCorrectNetwork();
                console.log('[SimpleWalletButton] Wallet connected and network verified');
            } catch (error) {
                console.error('[SimpleWalletButton] Connection failed:', error);
            }
        } else {
            // Toggle expanded state
            const newExpanded = !this.state.expanded;
            this.setState({ expanded: newExpanded });

            // TODO: Load indexing status when opening menu (commented out for now - needs better design)
            // if (newExpanded) {
            //     await this.loadIndexingStatus();
            // }
        }
    }

    // TODO: Indexing status - commented out for now, needs better design
    // async loadIndexingStatus() {
    //     try {
    //         const provider = this.walletService.ethersProvider;
    //         if (provider) {
    //             const currentBlock = await provider.getBlockNumber();
    //
    //             // For now, blocks behind is 0 (we'd need activity data to calculate this properly)
    //             this.setState({
    //                 currentBlock,
    //                 blocksBehind: 0
    //             });
    //         }
    //     } catch (error) {
    //         console.error('[SimpleWalletButton] Failed to load indexing status:', error);
    //     }
    // }

    handleDisconnect = async (e) => {
        e.stopPropagation();
        try {
            await this.walletService.disconnect();
            console.log('[SimpleWalletButton] Disconnected');
        } catch (error) {
            console.error('[SimpleWalletButton] Disconnect failed:', error);
        }
    }

    handlePortfolioClick = (e) => {
        e.stopPropagation();
        this.setState({ expanded: false });
        window.router.navigate('/portfolio');
    }

    handleClickOutside = (e) => {
        if (this.state.expanded && !e.target.closest('.brutalist-wallet-button')) {
            this.setState({ expanded: false });
        }
    }

    truncateAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    render() {
        const { connected, expanded, address, balance } = this.state;
        // TODO: Add back when indexing status design is finalized
        // const { currentBlock, blocksBehind } = this.state;
        const statusClass = connected ? 'wallet-status-connected' : 'wallet-status-disconnected';
        const expandedClass = expanded ? 'wallet-expanded' : '';

        return h('div', { className: `brutalist-wallet-container ${expandedClass}` },
            // Main button
            h('button', {
                className: `brutalist-wallet-button ${statusClass}`,
                title: connected ? `Connected: ${address}` : 'Connect Wallet',
                onclick: this.handleButtonClick
            },
                // Status indicator dot
                h('span', { className: 'wallet-status-indicator' }),
                // Text
                h('span', { className: 'wallet-text' },
                    connected ? this.truncateAddress(address) : 'Connect'
                )
            ),

            // Expanded dropdown (only when connected and expanded)
            connected && expanded ? h('div', { className: 'wallet-dropdown' },
                // Full address
                h('div', { className: 'wallet-dropdown-address' }, address),

                // ETH Balance
                h('div', { className: 'wallet-dropdown-balance' },
                    h('span', { className: 'wallet-balance-label' }, 'ETH:'),
                    h('span', { className: 'wallet-balance-value text-mono' }, balance)
                ),

                // Divider
                h('div', { className: 'wallet-dropdown-divider' }),

                // Portfolio link
                h('button', {
                    className: 'wallet-dropdown-link',
                    onclick: this.handlePortfolioClick
                }, '→ Portfolio'),

                // TODO: Indexing Status Section - commented out for now, needs better design
                // h('div', { className: 'wallet-dropdown-divider' }),
                // currentBlock > 0 ? h('div', { className: 'wallet-dropdown-section' },
                //     h('div', { className: 'wallet-section-title' }, 'Indexing Status'),
                //     h('div', { className: 'wallet-section-content' },
                //         h('div', { className: 'wallet-status-row' },
                //             h('span', { className: 'wallet-status-label' }, 'Current Block'),
                //             h('span', { className: 'wallet-status-value text-mono' }, currentBlock.toLocaleString())
                //         ),
                //         h('div', { className: 'wallet-status-row' },
                //             h('span', { className: 'wallet-status-label' }, 'Blocks Behind'),
                //             h('span', {
                //                 className: `wallet-status-value text-mono ${blocksBehind > 10 ? 'text-warning' : 'text-success'}`
                //             }, blocksBehind.toLocaleString())
                //         )
                //     )
                // ) : null,
                // currentBlock > 0 ? h('div', { className: 'wallet-dropdown-divider' }) : null,

                // Disconnect button
                h('button', {
                    className: 'wallet-dropdown-disconnect',
                    onclick: this.handleDisconnect
                }, 'Disconnect')
            ) : null
        );
    }
}

export default SimpleWalletButton;
