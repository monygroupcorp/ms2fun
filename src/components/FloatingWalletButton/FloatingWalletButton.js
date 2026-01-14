import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import WalletModal from '../WalletModal/WalletModal.js';
import { eventBus } from '../../core/EventBus.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * FloatingWalletButton component
 * Persistent floating wallet button (bottom-right corner) with power user dropdown menu
 * Replaces WalletSplash for non-blocking wallet connection
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
            menuOpen: false,
            // Conditional menu items
            hasExecTokens: false,
            isVaultBenefactor: false
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
     * Check if wallet is already connected and load info
     */
    async checkWalletConnection() {
        try {
            // Initialize wallet service if needed
            if (!walletService.isInitialized) {
                await walletService.initialize();
            }

            // Check if wallet service thinks it's connected
            let isConnected = walletService.isConnected();
            let address = walletService.getAddress();

            // If not connected, try to auto-reconnect to last used wallet
            if (!isConnected && typeof window.ethereum !== 'undefined') {
                try {
                    const lastWallet = localStorage.getItem('ms2fun_lastWallet');

                    if (lastWallet) {
                        // Check if that wallet has accounts (without prompting)
                        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                        const hasAccounts = accounts && accounts.length > 0;

                        // Only try to reconnect if the last wallet has accounts
                        if (hasAccounts) {
                            try {
                                await walletService.selectWallet(lastWallet);
                                await walletService.connect();
                                isConnected = walletService.isConnected();
                                address = walletService.getAddress();

                                if (isConnected) {
                                    console.log('[FloatingWalletButton] Auto-reconnected to', lastWallet);
                                }
                            } catch (connectError) {
                                console.log('[FloatingWalletButton] Auto-reconnect not possible');
                            }
                        }
                    }
                } catch (error) {
                    console.log('[FloatingWalletButton] Could not check existing accounts:', error);
                }
            }

            if (isConnected && address) {
                await this.loadWalletInfo(address);
            } else {
                this.setState({ loading: false, walletConnected: false });
            }
        } catch (error) {
            console.error('[FloatingWalletButton] Error checking wallet connection:', error);
            this.setState({ loading: false, walletConnected: false });
        }
    }

    /**
     * Load wallet info (balance, EXEC tokens, vault benefactor status)
     */
    async loadWalletInfo(address) {
        try {
            // Get ETH balance
            let provider = walletService.ethersProvider;
            if (!provider && typeof window.ethereum !== 'undefined') {
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }

            let balance = '0.00';
            if (provider && address) {
                const balanceWei = await provider.getBalance(address);
                balance = parseFloat(ethers.utils.formatEther(balanceWei)).toFixed(4);
            }

            // TODO: Check EXEC token holdings for governance menu visibility
            // const hasExecTokens = await this.checkExecTokens(address);
            const hasExecTokens = false; // Placeholder for now

            // TODO: Check vault benefactor status
            // const isVaultBenefactor = await this.checkVaultBenefactor(address);
            const isVaultBenefactor = false; // Placeholder for now

            this.setState({
                walletConnected: true,
                address,
                balance,
                loading: false,
                hasExecTokens,
                isVaultBenefactor
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

    /**
     * TODO: Check if user holds EXEC tokens
     */
    async checkExecTokens(address) {
        // Will implement when ERC404 adapter is wired up
        // const execBalance = await ERC404Adapter.balanceOf(address, EXEC_TOKEN_ADDRESS);
        // return execBalance > 0;
        return false;
    }

    /**
     * TODO: Check if user is a vault benefactor
     */
    async checkVaultBenefactor(address) {
        // Will implement when vault adapters are wired up
        // Iterate vaults, check getBenefactorShares(address) > 0
        return false;
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
                menuOpen: false,
                hasExecTokens: false,
                isVaultBenefactor: false
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
            // Select the wallet
            await walletService.selectWallet(walletType);

            // Store the selected wallet in localStorage for future auto-reconnect
            localStorage.setItem('ms2fun_lastWallet', walletType);

            // Connect to the wallet
            await walletService.connect();

            // Wallet is now connected (event listener will update state)

        } catch (error) {
            console.error('[FloatingWalletButton] Error connecting wallet:', error);
            // TODO: Show error message
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
        if (this.state.loading) {
            return `
                <div class="floating-wallet-button loading">
                    <div class="wallet-spinner"></div>
                </div>
            `;
        }

        const { walletConnected, address, balance, menuOpen, hasExecTokens, isVaultBenefactor } = this.state;

        if (!walletConnected) {
            // Not connected - show "Connect" button
            return `
                <div class="floating-wallet-button disconnected" data-ref="wallet-button">
                    <button class="wallet-btn" data-ref="connect-btn">
                        <span class="wallet-icon">🦊</span>
                        <span class="wallet-text">Connect</span>
                    </button>
                </div>
            `;
        }

        // Connected - show abbreviated address
        const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

        return `
            <div class="floating-wallet-button connected ${menuOpen ? 'menu-open' : ''}" data-ref="wallet-button">
                <button class="wallet-btn" data-ref="wallet-btn" title="${this.escapeHtml(address)}\nBalance: ${balance} ETH">
                    <span class="wallet-icon">🦊</span>
                    <span class="wallet-address">${this.escapeHtml(truncatedAddress)}</span>
                </button>

                ${menuOpen ? this.renderDropdownMenu(address, balance, hasExecTokens, isVaultBenefactor) : ''}
            </div>
        `;
    }

    renderDropdownMenu(address, balance, hasExecTokens, isVaultBenefactor) {
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
                        <span class="item-icon">📊</span>
                        <span class="item-label">Portfolio</span>
                    </button>

                    ${hasExecTokens ? `
                        <button class="dropdown-item" data-route="/governance" data-ref="menu-item">
                            <span class="item-icon">🗳️</span>
                            <span class="item-label">Governance</span>
                        </button>
                    ` : ''}

                    <button class="dropdown-item" data-route="/staking" data-ref="menu-item">
                        <span class="item-icon">🎯</span>
                        <span class="item-label">Staking</span>
                    </button>

                    ${isVaultBenefactor ? `
                        <button class="dropdown-item" data-route="/portfolio?filter=vaults" data-ref="menu-item">
                            <span class="item-icon">💰</span>
                            <span class="item-label">Vault Positions</span>
                        </button>
                    ` : ''}
                </div>

                <div class="dropdown-divider"></div>

                <div class="dropdown-items">
                    <button class="dropdown-item" data-action="settings" data-ref="menu-item">
                        <span class="item-icon">⚙️</span>
                        <span class="item-label">Settings</span>
                    </button>

                    <button class="dropdown-item disconnect" data-ref="disconnect-btn">
                        <span class="item-icon">🔌</span>
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
        const menuItems = this.getRefs('.dropdown-item[data-route], .dropdown-item[data-action]');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const route = item.getAttribute('data-route');
                const action = item.getAttribute('data-action');

                if (route) {
                    this.handleMenuItemClick(route);
                } else if (action === 'settings') {
                    // TODO: Implement settings modal
                    console.log('Settings clicked');
                    this.setState({ menuOpen: false });
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
        // Re-setup DOM listeners when state changes
        if (oldState.menuOpen !== newState.menuOpen) {
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
