import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import WalletModal from '../WalletModal/WalletModal.js';
import { eventBus } from '../../core/EventBus.js';

/**
 * WalletSplash component
 * Blocks access to content until wallet is connected
 */
export class WalletSplash extends Component {
    constructor(onConnected) {
        super();
        this.onConnected = onConnected;
        this.walletModal = null;
        this.state = {
            walletConnected: false,
            checking: true
        };
    }

    async onMount() {
        // Check if wallet is already connected
        await this.checkWalletConnection();
        
        // Set up event listeners
        this.setupEventListeners();
    }

    /**
     * Detect which wallet provider is being used
     * @returns {string|null} Wallet type or null
     */
    detectWalletType() {
        if (typeof window.ethereum === 'undefined') {
            return null;
        }

        // Check for specific wallet identifiers
        if (window.ethereum.isRabby) {
            return 'rabby';
        }
        if (window.ethereum.isRainbow) {
            return 'rainbow';
        }
        if (window.phantom && window.phantom.ethereum) {
            return 'phantom';
        }
        if (window.ethereum.isMetaMask) {
            return 'metamask';
        }
        
        // Default to metamask if window.ethereum exists but no specific identifier
        return 'metamask';
    }

    async checkWalletConnection() {
        try {
            // First check if window.ethereum exists and has accounts
            let isConnected = false;
            
            if (typeof window.ethereum !== 'undefined') {
                try {
                    // Check if wallet service thinks it's connected
                    if (!walletService.isInitialized) {
                        await walletService.initialize();
                    }
                    
                    isConnected = walletService.isConnected();
                    
                    // Also check window.ethereum directly for accounts
                    if (!isConnected) {
                        try {
                            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                            if (accounts && accounts.length > 0) {
                                // Has accounts but wallet service doesn't know - detect and connect
                                console.log('Found existing wallet connection, detecting wallet type...');
                                
                                // Detect wallet type
                                const walletType = this.detectWalletType();
                                
                                if (walletType) {
                                    try {
                                        // Select the wallet first
                                        await walletService.selectWallet(walletType);
                                        // Then connect
                                        await walletService.connect();
                                        isConnected = walletService.isConnected();
                                        console.log('Auto-connected to', walletType);
                                    } catch (connectError) {
                                        console.log('Could not auto-connect:', connectError);
                                        // If auto-connect fails, user will need to manually connect
                                    }
                                } else {
                                    console.log('Could not detect wallet type');
                                }
                            }
                        } catch (accountsError) {
                            console.log('Could not check accounts:', accountsError);
                        }
                    }
                } catch (error) {
                    console.log('Error checking wallet:', error);
                }
            }
            
            this.setState({
                walletConnected: isConnected,
                checking: false
            });

            // If already connected, call onConnected callback
            if (isConnected && this.onConnected) {
                this.onConnected();
            }
        } catch (error) {
            console.error('Error checking wallet connection:', error);
            this.setState({
                walletConnected: false,
                checking: false
            });
        }
    }

    setupEventListeners() {
        // Listen for wallet connection
        const unsubscribeConnected = eventBus.on('wallet:connected', () => {
            this.setState({ walletConnected: true });
            if (this.onConnected) {
                this.onConnected();
            }
        });

        // Listen for wallet disconnection
        const unsubscribeDisconnected = eventBus.on('wallet:disconnected', () => {
            this.setState({ walletConnected: false });
        });

        // Register cleanup
        this.registerCleanup(() => {
            unsubscribeConnected();
            unsubscribeDisconnected();
        });
    }

    render() {
        if (this.state.checking) {
            return `
                <div class="wallet-splash">
                    <div class="splash-content">
                        <div class="splash-spinner"></div>
                        <h2>Checking wallet connection...</h2>
                    </div>
                </div>
            `;
        }

        if (this.state.walletConnected) {
            // Wallet is connected, hide splash (content will be shown)
            return '<div class="wallet-splash-connected" style="display: none;"></div>';
        }

        // Wallet not connected, show splash screen
        return `
            <div class="wallet-splash">
                <div class="splash-content">
                    <div class="splash-header">
                        <h1>Connect Your Wallet</h1>
                        <p class="splash-subtitle">Connect your wallet to access the MS2.FUN launchpad</p>
                    </div>
                    
                    <div class="splash-description">
                        <p>This application requires a connected wallet to access on-chain data and interact with projects.</p>
                        <p>Please connect your wallet to continue.</p>
                    </div>
                    
                    <div class="wallet-connector-container" data-ref="wallet-connector">
                        <div class="contract-status">
                            <div id="contractStatus" class="status-message">INITIALIZING SYSTEM...</div>
                            
                            <div id="selectedWalletDisplay" class="selected-wallet-display" style="display: none;">
                                <img id="selectedWalletIcon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E" alt="Selected Wallet">
                                <span class="wallet-name" id="selectedWalletName"></span>
                            </div>
                            <div id="continuePrompt" class="continue-prompt" style="display: none;">
                                CONTINUE IN YOUR WALLET
                            </div>
                            
                            <button id="selectWallet" class="connect-button">
                                <span class="button-text">SELECT WALLET</span>
                            </button>
                        </div>

                        <!-- Wallet Selection Modal (same as CultExecsPage) -->
                        <div id="walletModal" class="wallet-modal">
                            <div class="wallet-modal-content">
                                <div class="wallet-modal-header">
                                    <h3>Select Your Wallet</h3>
                                    <button class="wallet-modal-close" data-ref="modal-close">×</button>
                                </div>
                                <div class="wallet-options">
                                    <button class="wallet-option" data-wallet="rabby">
                                        <picture>
                                            <source srcset="public/wallets/rabby.avif" type="image/avif">
                                            <source srcset="public/wallets/rabby.webp" type="image/webp">
                                            <img src="public/wallets/rabby.png" alt="Rabby">
                                        </picture>
                                        <span>Rabby</span>
                                    </button>
                                    <button class="wallet-option" data-wallet="rainbow">
                                        <picture>
                                            <source srcset="public/wallets/rainbow.avif" type="image/avif">
                                            <source srcset="public/wallets/rainbow.webp" type="image/webp">
                                            <img src="public/wallets/rainbow.png" alt="Rainbow">
                                        </picture>
                                        <span>Rainbow</span>
                                    </button>
                                    <button class="wallet-option" data-wallet="phantom">
                                        <picture>
                                            <source srcset="public/wallets/phantom.avif" type="image/avif">
                                            <source srcset="public/wallets/phantom.webp" type="image/webp">
                                            <img src="public/wallets/phantom.png" alt="Phantom">
                                        </picture>
                                        <span>Phantom</span>
                                    </button>
                                    <button class="wallet-option" data-wallet="metamask">
                                        <picture>
                                            <source srcset="public/wallets/metamask.avif" type="image/avif">
                                            <source srcset="public/wallets/metamask.webp" type="image/webp">
                                            <img src="public/wallets/metamask.png" alt="MetaMask">
                                        </picture>
                                        <span>MetaMask</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        
        // Set up wallet modal after mount
        this.setTimeout(() => {
            this.setupWalletModal();
        }, 0);
    }

    setupWalletModal() {
        // Only set up if wallet is not connected
        if (this.state.walletConnected) {
            return;
        }

        // Wait for DOM to be ready
        this.setTimeout(() => {
            const modal = document.getElementById('walletModal');
            const selectButton = document.getElementById('selectWallet');
            
            if (!modal || !selectButton) {
                console.error('Wallet modal or select button not found');
                return;
            }

            // Create WalletModal instance
            if (!this.walletModal) {
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
                    metamask: '/public/wallets/metamask.webp'
                };

                // Create WalletModal with callback
                this.walletModal = new WalletModal(
                    providerMap,
                    walletIcons,
                    async (walletType) => {
                        await this.handleWalletSelection(walletType);
                    }
                );
            }

            // Set up select button click handler
            // Clone button to remove any existing handlers
            const newButton = selectButton.cloneNode(true);
            selectButton.parentNode.replaceChild(newButton, selectButton);
            
            newButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('SELECT WALLET button clicked');
                
                if (this.walletModal) {
                    console.log('Calling walletModal.show()');
                    this.walletModal.show();
                    
                    // Double-check modal is visible
                    const modalEl = document.getElementById('walletModal');
                    if (modalEl) {
                        console.log('Modal element found, checking visibility');
                        console.log('Modal classes:', modalEl.className);
                        console.log('Modal display:', window.getComputedStyle(modalEl).display);
                        modalEl.style.display = 'flex';
                        modalEl.classList.add('active');
                    } else {
                        console.error('Modal element not found after show()');
                    }
                } else {
                    console.error('WalletModal not initialized');
                }
            });
        }, 100);
    }

    async handleWalletSelection(walletType) {
        try {
            // Select the wallet
            await walletService.selectWallet(walletType);
            
            // Connect to the wallet
            await walletService.connect();
            
            // Wallet is now connected
            this.setState({ walletConnected: true });
            
            if (this.onConnected) {
                this.onConnected();
            }
        } catch (error) {
            console.error('Error connecting wallet:', error);
            // Show error - could use MessagePopup here
        }
    }

    onStateUpdate(oldState, newState) {
        // When wallet connects, hide splash
        if (!oldState.walletConnected && newState.walletConnected) {
            // Hide the splash screen
            if (this.element) {
                this.element.style.display = 'none';
            }
            
            // Hide modal if open
            if (this.walletModal) {
                this.walletModal.hide();
            }
        }
        
        // When wallet disconnects, show splash again
        if (oldState.walletConnected && !newState.walletConnected) {
            // Show the splash screen
            if (this.element) {
                this.element.style.display = 'flex';
            }
            
            this.setTimeout(() => {
                this.setupWalletModal();
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
}

