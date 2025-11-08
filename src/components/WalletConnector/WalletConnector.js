import walletService from '../../services/WalletService.js';
import { eventBus } from '../../core/EventBus.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

/**
 * WalletConnector - UI component for handling wallet connections
 */
class WalletConnector {
    constructor(elementIdOrElement) {
        // Allow passing either an ID or the element itself
        if (typeof elementIdOrElement === 'string') {
            // If an ID was passed
            this.container = document.getElementById(elementIdOrElement);
            if (!this.container) {
                console.error(`Element with ID '${elementIdOrElement}' not found`);
                // Create a fallback container
                this.container = document.createElement('div');
                this.container.id = 'walletConnector-fallback';
                document.body.appendChild(this.container);
            }
        } else if (elementIdOrElement instanceof HTMLElement) {
            // If an element was passed directly
            this.container = elementIdOrElement;
        } else {
            // Fallback to creating a new element
            console.error('Invalid element or ID provided to WalletConnector');
            this.container = document.createElement('div');
            this.container.id = 'walletConnector-fallback';
            document.body.appendChild(this.container);
        }
        
        // Ensure the container has an ID for event binding
        if (!this.container.id) {
            this.container.id = 'walletConnector-' + Math.random().toString(36).substr(2, 9);
        }
        
        this.walletModalId = 'walletModal-' + Math.random().toString(36).substr(2, 9);
        this.messagePopup = new MessagePopup();
        
        // Store unsubscribe functions for event listeners
        this.eventUnsubscribers = [];
        
        // Status messages for UI
        this.statusMessages = {
            INITIALIZING: 'INITIALIZING SYSTEM...',
            WALLET_DETECTED: 'WALLET DETECTED. CLICK CONNECT TO PROCEED.',
            CONNECTING: 'REQUESTING SECURE CONNECTION...',
            CONNECTED: 'CONNECTION ESTABLISHED',
            ERROR: 'ERROR: ',
            SELECT_WALLET: 'SELECT YOUR WALLET',
            WALLET_SELECTED: 'WALLET SELECTED: ',
            SIGN_REQUIRED: 'SIGNATURE REQUIRED TO PROCEED',
            SIGN_PENDING: 'AWAITING SIGNATURE...',
            VERIFIED: 'VERIFICATION COMPLETE'
        };
        
        // Bind and store the unhandled rejection handler for cleanup
        this.boundUnhandledRejectionHandler = this.handleUnhandledRejection.bind(this);
        window.addEventListener('unhandledrejection', this.boundUnhandledRejectionHandler);
        
        // Initialize UI and event listeners
        this.initializeUI();
        this.setupEventListeners();
    }
    
    /**
     * Handle unhandled promise rejections
     * @param {PromiseRejectionEvent} event - The rejection event
     */
    handleUnhandledRejection(event) {
        // Check if this is a wallet error we can handle
        const error = event.reason;
        
        if (error && typeof error === 'object') {
            console.warn('Caught unhandled rejection:', error);
            
            // Check for the specific "wallet must has at least one account" error
            if (error.message && error.message.includes('wallet must has at least one account')) {
                console.error('Caught specific error: wallet must has at least one account');
                
                // Show a helpful message to the user
                this.messagePopup.warning(
                    'Your wallet has no accounts. Please create at least one account in your wallet and try again.',
                    'No Accounts Detected'
                );
                
                // Prevent the error from showing in console
                event.preventDefault();
                
                // Show both wallet buttons again
                const selectWalletBtn = document.getElementById('selectWallet');
                if (selectWalletBtn) {
                    selectWalletBtn.style.display = 'block';
                }
                
                const connectWalletBtn = document.getElementById('connectWalletBtn');
                if (connectWalletBtn) {
                    connectWalletBtn.style.display = 'block';
                }
                
                // Hide wallet display
                const selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
                if (selectedWalletDisplay) {
                    selectedWalletDisplay.style.display = 'none';
                }
                
                // Hide continue prompt
                const continuePrompt = document.getElementById('continuePrompt');
                if (continuePrompt) {
                    continuePrompt.style.display = 'none';
                }
                
                // Update status
                this.updateStatus('Error: Your wallet has no accounts. Create one in MetaMask and try again.', true);
            }
        }
    }
    
    /**
     * Initialize the UI elements
     */
    initializeUI() {
        console.log('Initializing wallet connector UI');
        
        // We won't clear existing content this time
        // this.container.innerHTML = '';

        // Find the existing select wallet button
        const selectWalletBtn = document.getElementById('selectWallet');

        // Only create a new button if we can't find the existing one
        if (!selectWalletBtn) {
            console.log('Creating new wallet button (existing one not found)');
            
            // Create wallet button
            const walletBtn = document.createElement('button');
            walletBtn.id = 'connectWalletBtn';
            walletBtn.className = 'connect-button';
            walletBtn.innerHTML = '<span class="button-text">SELECT WALLET</span>';
            walletBtn.title = 'Connect to your Web3 wallet';
            this.container.appendChild(walletBtn);
        } else {
            console.log('Using existing wallet button');
            // Make sure it's visible
            selectWalletBtn.style.display = 'block';
        }
        
        // Find the existing contract status
        const contractStatus = document.getElementById('contractStatus');
        
        // Only create a status container if there isn't one already
        if (!contractStatus) {
            console.log('Creating new status container (existing one not found)');
            
            // Create status message container
            const statusContainer = document.createElement('div');
            statusContainer.id = 'walletStatus';
            statusContainer.className = 'status-message';
            statusContainer.textContent = 'Choose your wallet to connect';
            this.container.appendChild(statusContainer);
        } else {
            console.log('Using existing status container');
            contractStatus.textContent = 'SYSTEM INITIALIZED. SELECT WALLET TO CONNECT.';
        }
        
        // Get or create the wallet modal
        this.setupWalletModal();
    }
    
    /**
     * Set up the wallet selection modal
     */
    setupWalletModal() {
        console.log('Setting up wallet modal');
        
        // Check for existing modal
        const existingModal = document.getElementById('walletModal');
        
        if (existingModal) {
            console.log('Using existing wallet modal');
            // Use the existing modal
            this.walletModalId = 'walletModal';
            
            // Make sure it has the right display style
            existingModal.style.display = 'none';
        } else {
            console.log('Creating new wallet modal');
            // Create a new modal
            this.createWalletModal();
        }
    }
    
    /**
     * Create the wallet selection modal
     */
    createWalletModal() {
        // Remove existing modal if it exists with our ID
        const existingModal = document.getElementById(this.walletModalId);
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.id = this.walletModalId;
        modal.className = 'wallet-modal';
        modal.style.display = 'none';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'wallet-modal-content';
        
        const modalHeader = document.createElement('div');
        modalHeader.className = 'wallet-modal-header';
        
        const modalTitle = document.createElement('h3');
        modalTitle.textContent = 'Select a Wallet';
        modalHeader.appendChild(modalTitle);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'wallet-modal-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => this.hideWalletModal());
        modalHeader.appendChild(closeBtn);
        
        modalContent.appendChild(modalHeader);
        
        const walletList = document.createElement('div');
        walletList.className = 'wallet-options';
        walletList.id = 'walletList';
        modalContent.appendChild(walletList);
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
    }
    
    /**
     * Set up event listeners for wallet events
     */
    setupEventListeners() {
        console.log('Setting up wallet event listeners');
        
        // Find connect/select wallet buttons
        const connectBtn = document.getElementById('connectWalletBtn');
        const selectWalletBtn = document.getElementById('selectWallet');
        
        // Remove any existing event listeners first
        if (connectBtn) {
            const newBtn = connectBtn.cloneNode(true);
            connectBtn.parentNode.replaceChild(newBtn, connectBtn);
            newBtn.addEventListener('click', () => this.handleConnectClick());
            console.log('Added click handler to connectWalletBtn');
        }
        
        if (selectWalletBtn) {
            const newBtn = selectWalletBtn.cloneNode(true);
            selectWalletBtn.parentNode.replaceChild(newBtn, selectWalletBtn);
            newBtn.addEventListener('click', () => this.handleConnectClick());
            console.log('Added click handler to selectWallet');
        }
        
        // Subscribe to wallet events and store unsubscribe functions
        this.eventUnsubscribers.push(eventBus.on('wallet:detected', () => {
            this.updateStatus(this.statusMessages.WALLET_DETECTED);
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:notdetected', () => {
            this.updateStatus('No Web3 wallet detected. Please install a wallet.');
            this.messagePopup.warning('No Web3 wallet detected. Please install a wallet like MetaMask.', 'Wallet Required');
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:connecting', () => {
            this.updateStatus(this.statusMessages.CONNECTING);
            // Show the continue in wallet prompt
            const continuePrompt = document.getElementById('continuePrompt');
            if (continuePrompt) {
                continuePrompt.style.display = 'block';
            }
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:connected', (data) => {
            // Hide the continue prompt
            const continuePrompt = document.getElementById('continuePrompt');
            if (continuePrompt) {
                continuePrompt.style.display = 'none';
            }
            
            this.updateStatus(this.statusMessages.CONNECTED);
            this.updateWalletDisplay(data.address, data.walletType);
            this.hideWalletModal();
            
            // Update contract interface display
            const contractInterface = document.getElementById('contractInterface');
            if (contractInterface) {
                contractInterface.style.display = 'block';
                // Add active class to body
                document.body.classList.add('contract-interface-active');
            }
            
            // Show trading interface - call method from the original implementation
            this.showTradingInterface(data.address, data.ethersProvider, data.signer);
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:error', (error) => {
            // Hide the continue prompt
            const continuePrompt = document.getElementById('continuePrompt');
            if (continuePrompt) {
                continuePrompt.style.display = 'none';
            }
            
            this.updateStatus(this.statusMessages.ERROR + error.message, true);
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:disconnected', () => {
            this.updateStatus('Wallet disconnected');
            this.resetWalletDisplay();
            this.messagePopup.info('Your wallet has been disconnected', 'Disconnected');
            
            // Remove active class from body
            document.body.classList.remove('contract-interface-active');
            
            // Show GIF container again
            const gifContainer = document.querySelector('.gif-container');
            if (gifContainer) {
                gifContainer.style.display = 'flex';
            }
        }));
        
        this.eventUnsubscribers.push(eventBus.on('wallet:changed', (data) => {
            this.updateStatus(`Account changed: ${data.address.slice(0, 6)}...${data.address.slice(-4)}`);
            this.updateWalletDisplay(data.address, walletService.selectedWallet);
            this.messagePopup.info(`Account changed to ${data.address.slice(0, 6)}...${data.address.slice(-4)}`, 'Account Changed');
        }));
        
        this.eventUnsubscribers.push(eventBus.on('network:changed', () => {
            this.messagePopup.info('Network changed', 'Network Update');
        }));
        
        // Handle existing modal button clicks
        const existingModal = document.getElementById('walletModal');
        if (existingModal) {
            const walletOptions = existingModal.querySelectorAll('.wallet-option');
            walletOptions.forEach(option => {
                // Clone to remove existing listeners
                const newOption = option.cloneNode(true);
                option.parentNode.replaceChild(newOption, option);
                
                const walletType = newOption.getAttribute('data-wallet');
                console.log(`Binding click handler for ${walletType} wallet option`);
                newOption.addEventListener('click', () => {
                    console.log(`Wallet option clicked: ${walletType}`);
                    this.handleWalletSelection(walletType);
                });
            });
        }
    }
    
    /**
     * Handle click on connect wallet button
     */
    handleConnectClick() {
        console.log('Connect wallet button clicked');
        
        if (walletService.isConnected()) {
            // Already connected - show address info
            const address = walletService.getAddress();
            this.updateWalletDisplay(address, walletService.selectedWallet);
            
            // Show popup with options
            this.showWalletOptions(address);
        } else {
            console.log('Opening wallet selection modal');
            
            // Show wallet selection modal
            const existingModal = document.getElementById('walletModal');
            if (existingModal) {
                console.log('Using existing wallet modal');
                existingModal.style.display = 'flex';
                existingModal.classList.add('active');
                
                this.updateStatus(this.statusMessages.SELECT_WALLET);
                
                // Ensure wallet options have correct event handlers
                const walletOptions = existingModal.querySelectorAll('.wallet-option');
                walletOptions.forEach(option => {
                    const walletType = option.getAttribute('data-wallet');
                    console.log(`Setting up click handler for ${walletType} wallet option`);
                    
                    // Remove existing handler to avoid duplicates
                    option.removeEventListener('click', () => this.handleWalletSelection(walletType));
                    
                    // Add new handler
                    option.addEventListener('click', () => this.handleWalletSelection(walletType));
                });
            } else {
                // Fallback to our custom modal
                console.log('Using custom wallet modal (fallback)');
                this.showWalletModal();
            }
        }
    }
    
    /**
     * Show wallet options popup for connected wallets
     * @param {string} address - Connected wallet address
     */
    showWalletOptions(address) {
        // Display options in a popup
        const options = document.createElement('div');
        
        // Account info
        const accountInfo = document.createElement('div');
        accountInfo.innerHTML = `<strong>Connected:</strong> ${address.slice(0, 6)}...${address.slice(-4)}`;
        accountInfo.style.marginBottom = '10px';
        options.appendChild(accountInfo);
        
        // Disconnect button
        const disconnectBtn = document.createElement('button');
        disconnectBtn.textContent = 'Disconnect';
        disconnectBtn.style.padding = '5px 10px';
        disconnectBtn.style.marginRight = '10px';
        disconnectBtn.style.cursor = 'pointer';
        disconnectBtn.addEventListener('click', () => {
            walletService.disconnect();
            this.messagePopup.success('Wallet disconnected', 'Disconnected');
        });
        options.appendChild(disconnectBtn);
        
        // Display the options
        this.messagePopup.show({
            title: 'Wallet Options',
            message: options.outerHTML,
            type: 'info',
            duration: 0 // Stay open until closed
        });
    }
    
    /**
     * Show the wallet selection modal
     */
    showWalletModal() {
        const modal = document.getElementById(this.walletModalId);
        const walletList = document.getElementById('walletList');
        
        if (modal && walletList) {
            // Clear previous wallet list
            walletList.innerHTML = '';
            
            // Get available wallets
            const availableWallets = walletService.getAvailableWallets();
            
            if (Object.keys(availableWallets).length === 0) {
                walletList.innerHTML = '<p>No Web3 wallets detected. Please install a wallet like MetaMask.</p>';
                
                // Add a helpful link to install MetaMask
                const installLink = document.createElement('a');
                installLink.href = 'https://metamask.io/download/';
                installLink.target = '_blank';
                installLink.textContent = 'Install MetaMask';
                installLink.className = 'wallet-install-link';
                walletList.appendChild(installLink);
                
                this.messagePopup.warning('No Web3 wallets detected. Please install a wallet like MetaMask.', 'Wallet Required');
            } else {
                // Create a button for each available wallet
                for (const [name, wallet] of Object.entries(availableWallets)) {
                    const walletButton = document.createElement('button');
                    walletButton.className = 'wallet-option';
                    walletButton.setAttribute('data-wallet', name);
                    
                    const walletIcon = document.createElement('img');
                    walletIcon.src = wallet.icon;
                    walletIcon.alt = name;
                    walletButton.appendChild(walletIcon);
                    
                    const walletName = document.createElement('span');
                    walletName.textContent = name.charAt(0).toUpperCase() + name.slice(1);
                    walletButton.appendChild(walletName);
                    
                    walletButton.addEventListener('click', () => this.handleWalletSelection(name));
                    
                    walletList.appendChild(walletButton);
                }
            }
            
            // Show the modal
            modal.style.display = 'block';
            this.updateStatus(this.statusMessages.SELECT_WALLET);
        }
    }
    
    /**
     * Hide the wallet selection modal
     */
    hideWalletModal() {
        const modal = document.getElementById(this.walletModalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    /**
     * Handle wallet selection
     * @param {string} walletType - The selected wallet type
     */
    async handleWalletSelection(walletType) {
        try {
            console.log('Wallet selected:', walletType);
            this.updateStatus(this.statusMessages.WALLET_SELECTED + walletType.toUpperCase());
            
            // Hide all modals
            this.hideWalletModal();
            const existingModal = document.getElementById('walletModal');
            if (existingModal) {
                existingModal.style.display = 'none';
            }
            
            // Hide both select wallet buttons 
            const selectWalletBtn = document.getElementById('selectWallet');
            if (selectWalletBtn) {
                selectWalletBtn.style.display = 'none';
            }
            
            const connectWalletBtn = document.getElementById('connectWalletBtn');
            if (connectWalletBtn) {
                connectWalletBtn.style.display = 'none';
            }
            
            // Show selected wallet display
            const selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
            if (selectedWalletDisplay) {
                const walletIcon = document.getElementById('selectedWalletIcon');
                const walletName = document.getElementById('selectedWalletName');
                
                if (walletIcon) {
                    walletIcon.src = walletService.walletIcons[walletType];
                    walletIcon.style.display = 'inline-block';
                }
                
                if (walletName) {
                    walletName.textContent = walletType.charAt(0).toUpperCase() + walletType.slice(1);
                    walletName.style.display = 'inline-block';
                }
                
                selectedWalletDisplay.style.display = 'flex';
            }
            
            // Display connecting message in contract status area
            const contractStatus = document.getElementById('contractStatus');
            if (contractStatus) {
                contractStatus.textContent = this.statusMessages.CONNECTING;
            }
            
            // Show the continue prompt
            const continuePrompt = document.getElementById('continuePrompt');
            if (continuePrompt) {
                continuePrompt.style.display = 'block';
            }

            console.log(`Connecting to ${walletType}...`);
            
            // Direct MetaMask connection for simplicity
            if (walletType === 'metamask' && window.ethereum) {
                console.log('Using direct ethereum connection for MetaMask');
                
                try {
                    // Set up the wallet service with the provider
                    walletService.provider = window.ethereum;
                    walletService.selectedWallet = 'metamask';
                    walletService.setupEventListeners();
                    
                    // Use a simplified direct connection approach
                    console.log('Requesting accounts directly from window.ethereum');
                    const accounts = await window.ethereum.request({
                        method: 'eth_requestAccounts'
                    });
                    
                    console.log('Accounts received:', accounts);
                    
                    if (!accounts || accounts.length === 0) {
                        throw new Error('No accounts found or authorized');
                    }
                    
                    // Process the account
                    const account = accounts[0];
                    console.log('Connected to account:', account);
                    
                    // Update wallet service state
                    walletService.connectedAddress = account;
                    walletService.connected = true;
                    
                    // Create ethers provider and signer
                    walletService.ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
                    walletService.signer = walletService.ethersProvider.getSigner();
                    
                    // Hide the continue prompt
                    if (continuePrompt) {
                        continuePrompt.style.display = 'none';
                    }
                    
                    // Emit connection event
                    eventBus.emit('wallet:connected', {
                        address: account,
                        walletType: 'metamask',
                        provider: window.ethereum,
                        ethersProvider: walletService.ethersProvider,
                        signer: walletService.signer
                    });
                    
                    // Show trading interface - call method from the original implementation
                    this.showTradingInterface(account, walletService.ethersProvider, walletService.signer);
                    
                    return;
                } catch (err) {
                    console.error('Direct connection error:', err);
                    
                    // Handle specific error conditions
                    if (err.code === 4001) {
                        throw new Error('Connection request was rejected by user');
                    } else if (err.message && err.message.includes('wallet must has at least one account')) {
                        // This is a common error with some versions of MetaMask
                        throw new Error('Your wallet has no accounts. Please create at least one account in your wallet and try again.');
                    }
                    
                    // Otherwise re-throw the error
                    throw err;
                }
            }
            
            // Standard approach for other wallet types
            await walletService.selectWallet(walletType);
            await walletService.connect();
            
        } catch (error) {
            console.error('Wallet selection error:', error);
            
            // Show both select wallet buttons again
            const selectWalletBtn = document.getElementById('selectWallet');
            if (selectWalletBtn) {
                selectWalletBtn.style.display = 'block';
            }
            
            const connectWalletBtn = document.getElementById('connectWalletBtn');
            if (connectWalletBtn) {
                connectWalletBtn.style.display = 'block';
            }
            
            // Hide selected wallet display
            const selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
            if (selectedWalletDisplay) {
                selectedWalletDisplay.style.display = 'none';
            }
            
            // Hide the continue prompt
            const continuePrompt = document.getElementById('continuePrompt');
            if (continuePrompt) {
                continuePrompt.style.display = 'none';
            }
            
            // More specific error handling
            if (error.message.includes('rejected') || error.code === 4001) {
                this.messagePopup.warning('Connection request was rejected. Please try again when ready.', 'Connection Rejected');
                this.updateStatus('Connection request rejected. Please try again.', true);
            } else if (error.message.includes('wallet must has at least one account') || error.message.includes('has no accounts')) {
                this.messagePopup.warning('Your wallet has no accounts. Please create at least one account in your wallet and try again.', 'No Accounts');
                this.updateStatus('Wallet has no accounts. Create one and try again.', true);
            } else {
                // Generic error
                this.updateStatus(this.statusMessages.ERROR + error.message, true);
                this.messagePopup.error(`Connection failed: ${error.message}`, 'Connection Error');
            }
        }
    }
    
    /**
     * Update the wallet connection status
     * @param {string} message - The status message
     * @param {boolean} isError - Whether this is an error message
     */
    updateStatus(message, isError = false) {
        const statusElement = document.getElementById('walletStatus');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = 'wallet-status ' + (isError ? 'error' : '');
        }
        
        // Also update the original status message element if it exists
        const contractStatus = document.getElementById('contractStatus');
        if (contractStatus) {
            contractStatus.textContent = message;
            if (isError) {
                contractStatus.classList.add('error');
            } else {
                contractStatus.classList.remove('error');
            }
        }
    }
    
    /**
     * Update the wallet display with connected account info
     * @param {string} address - The connected wallet address
     * @param {string} walletType - The connected wallet type
     */
    updateWalletDisplay(address, walletType) {
        const connectBtn = document.getElementById('connectWalletBtn');
        
        if (connectBtn && address) {
            const shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
            connectBtn.textContent = shortAddress;
            connectBtn.title = `Connected with ${walletType}: ${address}`;
            connectBtn.classList.add('connected');
        }
        
        // Update the status element
        this.updateStatus(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
        
        // Hide the select wallet button from original UI
        const selectWalletBtn = document.getElementById('selectWallet');
        if (selectWalletBtn) {
            selectWalletBtn.style.display = 'none';
        }
    }
    
    /**
     * Reset the wallet display to disconnected state
     */
    resetWalletDisplay() {
        const connectBtn = document.getElementById('connectWalletBtn');
        
        if (connectBtn) {
            connectBtn.textContent = 'Connect Wallet';
            connectBtn.title = 'Connect to your Web3 wallet';
            connectBtn.classList.remove('connected');
        }
        
        // Show the original select wallet button
        const selectWalletBtn = document.getElementById('selectWallet');
        if (selectWalletBtn) {
            selectWalletBtn.style.display = 'block';
        }
        
        // Hide the selected wallet display
        const selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
        if (selectedWalletDisplay) {
            selectedWalletDisplay.style.display = 'none';
        }
    }

    /**
     * Display the trading interface
     * @param {string} connectedAddress - The connected wallet address
     * @param {Object} ethersProvider - The ethers provider
     * @param {Object} signer - The signer
     */
    async showTradingInterface(connectedAddress, ethersProvider, signer) {
        try {
            console.log('Showing trading interface for address:', connectedAddress);
            
            // If trading interface is already initialized but not properly unmounted,
            // let's clean it up first to avoid duplicate components and events
            if (window.tradingInterfaceInstance) {
                console.log('Cleaning up previous trading interface instance');
                try {
                    if (typeof window.tradingInterfaceInstance.unmount === 'function') {
                        window.tradingInterfaceInstance.unmount();
                    }
                    delete window.tradingInterfaceInstance;
                } catch (cleanupError) {
                    console.warn('Error cleaning up previous trading interface:', cleanupError);
                }
            }
            
            // Clean up error boundary if it exists
            if (window.tradingInterfaceErrorBoundary) {
                console.log('Cleaning up previous error boundary instance');
                try {
                    if (typeof window.tradingInterfaceErrorBoundary.unmount === 'function') {
                        window.tradingInterfaceErrorBoundary.unmount();
                    }
                    delete window.tradingInterfaceErrorBoundary;
                } catch (cleanupError) {
                    console.warn('Error cleaning up previous error boundary:', cleanupError);
                }
            }
            
            // Check if trading interface is already shown
            if (window.tradingInterfaceInitialized) {
                console.log('Trading interface already initialized, skipping');
                return;
            }
            
            // Import required components directly following the original pattern
            console.log('Importing required components...');
            const TradingInterface = await import('../../components/TradingInterface/TradingInterface.js').then(m => m.default || m.TradingInterface);
            const ChatPanel = await import('../../components/ChatPanel/ChatPanel.js').then(m => m.default);
            const StatusPanel = await import('../../components/StatusPanel/StatusPanel.js').then(m => m.default);
            const BlockchainService = await import('../../services/BlockchainService.js').then(m => m.default);
            const { ErrorBoundary } = await import('../../components/ErrorBoundary/ErrorBoundary.js');
            console.log('Components imported successfully');
            
            // Remove the original status message element
            const originalStatus = document.getElementById('contractStatus');
            if (originalStatus) {
                originalStatus.remove();
            }

            // Get the container
            const bondingInterface = document.getElementById('bondingCurveInterface');
            if (!bondingInterface) {
                throw new Error('Bonding interface container not found');
            }

            // Clear the container
            bondingInterface.innerHTML = '';

            // Use existing BlockchainService instance if available or create new one
            let blockchainService;
            if (window.blockchainServiceInstance) {
                console.log('Using existing BlockchainService instance');
                blockchainService = window.blockchainServiceInstance;
            } else {
                console.log('Initializing new BlockchainService...');
                blockchainService = new BlockchainService();
                await blockchainService.initialize();
                // Store for future use
                window.blockchainServiceInstance = blockchainService;
                console.log('BlockchainService initialized successfully');
            }
            
            // Get network ID and contract data
            const networkId = await ethersProvider.getNetwork().then(network => network.chainId);
            console.log('Connected to network ID:', networkId);
            
            // Get contract data from switch.json
            console.log('Loading contract data from switch.json...');
            const switchResponse = await fetch('/EXEC404/switch.json');
            const contractData = await switchResponse.json();
            console.log('Contract data loaded:', contractData);

            // Create and mount trading interface using BlockchainService
            console.log('Creating TradingInterface...');
            const tradingInterface = new TradingInterface(
                connectedAddress, 
                blockchainService,
                ethers,
                {
                    walletAddress: connectedAddress,
                    isConnected: true,
                    networkId: contractData.network || networkId
                }
            );
            console.log('TradingInterface created successfully');
            
            // Store instance for proper cleanup later
            window.tradingInterfaceInstance = tradingInterface;

            // Create ChatPanel and StatusPanel
            console.log('Creating ChatPanel and StatusPanel...');
            const chatPanel = new ChatPanel();
            const statusPanel = new StatusPanel();

            // Wrap TradingInterface with ErrorBoundary for error resilience
            console.log('Wrapping TradingInterface with ErrorBoundary...');
            const errorBoundary = new ErrorBoundary();
            errorBoundary.mount(bondingInterface);
            errorBoundary.wrap(tradingInterface, bondingInterface);
            
            // Store error boundary for cleanup
            window.tradingInterfaceErrorBoundary = errorBoundary;

            // Mount the interface (ErrorBoundary will handle mounting)
            console.log('TradingInterface wrapped and ready');

            // Show the container - ensure it's visible
            bondingInterface.style.display = 'block';
            bondingInterface.style.opacity = '1';
            bondingInterface.style.visibility = 'visible';
            bondingInterface.classList.add('active');
            
            console.log('TradingInterface mounted, container display:', bondingInterface.style.display);
            console.log('TradingInterface container opacity:', bondingInterface.style.opacity);
            
            // Hide GIF container
            const gifContainer = document.querySelector('.gif-container');
            if (gifContainer) {
                console.log('Hiding GIF container');
                gifContainer.style.display = 'none';
            }
            
            // Update panels
            console.log('Updating interface panels...');
            await this.updateInterfacePanels(chatPanel, statusPanel);
            console.log('Trading interface setup complete');
            
            // Mark as initialized
            window.tradingInterfaceInitialized = true;
            
        } catch (error) {
            console.error('Error showing trading interface:', error);
            this.messagePopup.error('Failed to load trading interface: ' + error.message, 'Interface Error');
            throw error;
        }
    }

    /**
     * Update interface panels with chat and status
     * @param {Object} chatPanel - The chat panel instance
     * @param {Object} statusPanel - The status panel instance
     */
    async updateInterfacePanels(chatPanel, statusPanel) {
        try {
            console.log('Updating interface panels...');
            
            // Check if custom panels already exist (to avoid duplicating)
            const existingChatContainer = document.querySelector('.chat-panel-container');
            const existingStatusContainer = document.querySelector('.status-panel-container');
            
            // Only replace checker panel if a chat panel doesn't already exist
            if (!existingChatContainer && chatPanel) {
                const checkerPanel = document.querySelector('.checker-panel');
                if (checkerPanel) {
                    console.log('Replacing checker panel with chat panel');
                    // Create a new container for the chat panel
                    const chatContainer = document.createElement('div');
                    chatContainer.className = 'chat-panel-container';
                    
                    // Replace the checker panel with our new container
                    checkerPanel.parentNode.replaceChild(chatContainer, checkerPanel);
                    
                    // Mount the chat panel to the container
                    chatPanel.mount(chatContainer);
                } else {
                    console.warn('Checker panel not found, looking for main-content to append');
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        // Create a fallback container for the chat panel
                        const chatContainer = document.createElement('div');
                        chatContainer.className = 'chat-panel-container';
                        
                        // Check if the main content already has a panel
                        const existingPanel = mainContent.querySelector('.panel');
                        if (existingPanel) {
                            console.log('Replacing existing panel with chat container');
                            mainContent.replaceChild(chatContainer, existingPanel);
                        } else {
                            console.log('Appending chat container to main content');
                            mainContent.appendChild(chatContainer);
                        }
                        
                        // Mount the chat panel to the container
                        chatPanel.mount(chatContainer);
                    } else {
                        console.warn('No suitable container found for chat panel');
                    }
                }
            } else if (existingChatContainer && chatPanel) {
                console.log('Chat container already exists, mounting to existing container');
                // Just mount to the existing container
                chatPanel.mount(existingChatContainer);
            }
    
            // Only replace stats panel if a status panel doesn't already exist
            if (!existingStatusContainer && statusPanel) {
                const statsPanel = document.querySelector('.stats-panel');
                if (statsPanel) {
                    console.log('Replacing stats panel with status panel');
                    // Create a new container for the status panel
                    const statusContainer = document.createElement('div');
                    statusContainer.className = 'status-panel-container';
                    
                    // Replace the stats panel with our new container
                    statsPanel.parentNode.replaceChild(statusContainer, statsPanel);
                    
                    // Mount the status panel to the container
                    statusPanel.mount(statusContainer);
                } else {
                    console.warn('Stats panel not found, looking for main-content to append');
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        // Check if we already have a chat panel container
                        const chatContainer = mainContent.querySelector('.chat-panel-container');
                        
                        // Create a fallback container for the status panel
                        const statusContainer = document.createElement('div');
                        statusContainer.className = 'status-panel-container';
                        
                        // Add the status container after the chat container or at the end
                        if (chatContainer) {
                            console.log('Adding status container after chat container');
                            chatContainer.after(statusContainer);
                        } else {
                            console.log('Appending status container to main content');
                            mainContent.appendChild(statusContainer);
                        }
                        
                        // Mount the status panel to the container
                        statusPanel.mount(statusContainer);
                    } else {
                        console.warn('No suitable container found for status panel');
                    }
                }
            } else if (existingStatusContainer && statusPanel) {
                console.log('Status container already exists, mounting to existing container');
                // Just mount to the existing container
                statusPanel.mount(existingStatusContainer);
            }
    
            // Update the tabs active state
            const whitelistTab = document.querySelector('#whitelistTab');
            const presaleTab = document.querySelector('#presaleTab');
            
            if (whitelistTab) {
                whitelistTab.classList.remove('active');
            }
            
            if (presaleTab) {
                presaleTab.classList.add('active');
            }
            
            console.log('Interface panels update complete');
        } catch (error) {
            console.error('Error updating interface panels:', error);
        }
    }
    
    /**
     * Cleanup method to remove event listeners and reset state
     */
    cleanup() {
        console.log('[WalletConnector] Starting cleanup...');
        
        // Unsubscribe from all event bus listeners
        if (this.eventUnsubscribers) {
            this.eventUnsubscribers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            });
            this.eventUnsubscribers = [];
        }
        
        // Remove unhandled rejection handler
        if (this.boundUnhandledRejectionHandler) {
            window.removeEventListener('unhandledrejection', this.boundUnhandledRejectionHandler);
            this.boundUnhandledRejectionHandler = null;
        }
        
        // Hide and remove modal if it exists
        const modal = document.getElementById(this.walletModalId);
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Reset state
        this.container = null;
        this.messagePopup = null;
        
        console.log('[WalletConnector] Cleanup complete');
    }
}

export default WalletConnector; 