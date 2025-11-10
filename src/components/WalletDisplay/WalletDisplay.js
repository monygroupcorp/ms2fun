import { Component } from '../../core/Component.js';
import walletService from '../../services/WalletService.js';
import { eventBus } from '../../core/EventBus.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

export class WalletDisplay extends Component {
    constructor() {
        super();
        this.state = {
            address: null,
            balance: '0.00',
            loading: true
        };
    }

    async onMount() {
        await this.loadWalletInfo();
        this.setupSubscriptions();
    }

    async loadWalletInfo() {
        console.log('[WalletDisplay] loadWalletInfo() called');
        
        // Ensure wallet service is initialized
        if (!walletService.isInitialized) {
            await walletService.initialize();
        }
        
        // First check if wallet service thinks it's connected
        let isConnected = walletService.isConnected();
        let address = walletService.getAddress();
        console.log('[WalletDisplay] Initial state - isConnected:', isConnected, 'address:', address);
        
        // If not connected, check for existing accounts (for direct page loads)
        // This handles the case where the page loads before wallet service has checked
        if (!isConnected && typeof window.ethereum !== 'undefined') {
            try {
                // Use eth_accounts which doesn't prompt - just checks existing connections
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    // We have accounts - try to get wallet service to recognize them
                    const lastWallet = localStorage.getItem('ms2fun_lastWallet');
                    
                    if (lastWallet) {
                        // Try to select and connect the last wallet
                        try {
                            await walletService.selectWallet(lastWallet);
                            
                            // Always try to connect - if accounts exist, this should work without prompting
                            try {
                                console.log('[WalletDisplay] Attempting to connect wallet service...');
                                await walletService.connect();
                                address = walletService.getAddress();
                                isConnected = walletService.isConnected();
                                console.log('[WalletDisplay] After connect() - isConnected:', isConnected, 'address:', address);
                                
                                // Double-check - sometimes connect() succeeds but state isn't updated immediately
                                if (!isConnected || !address) {
                                    // Wait a moment and check again
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                    address = walletService.getAddress();
                                    isConnected = walletService.isConnected();
                                    console.log('[WalletDisplay] After wait - isConnected:', isConnected, 'address:', address);
                                }
                                
                                // If still not connected, use accounts directly
                                if (!isConnected || !address) {
                                    console.log('[WalletDisplay] WalletService connect() did not update state, using accounts directly');
                                    address = accounts[0];
                                    isConnected = true;
                                }
                            } catch (connectError) {
                                // Connection failed - might need approval or other issue
                                console.log('[WalletDisplay] connect() error:', connectError);
                                // Check if error is just a rejection (user declined)
                                if (connectError.code === 4001 || connectError.message?.includes('rejected')) {
                                    // User rejected - that's fine, don't show wallet info
                                    console.log('[WalletDisplay] Wallet connection rejected by user');
                                    this.setState({ loading: false });
                                    return;
                                }
                                // Other error - use accounts directly
                                console.log('[WalletDisplay] Auto-connect failed, using accounts directly:', connectError.message);
                                address = accounts[0];
                                isConnected = true;
                            }
                        } catch (error) {
                            // Can't select wallet - that's fine, use accounts directly
                            console.log('Could not select last wallet:', error);
                            address = accounts[0];
                            isConnected = true;
                        }
                    } else {
                        // No last wallet stored, but we have accounts
                        // Try to detect wallet type and connect
                        const detectedWallet = this.detectWalletType();
                        if (detectedWallet) {
                            try {
                                await walletService.selectWallet(detectedWallet);
                                await walletService.connect();
                                address = walletService.getAddress();
                                isConnected = walletService.isConnected();
                                
                                if (!isConnected || !address) {
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                    address = walletService.getAddress();
                                    isConnected = walletService.isConnected();
                                }
                                
                                if (!isConnected || !address) {
                                    address = accounts[0];
                                    isConnected = true;
                                }
                            } catch (error) {
                                // Fallback to using accounts directly
                                if (error.code === 4001 || error.message?.includes('rejected')) {
                                    this.setState({ loading: false });
                                    return;
                                }
                                address = accounts[0];
                                isConnected = true;
                            }
                        } else {
                            address = accounts[0];
                            isConnected = true;
                        }
                    }
                }
            } catch (error) {
                // Can't check accounts - that's fine
                console.log('Could not check existing accounts:', error);
            }
        }
        
        console.log('[WalletDisplay] Final check - isConnected:', isConnected, 'address:', address);
        
        if (!isConnected || !address) {
            console.log('[WalletDisplay] No connection or address, hiding wallet display');
            this.setState({ loading: false });
            return;
        }
        
        console.log('[WalletDisplay] Proceeding to load balance for address:', address);

        try {
            // Get ETH balance - try wallet service provider first, then fallback
            let provider = walletService.ethersProvider;
            if (!provider && typeof window.ethereum !== 'undefined') {
                // Create a provider if wallet service doesn't have one yet
                provider = new ethers.providers.Web3Provider(window.ethereum);
            }
            
            if (provider && address) {
                const balance = await provider.getBalance(address);
                const balanceEth = parseFloat(ethers.utils.formatEther(balance)).toFixed(4);
                this.setState({
                    address,
                    balance: balanceEth,
                    loading: false
                });
            } else {
                this.setState({ address, loading: false });
            }
        } catch (error) {
            console.error('Failed to load wallet info:', error);
            this.setState({ address, loading: false });
        }
    }

    setupSubscriptions() {
        this.eventUnsubscribers = [];
        
        this.eventUnsubscribers.push(
            eventBus.on('wallet:connected', () => {
                this.loadWalletInfo();
            })
        );

        this.eventUnsubscribers.push(
            eventBus.on('wallet:disconnected', () => {
                this.setState({ address: null, balance: '0.00' });
            })
        );

        this.eventUnsubscribers.push(
            eventBus.on('wallet:changed', () => {
                this.loadWalletInfo();
            })
        );
    }

    async handleDisconnect() {
        try {
            await walletService.disconnect();
            // Navigate to home page
            if (window.router) {
                window.router.navigate('/');
            } else {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Failed to disconnect:', error);
        }
    }

    render() {
        if (this.state.loading) {
            return '<div class="wallet-display loading">Loading wallet info...</div>';
        }

        if (!this.state.address) {
            return ''; // Don't show if not connected
        }

        const truncatedAddress = `${this.state.address.slice(0, 6)}...${this.state.address.slice(-4)}`;

        return `
            <div class="wallet-display">
                <div class="wallet-info">
                    <span class="wallet-label">Connected:</span>
                    <span class="wallet-address">${this.escapeHtml(truncatedAddress)}</span>
                    <span class="wallet-balance">${this.state.balance} ETH</span>
                </div>
                <button class="disconnect-button" data-ref="disconnect-btn">
                    Disconnect
                </button>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        const disconnectBtn = this.getRef('disconnect-btn', '.disconnect-button');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                this.handleDisconnect();
            });
        }
    }

    unmount() {
        // Clean up event listeners
        if (this.eventUnsubscribers) {
            this.eventUnsubscribers.forEach(unsub => unsub());
        }
        super.unmount();
    }

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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

