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
            checking: true,
            walletAvailable: false, // Whether window.ethereum exists
            loadingLightNode: false // Whether light node is being loaded
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
            // Check if web3 wallet is available (window.ethereum exists)
            const walletAvailable = typeof window.ethereum !== 'undefined';
            
            // Initialize wallet service if needed
            if (!walletService.isInitialized) {
                await walletService.initialize();
            }
            
            // Check if wallet service thinks it's connected
            let isConnected = walletService.isConnected();
            
            // If not connected, try to auto-reconnect to the last used wallet
            // This allows auto-reconnect on refresh without annoying prompts
            if (!isConnected && typeof window.ethereum !== 'undefined') {
                try {
                    // Get the last used wallet from localStorage
                    const lastWallet = localStorage.getItem('ms2fun_lastWallet');
                    
                    if (lastWallet) {
                        // Check if that wallet has accounts (without prompting)
                        let hasAccounts = false;
                        try {
                            // Get the provider for the last wallet
                            const providerMap = {
                                rabby: () => window.ethereum?.isRabby ? window.ethereum : null,
                                rainbow: () => window.ethereum?.isRainbow ? window.ethereum : null,
                                phantom: () => window.phantom?.ethereum || null,
                                metamask: () => window.ethereum || null
                            };
                            
                            const getProvider = providerMap[lastWallet];
                            if (getProvider) {
                                const provider = getProvider();
                                if (provider) {
                                    const accounts = await provider.request({ method: 'eth_accounts' });
                                    hasAccounts = accounts && accounts.length > 0;
                                }
                            }
                        } catch (error) {
                            // Can't check - that's fine
                            console.log('Could not check accounts for last wallet:', error);
                        }
                        
                        // Only try to reconnect if the last wallet has accounts
                        if (hasAccounts) {
                            try {
                                // Select the last used wallet (doesn't prompt)
                                await walletService.selectWallet(lastWallet);
                                // Try to connect (this will use existing connection if available)
                                // If it needs approval, it will fail gracefully and user can click button
                                await walletService.connect();
                                isConnected = walletService.isConnected();
                                if (isConnected) {
                                    console.log('Auto-reconnected to', lastWallet);
                                }
                            } catch (connectError) {
                                // Connection failed (user needs to approve) - that's fine
                                // Don't log as error, just continue to show wallet selection
                                console.log('Auto-reconnect not possible, user will need to select wallet');
                            }
                        }
                    }
                } catch (accountsError) {
                    // Can't check accounts - that's fine, show wallet selection
                    console.log('Could not check existing accounts:', accountsError);
                }
            }
            
            this.setState({
                walletConnected: isConnected,
                checking: false,
                walletAvailable: walletAvailable
            });

            // If already connected, call onConnected callback
            if (isConnected && this.onConnected) {
                this.onConnected();
            } else {
                // If not connected, ensure wallet modal is set up
                // Use setTimeout to ensure state update has processed
                this.setTimeout(() => {
                    this.setupWalletModal();
                }, 100);
            }
        } catch (error) {
            console.error('Error checking wallet connection:', error);
            // Check wallet availability even on error
            const walletAvailable = typeof window.ethereum !== 'undefined';
            this.setState({
                walletConnected: false,
                checking: false,
                walletAvailable: walletAvailable
            });
            // Ensure wallet modal is set up even on error
            this.setTimeout(() => {
                this.setupWalletModal();
            }, 100);
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
                    <div class="splash-content marble-bg">
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
        const walletAvailable = this.state.walletAvailable;
        const loadingLightNode = this.state.loadingLightNode;
        
        return `
            <div class="wallet-splash">
                <div class="splash-content marble-bg">
                    <div class="splash-header">
                        <h1>Connect Your Wallet</h1>
                        <p class="splash-subtitle">Connect your wallet to access the MS2.FUN launchpad</p>
                    </div>
                    
                    <div class="splash-description">
                        <p>This application requires a connected wallet to access on-chain data and interact with projects.</p>
                        ${walletAvailable 
                            ? '<p>You can connect your wallet or continue using your wallet\'s RPC for read-only access.</p>' 
                            : '<p>No wallet detected. You can continue with read-only mode using a light node.</p>'}
                    </div>
                    
                    <div class="wallet-connector-container" data-ref="wallet-connector">
                        <div class="contract-status">
                            <div id="contractStatus" class="status-message">${loadingLightNode ? 'DOWNLOADING LIGHT NODE...' : 'INITIALIZING SYSTEM...'}</div>
                            
                            <div id="selectedWalletDisplay" class="selected-wallet-display" style="display: none;">
                                <img id="selectedWalletIcon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E" alt="Selected Wallet">
                                <span class="wallet-name" id="selectedWalletName"></span>
                            </div>
                            <div id="continuePrompt" class="continue-prompt" style="display: none;">
                                CONTINUE IN YOUR WALLET
                            </div>
                            
                            <button id="selectWallet" class="connect-button" ${!walletAvailable ? 'disabled' : ''} style="${!walletAvailable ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                                <span class="button-text">SELECT WALLET</span>
                            </button>
                            
                            <button id="continueButton" class="connect-button" style="margin-top: 1rem; ${loadingLightNode ? 'opacity: 0.7; cursor: wait;' : ''}">
                                <span class="button-text">${loadingLightNode ? 'LOADING...' : 'CONTINUE'}</span>
                            </button>
                            
                            ${!walletAvailable ? `
                                <p class="light-node-explainer" style="margin-top: 1rem; font-size: 0.875rem; color: rgba(255, 255, 255, 0.7); text-align: center; max-width: 400px; margin-left: auto; margin-right: auto;">
                                    This will download and run a light node to enable read-only blockchain access without a wallet.
                                </p>
                            ` : ''}
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
                                            <source srcset="/public/wallets/MetaMask.avif" type="image/avif">
                                            <source srcset="/public/wallets/MetaMask.webp" type="image/webp">
                                            <img src="/public/wallets/MetaMask.webp" alt="MetaMask" onerror="this.src='/public/wallets/MetaMask.webp'">
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

        // Prevent infinite retry loops
        if (!this._setupRetryCount) {
            this._setupRetryCount = 0;
        }
        if (this._setupRetryCount > 10) {
            console.error('Wallet modal setup failed after 10 retries - giving up');
            return;
        }
        this._setupRetryCount++;

        // Wait for DOM to be ready
        this.setTimeout(() => {
            const modal = document.getElementById('walletModal');
            const selectButton = document.getElementById('selectWallet');
            
            if (!modal || !selectButton) {
                console.error('Wallet modal or select button not found, retry', this._setupRetryCount);
                // Retry after a short delay if elements aren't ready yet
                if (this.mounted && this._setupRetryCount <= 10) {
                    this.setTimeout(() => {
                        this.setupWalletModal();
                    }, 200);
                }
                return;
            }
            
            // Reset retry count on success
            this._setupRetryCount = 0;

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
                    metamask: '/public/wallets/MetaMask.webp'
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
                
                // Don't do anything if wallet is not available
                if (!this.state.walletAvailable) {
                    return;
                }
                
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
            
            // Set up continue button click handler
            const continueButton = document.getElementById('continueButton');
            if (continueButton) {
                const newContinueButton = continueButton.cloneNode(true);
                continueButton.parentNode.replaceChild(newContinueButton, continueButton);
                
                newContinueButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // If wallet is available (detected), just continue
                    // The site can use window.ethereum for RPC reads even if not connected
                    if (this.state.walletAvailable) {
                        if (this.onConnected) {
                            this.onConnected();
                        }
                        return;
                    }
                    
                    // If no wallet available, load light node
                    if (!this.state.walletAvailable) {
                        await this.handleContinueWithoutWallet();
                    }
                });
            }
            
            // Set up close button handler
            const closeButton = modal.querySelector('.wallet-modal-close');
            if (closeButton) {
                // Remove any existing listeners by cloning
                const newCloseButton = closeButton.cloneNode(true);
                closeButton.parentNode.replaceChild(newCloseButton, closeButton);
                
                newCloseButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this.walletModal) {
                        this.walletModal.hide();
                    } else {
                        // Fallback if walletModal not initialized
                        const modalEl = document.getElementById('walletModal');
                        if (modalEl) {
                            modalEl.classList.remove('active');
                            modalEl.style.display = 'none';
                        }
                    }
                });
            }
            
            // Set up click outside to close
            // WalletModal already has this, but we'll ensure it works
            // Don't clone modal as it breaks WalletModal's reference
            const handleModalClick = (e) => {
                if (e.target === modal) {
                    if (this.walletModal) {
                        this.walletModal.hide();
                    } else {
                        modal.classList.remove('active');
                        modal.style.display = 'none';
                    }
                }
            };
            
            // Remove existing listener if any, then add new one
            modal.removeEventListener('click', handleModalClick);
            modal.addEventListener('click', handleModalClick);
        }, 100);
    }

    async handleWalletSelection(walletType) {
        try {
            // Select the wallet
            await walletService.selectWallet(walletType);
            
            // Store the selected wallet in localStorage for future auto-reconnect
            localStorage.setItem('ms2fun_lastWallet', walletType);
            
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
    
    /**
     * Handle continue button click when no wallet is available
     * Lazy-loads the light node and initializes read-only mode
     */
    async handleContinueWithoutWallet() {
        if (this.state.loadingLightNode) {
            return; // Already loading
        }
        
        this.setState({ loadingLightNode: true });
        
        try {
            console.log('[WalletSplash] Loading light node for read-only mode...');
            
            // Dynamically import and initialize read-only mode
            const { initializeReadOnlyMode } = await import('../../index.js');
            const success = await initializeReadOnlyMode();
            
            if (success) {
                console.log('[WalletSplash] Light node loaded successfully');
                // Continue to app (read-only mode)
                if (this.onConnected) {
                    this.onConnected();
                }
            } else {
                console.error('[WalletSplash] Failed to load light node');
                // Show error message
                const statusEl = document.getElementById('contractStatus');
                if (statusEl) {
                    statusEl.textContent = 'FAILED TO LOAD LIGHT NODE. PLEASE TRY AGAIN.';
                }
                this.setState({ loadingLightNode: false });
            }
        } catch (error) {
            console.error('[WalletSplash] Error loading light node:', error);
            const statusEl = document.getElementById('contractStatus');
            if (statusEl) {
                statusEl.textContent = 'ERROR: ' + error.message;
            }
            this.setState({ loadingLightNode: false });
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

