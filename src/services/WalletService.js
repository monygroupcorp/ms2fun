import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { eventBus } from '../core/EventBus.js';

/**
 * WalletService - Handles wallet connection, detection, and interactions
 */
class WalletService {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.connectedAddress = null;
        this.selectedWallet = null;
        this.connected = false;
        this.ethers = ethers;
        this.isInitialized = false;
        
        // Supported wallet providers - using a more careful detection approach
        this.providerMap = {
            rabby: () => {
                if (window.ethereum && window.ethereum.isRabby) {
                    return window.ethereum;
                }
                return null;
            },
            rainbow: () => {
                if (window.ethereum && window.ethereum.isRainbow) {
                    return window.ethereum;
                }
                return window.rainbow || null;
            },
            phantom: () => {
                if (window.phantom && window.phantom.ethereum) {
                    return window.phantom.ethereum;
                }
                return null;
            },
            metamask: () => {
                // Simplified approach - just use window.ethereum directly
                console.log('Checking for MetaMask with direct window.ethereum access');
                return window.ethereum || null;
            }
        };
        
        // Wallet icons mapping
        this.walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/metamask.webp',
        };
        
        // We'll set up event listeners after a wallet is selected, not in constructor
    }
    
    /**
     * Initialize the wallet service - just check for wallet presence
     */
    async initialize() {
        try {
            console.log('Initializing WalletService...');
            
            // Check if window.ethereum exists
            if (typeof window.ethereum !== 'undefined') {
                // Log that we found a wallet provider
                console.log('Found Ethereum provider');
                
                // Let other components know a wallet was detected
                eventBus.emit('wallet:detected');
                
                // Check if the provider is in MetaMask compatibility mode
                this.isMetaMask = window.ethereum.isMetaMask;
                
                // Set up event listeners for wallet changes
                this.setupEventListeners();
            } else {
                console.log('No Ethereum provider found');
                eventBus.emit('wallet:notdetected');
            }
            
            // Mark as initialized
            this.isInitialized = true;
            
            return true;
        } catch (error) {
            console.error('Error initializing WalletService:', error);
            throw error;
        }
    }
    
    /**
     * Format error to provide better context
     * @private
     */
    formatError(error, context = '') {
        // If error is a string, convert to Error object
        if (typeof error === 'string') {
            return new Error(`${context}: ${error}`);
        }
        
        // If error has a message, add context
        if (error && error.message) {
            // Common wallet errors, make more user-friendly
            const message = this.getUserFriendlyErrorMessage(error, context);
            const formattedError = new Error(message);
            
            // Copy properties
            formattedError.code = error.code;
            formattedError.originalError = error;
            
            return formattedError;
        }
        
        // Default case
        return new Error(`${context}: Unknown error`);
    }
    
    /**
     * Convert technical errors to user-friendly messages
     * @private
     */
    getUserFriendlyErrorMessage(error, context) {
        const message = error.message || 'Unknown error';
        
        // Handle common wallet error codes
        if (error.code === 4001) {
            return 'Connection request rejected by user';
        }
        
        if (error.code === 4902) {
            return 'Network needs to be added to your wallet';
        }
        
        if (message.includes('redefine property') || message.includes('which has only a getter')) {
            return 'Wallet conflict detected. Please disable all wallet extensions except the one you want to use, then refresh.';
        }
        
        if (message.includes('user rejected')) {
            return 'Connection rejected by user';
        }
        
        if (message.includes('already pending')) {
            return 'A wallet request is already pending, please check your wallet';
        }
        
        // If no specific handling, add context
        return context ? `${context}: ${message}` : message;
    }
    
    /**
     * Get all available wallet providers
     * @returns {Object} Map of wallet providers
     */
    getAvailableWallets() {
        const available = {};
        
        console.log('Checking for available wallets...');
        
        // First check if window.ethereum exists at all
        if (window.ethereum) {
            console.log('window.ethereum is available');
        } else {
            console.log('window.ethereum is not available');
        }
        
        for (const [name, getProvider] of Object.entries(this.providerMap)) {
            try {
                console.log(`Checking for ${name} wallet...`);
                const provider = getProvider();
                if (provider) {
                    console.log(`Found ${name} wallet`);
                    available[name] = {
                        name,
                        icon: this.walletIcons[name],
                        provider: provider
                    };
                } else {
                    console.log(`${name} wallet not detected`);
                }
            } catch (error) {
                console.warn(`Error detecting ${name} wallet:`, error);
            }
        }
        
        // If no specific wallets detected but ethereum provider exists,
        // add metamask as a fallback option
        if (Object.keys(available).length === 0 && window.ethereum) {
            console.log('No specific wallets detected, but window.ethereum exists. Adding MetaMask as fallback.');
            available['metamask'] = {
                name: 'metamask',
                icon: this.walletIcons['metamask'],
                provider: window.ethereum
            };
        } else if (!available['metamask'] && window.ethereum) {
            // Always add MetaMask if ethereum is available and not already added
            console.log('window.ethereum exists. Adding MetaMask option regardless of detection.');
            available['metamask'] = {
                name: 'metamask',
                icon: this.walletIcons['metamask'],
                provider: window.ethereum
            };
        }
        
        console.log('Available wallets:', Object.keys(available));
        return available;
    }
    
    /**
     * Select a specific wallet provider
     * @param {string} walletType - The type of wallet to select
     */
    async selectWallet(walletType) {
        try {
            // Clear any previous wallet selection
            this.cleanup();
            
            if (!this.providerMap[walletType]) {
                throw new Error(`Unsupported wallet: ${walletType}`);
            }
            
            const provider = this.providerMap[walletType]();
            
            if (!provider) {
                throw new Error(`${walletType} not detected. Please install it first.`);
            }
            
            this.selectedWallet = walletType;
            this.provider = provider;
            
            // Set up event listeners now that we have a provider
            this.setupEventListeners();
            
            eventBus.emit('wallet:selected', { 
                type: walletType,
                provider: provider
            });
            
            return walletType;
        } catch (error) {
            const formattedError = this.formatError(error, 'Wallet selection failed');
            eventBus.emit('wallet:error', formattedError);
            throw formattedError;
        }
    }
    
    /**
     * Set up event listeners for the selected wallet
     * @private
     */
    setupEventListeners() {
        if (this.provider) {
            // Remove any existing listeners to avoid duplicates
            try {
                this.provider.removeListener('chainChanged', this.handleNetworkChange);
                this.provider.removeListener('accountsChanged', this.handleAccountChange);
            } catch (error) {
                // Ignore errors when removing non-existent listeners
            }
            
            // Add new listeners
            this.provider.on('chainChanged', () => this.handleNetworkChange());
            this.provider.on('accountsChanged', (accounts) => this.handleAccountChange(accounts));
        }
    }
    
    /**
     * Clean up resources when switching wallets
     * @private
     */
    cleanup() {
        if (this.provider) {
            try {
                this.provider.removeListener('chainChanged', this.handleNetworkChange);
                this.provider.removeListener('accountsChanged', this.handleAccountChange);
            } catch (error) {
                // Ignore errors when removing non-existent listeners
            }
        }
        
        this.provider = null;
        this.signer = null;
        this.connectedAddress = null;
        this.connected = false;
        this.ethersProvider = null;
    }
    
    /**
     * Connect to the selected wallet
     * @returns {string} The connected address
     */
    async connect() {
        try {
            if (!this.selectedWallet || !this.provider) {
                throw new Error('Please select a wallet first');
            }
            
            eventBus.emit('wallet:connecting');
            console.log(`Attempting to connect to ${this.selectedWallet}...`);
            
            let accounts;
            
            try {
                // Give the wallet time to initialize if needed
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Handle wallet-specific connection methods
                if (this.selectedWallet === 'phantom' && window.phantom && window.phantom.ethereum) {
                    console.log('Using phantom-specific connection method');
                    accounts = await window.phantom.ethereum.request({
                        method: 'eth_requestAccounts'
                    });
                } else {
                    console.log(`Using standard connection method for ${this.selectedWallet}`);
                    // Try to check if the wallet has any accounts before requesting new ones
                    try {
                        const existingAccounts = await this.provider.request({
                            method: 'eth_accounts'
                        });
                        
                        console.log('Existing accounts:', existingAccounts);
                        
                        // If no accounts, explicitly check before requesting
                        if (!existingAccounts || existingAccounts.length === 0) {
                            console.log('No existing accounts found, requesting user approval...');
                        }
                    } catch (accountCheckError) {
                        console.warn('Error checking existing accounts:', accountCheckError);
                    }
                    
                    // Request accounts with explicit params
                    accounts = await this.provider.request({
                        method: 'eth_requestAccounts',
                        params: []
                    });
                }
            } catch (error) {
                console.error('Error requesting accounts:', error);
                
                if (error && error.code === 4001) {
                    throw this.formatError(error, 'Wallet connection rejected');
                } else if (error && error.message && error.message.includes('wallet must has at least one account')) {
                    throw new Error('Your wallet has no accounts. Please create at least one account in your wallet and try again.');
                } else {
                    throw error;
                }
            }
            
            console.log('Accounts received:', accounts);
            
            if (!accounts || !accounts[0]) {
                throw new Error('No accounts found. Please unlock your wallet and make sure you have at least one account set up.');
            }
            
            this.connectedAddress = accounts[0];
            this.connected = true;
            
            console.log(`Successfully connected to account: ${this.connectedAddress}`);
            
            // Create ethers provider
            this.ethersProvider = new ethers.providers.Web3Provider(this.provider, 'any');
            this.signer = this.ethersProvider.getSigner();
            
            eventBus.emit('wallet:connected', {
                address: this.connectedAddress,
                walletType: this.selectedWallet,
                provider: this.provider,
                ethersProvider: this.ethersProvider,
                signer: this.signer
            });
            
            return this.connectedAddress;
        } catch (error) {
            console.error('Wallet connection error:', error);
            
            // Better handle the specific "must have at least one account" error
            if (error.message && (
                error.message.includes('at least one account') || 
                error.message.includes('wallet must has') ||
                error.message.includes('no accounts')
            )) {
                const friendlyMessage = 'Your wallet has no accounts. Please create at least one account in your wallet and try again.';
                const formattedError = new Error(friendlyMessage);
                formattedError.code = error.code;
                formattedError.originalError = error;
                
                eventBus.emit('wallet:error', formattedError);
                throw formattedError;
            }
            
            const formattedError = this.formatError(error, 'Wallet connection failed');
            eventBus.emit('wallet:error', formattedError);
            throw formattedError;
        }
    }
    
    /**
     * Switch to a specific network
     * @param {number} networkId - The network ID to switch to
     */
    async switchNetwork(networkId) {
        try {
            if (!this.provider) {
                throw new Error('No wallet connected');
            }
            
            const hexChainId = `0x${Number(networkId).toString(16)}`;
            
            eventBus.emit('network:switching', {
                to: networkId,
                automatic: false
            });
            
            try {
                await this.provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: hexChainId }],
                });
                
                // Refresh provider after switch
                this.ethersProvider = new ethers.providers.Web3Provider(this.provider, 'any');
                this.signer = this.ethersProvider.getSigner();
                
                eventBus.emit('network:switched', {
                    to: networkId,
                    success: true
                });
                
                return true;
            } catch (switchError) {
                // Network needs to be added
                if (switchError.code === 4902) {
                    // You would need network metadata here to add properly
                    throw new Error('Network needs to be added first');
                } else {
                    throw switchError;
                }
            }
        } catch (error) {
            const formattedError = this.formatError(error, 'Network switch failed');
            
            // Emit error event for consistency with BlockchainService
            eventBus.emit('network:switch:error', {
                from: null,
                to: networkId,
                error: formattedError.message,
                originalError: error
            });
            
            // Also emit switched event with success: false for backward compatibility
            eventBus.emit('network:switched', {
                to: networkId,
                success: false,
                error: formattedError.message
            });
            
            throw formattedError;
        }
    }
    
    /**
     * Get the currently connected address
     * @returns {string|null} The connected address or null
     */
    getAddress() {
        return this.connectedAddress;
    }
    
    /**
     * Check if a wallet is connected
     * @returns {boolean} Whether a wallet is connected
     */
    isConnected() {
        return this.connected && !!this.connectedAddress;
    }
    
    /**
     * Get the ethers provider and signer
     * @returns {Object} The provider and signer
     */
    getProviderAndSigner() {
        return {
            provider: this.ethersProvider,
            signer: this.signer
        };
    }
    
    /**
     * Handle network changes
     * @private
     */
    handleNetworkChange() {
        // Refresh provider
        if (this.provider) {
            this.ethersProvider = new ethers.providers.Web3Provider(this.provider, 'any');
            this.signer = this.ethersProvider.getSigner();
            
            // Don't emit network:changed here - BlockchainService handles it
            // This prevents duplicate messages when both services detect the change
        }
    }
    
    /**
     * Handle account changes
     * @private
     */
    handleAccountChange(accounts) {
        if (!accounts || !Array.isArray(accounts)) {
            return;
        }
        
        if (accounts.length === 0) {
            // Disconnected
            this.connected = false;
            this.connectedAddress = null;
            eventBus.emit('wallet:disconnected');
        } else if (accounts[0] !== this.connectedAddress) {
            // Changed account
            this.connectedAddress = accounts[0];
            eventBus.emit('wallet:changed', { address: accounts[0] });
        }
    }
    
    /**
     * Disconnect from the wallet (if supported)
     */
    async disconnect() {
        // Most wallets don't support programmatic disconnect
        // But we can reset our state
        this.cleanup();
        eventBus.emit('wallet:disconnected');
    }
}

// Create a singleton instance
const walletService = new WalletService();
export default walletService; 