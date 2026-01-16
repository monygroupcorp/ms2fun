import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import WalletModal from '../WalletModal/WalletModal.js';
import { eventBus } from '../../core/EventBus.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * FloatingWalletButton component
 * Persistent floating wallet button (bottom-right corner) with dropdown menu
 *
 * Design: Metal plaque style
 * - Silver when disconnected
 * - Gold when connected
 * - Diamond icon (CSS-styled)
 */
export class FloatingWalletButton extends Component {
    constructor() {
        super();
        this.walletModal = null;
        this.state = {
            walletConnected: false,
            address: null,
            balance: '0.00',
            loading: true,
            menuOpen: false
        };
    }

    async onMount() {
        // Check wallet connection status
        await this.checkWalletConnection();

        // Set up event listeners
        this.setupEventListeners();

        // Set up click outside handler for menu
        this.setupClickOutsideHandler();
    }

    /**
     * Check if wallet is already connected
     * Simple check - no auto-reconnect attempts, no localStorage
     */
    async checkWalletConnection() {
        try {
            // Check if walletService already has a connection
            if (walletService.isConnected()) {
                const address = walletService.getAddress();
                if (address) {
                    await this.loadWalletInfo(address);
                    return;
                }
            }

            // Check if window.ethereum has accounts (user previously connected)
            if (typeof window.ethereum !== 'undefined') {
                try {
                    // eth_accounts doesn't prompt - just checks existing permissions
                    const accounts = await window.ethereum.request({ method: 'eth_accounts' });

                    if (accounts && accounts.length > 0) {
                        // User has previously connected - update our state
                        // But don't fully initialize walletService yet (they need to click)
                        this.setState({
                            walletConnected: true,
                            address: accounts[0],
                            loading: false
                        });

                        // Try to get balance
                        await this.loadWalletInfo(accounts[0]);
                        return;
                    }
                } catch (error) {
                    console.log('[FloatingWalletButton] Could not check accounts:', error.message);
                }
            }

            // No connection found
            this.setState({ loading: false, walletConnected: false });
        } catch (error) {
            console.error('[FloatingWalletButton] Error checking wallet:', error);
            this.setState({ loading: false, walletConnected: false });
        }
    }

    /**
     * Load wallet info (balance)
     */
    async loadWalletInfo(address) {
        try {
            let provider = walletService.ethersProvider;

            // If walletService doesn't have a provider, create a temporary one
            if (!provider && typeof window.ethereum !== 'undefined') {
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }

            let balance = '0.00';
            if (provider && address) {
                try {
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
        // Listen for wallet connection
        const unsubscribeConnected = eventBus.on('wallet:connected', async (data) => {
            await this.loadWalletInfo(data.address);
        });

        // Listen for wallet disconnection
        const unsubscribeDisconnected = eventBus.on('wallet:disconnected', () => {
            this.setState({
                walletConnected: false,
                address: null,
                balance: '0.00',
                menuOpen: false
            });
        });

        // Listen for wallet/account change
        const unsubscribeChanged = eventBus.on('wallet:changed', async (data) => {
            await this.loadWalletInfo(data.address);
        });

        // Register cleanup
        this.registerCleanup(() => {
            unsubscribeConnected();
            unsubscribeDisconnected();
            unsubscribeChanged();
        });
    }

    setupClickOutsideHandler() {
        const handleClickOutside = (e) => {
            if (!this.element) return;

            // Check if click is outside the floating wallet button
            if (!this.element.contains(e.target) && this.state.menuOpen) {
                this.setState({ menuOpen: false });
            }
        };

        document.addEventListener('click', handleClickOutside);

        this.registerCleanup(() => {
            document.removeEventListener('click', handleClickOutside);
        });
    }

    async handleButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();

        if (this.state.walletConnected) {
            // Toggle dropdown menu
            this.setState({ menuOpen: !this.state.menuOpen });
        } else {
            // Show wallet connection modal
            await this.showWalletModal();
        }
    }

    async showWalletModal() {
        // Get provider map and icons from walletService
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

        // Create WalletModal if not exists
        if (!this.walletModal) {
            this.walletModal = new WalletModal(
                providerMap,
                walletIcons,
                async (walletType) => {
                    await this.handleWalletSelection(walletType);
                }
            );
        }

        this.walletModal.show();
    }

    async handleWalletSelection(walletType) {
        try {
            // Select and connect to the wallet
            await walletService.selectWallet(walletType);
            await walletService.connect();
            // Event listener will update state on success
        } catch (error) {
            console.error('[FloatingWalletButton] Error connecting wallet:', error);
        }
    }

    handleMenuItemClick(route) {
        // Close menu
        this.setState({ menuOpen: false });

        // Navigate to route
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

    render() {
        const { walletConnected, address, balance, loading, menuOpen } = this.state;

        if (loading) {
            return `
                <div class="floating-wallet-button loading">
                    <div class="wallet-btn">
                        <div class="wallet-spinner"></div>
                    </div>
                </div>
            `;
        }

        if (!walletConnected) {
            // Disconnected - silver plaque
            return `
                <div class="floating-wallet-button disconnected" data-ref="wallet-button">
                    <button class="wallet-btn" data-ref="wallet-btn">
                        <span class="wallet-icon"></span>
                        <span class="wallet-text">Connect</span>
                    </button>
                </div>
            `;
        }

        // Connected - gold plaque with address
        const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

        return `
            <div class="floating-wallet-button connected ${menuOpen ? 'menu-open' : ''}" data-ref="wallet-button">
                <button class="wallet-btn" data-ref="wallet-btn" title="${this.escapeHtml(address)}">
                    <span class="wallet-icon"></span>
                    <span class="wallet-address">${this.escapeHtml(truncatedAddress)}</span>
                </button>

                ${menuOpen ? this.renderDropdownMenu(address, balance) : ''}
            </div>
        `;
    }

    renderDropdownMenu(address, balance) {
        const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

        return `
            <div class="wallet-dropdown-menu" data-ref="dropdown-menu">
                <div class="dropdown-header">
                    <div class="dropdown-address">${this.escapeHtml(truncatedAddress)}</div>
                    <div class="dropdown-balance">${balance} ETH</div>
                </div>

                <div class="dropdown-divider"></div>

                <div class="dropdown-items">
                    <button class="dropdown-item" data-route="/portfolio" data-ref="menu-item">
                        <span class="item-icon">&#9670;</span>
                        <span class="item-label">Portfolio</span>
                    </button>

                    <button class="dropdown-item" data-route="/staking" data-ref="menu-item">
                        <span class="item-icon">&#9671;</span>
                        <span class="item-label">Staking</span>
                    </button>
                </div>

                <div class="dropdown-divider"></div>

                <div class="dropdown-items">
                    <button class="dropdown-item disconnect" data-ref="disconnect-btn">
                        <span class="item-icon">&#10005;</span>
                        <span class="item-label">Disconnect</span>
                    </button>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        if (!this.element) return;

        // Main button click handler
        const walletBtn = this.getRef('wallet-btn', '.wallet-btn');

        if (walletBtn) {
            walletBtn.addEventListener('click', (e) => this.handleButtonClick(e));
        }

        // Menu item click handlers
        const menuItems = this.getRefs('.dropdown-item[data-route]');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const route = item.getAttribute('data-route');
                if (route) {
                    this.handleMenuItemClick(route);
                }
            });
        });

        // Disconnect button handler
        const disconnectBtn = this.getRef('disconnect-btn', '.dropdown-item.disconnect');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', (e) => this.handleDisconnect(e));
        }
    }

    onStateUpdate(oldState, newState) {
        // Re-setup DOM listeners when menu state changes
        if (oldState.menuOpen !== newState.menuOpen ||
            oldState.walletConnected !== newState.walletConnected) {
            this.setTimeout(() => {
                this.setupDOMEventListeners();
            }, 0);
        }
    }

    onUnmount() {
        // Clean up wallet modal
        if (this.walletModal) {
            this.walletModal.hide();
            this.walletModal = null;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
