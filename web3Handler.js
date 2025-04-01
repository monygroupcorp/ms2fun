import WalletModal from './src/components/WalletModal/WalletModal.js';
import StatusMessage from './src/components/StatusMessage/StatusMessage.js';
import TradingInterface from './src/components/TradingInterface/TradingInterface.js';
import ChatPanel from './src/components/ChatPanel/ChatPanel.js';
import StatusPanel from './src/components/StatusPanel/StatusPanel.js';
import { eventBus } from './src/core/EventBus.js';

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

class Web3Handler {
    constructor(blockchainService) {
        this.contractData = null;
        this.web3 = null;
        this.contract = null;
        this.connected = false;
        this.selectedWallet = null;
        this.connectedAddress = null;
        this.contractAddress = null;
        this.blockchainService = blockchainService;
        
        // Initialize trading interface first
        this.tradingInterface = null;
        this.chatPanel = null;  // Don't create immediately
        this.statusPanel = null;

        // Add property to track if we're in collection view
        this.isCollectionView = window.location.pathname.includes('collection.html');
        
        this.statusMessage = new StatusMessage('contractStatus');
        
        this.statusMessages = {
            INITIALIZING: 'INITIALIZING SYSTEM...',
            CONTRACT_FOUND: 'SECURE SYSTEM READY',
            WALLET_DETECTED: 'WALLET DETECTED. CLICK CONNECT TO PROCEED.',
            CONNECTING: 'REQUESTING SECURE CONNECTION...',
            CONNECTED: 'CONNECTION ESTABLISHED',
            ERROR: 'ERROR: ',
            SELECT_WALLET: 'SELECT YOUR WALLET',
            WALLET_SELECTED: 'WALLET SELECTED: ',
            VERIFYING_WHITELIST: 'VERIFYING WHITELIST STATUS...',
            SIGN_REQUIRED: 'SIGNATURE REQUIRED TO PROCEED',
            SIGN_PENDING: 'AWAITING SIGNATURE...',
            VERIFIED: 'VERIFICATION COMPLETE - INITIALIZING INTERFACE'
        };
        this.providerMap = {
            rabby: () => window.rabby || window.ethereum,
            rainbow: () => window.rainbow || window.ethereum,
            phantom: () => window.phantom?.ethereum,
            metamask: () => window.metamask?.ethereum || window.ethereum,
            // metamask: () => {
            //     // MetaMask specific detection
            //     const provider = window.ethereum;
            //     if (provider?.isMetaMask && !provider.isRabby) {
            //         return provider;
            //     }
            //     return null;
            // },
            //walletconnect: () => null // Will implement later with WalletConnect v2
        };
        
        // Add wallet icons mapping
        this.walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/metamask.webp',
            //walletconnect: '/public/wallets/walletconnect.webp'
        };

        this.walletModal = new WalletModal(
            this.providerMap, 
            this.walletIcons,
            (walletType) => this.handleWalletSelection(walletType)  // Pass callback
        );
    }

    async init() {

        try {
            // Check if we're in collection view
            if (this.isCollectionView) {
                console.log('Collection view detected');
                // Get contract address from URL
                const urlParams = new URLSearchParams(window.location.search);
                const contractAddress = urlParams.get('contract');

                if (!contractAddress) {
                    // Show contract input interface
                    this.showContractInput();
                    return true; // Return true but don't proceed with contract initialization
                }

                // Validate contract address
                if (!ethers.utils.isAddress(contractAddress)) {
                    throw new Error('Invalid contract address');
                }

                this.contractAddress = contractAddress;
                // Continue with contract initialization
            } else {
                // Original behavior for main page
                const response = await fetch('/EXEC404/switch.json');
                if (!response.ok) {
                    this.statusMessage.update('System offline', true);
                    return false;
                }
                this.contractData = await response.json();
            }
            
            // Check if wallet is available but don't connect yet
            if (typeof window.ethereum !== 'undefined') {
                this.statusMessage.update(this.statusMessages.WALLET_DETECTED);
            } else {
                this.statusMessage.update('Please install MetaMask or another Web3 wallet');
            }
            
            // Hide GIF container when contract is found
            const gifContainer = document.querySelector('.gif-container');
            if (gifContainer) {
                gifContainer.style.display = 'none';
            }
            
            this.setupWalletSelection();
            this.setupBottomSectionCollapse();
            
            return true;
        } catch (error) {
            console.error('Error in init:', error);
            this.statusMessage.update(this.statusMessages.ERROR + error.message, true);
            return false;
        }
    }

    setupWalletSelection() {
        const selectWalletBtn = document.getElementById('selectWallet');
        
        selectWalletBtn.addEventListener('click', () => {
            this.walletModal.show();
            this.statusMessage.update(this.statusMessages.SELECT_WALLET);
        });
    }

    async handleWalletSelection(walletType) {
        this.selectedWallet = walletType;
        
        try {
            const provider = this.providerMap[walletType]();
            
            if (!provider) {
                throw new Error(`${walletType} not detected`);
            }

            // Get current network from provider
            const currentNetwork = await provider.request({ method: 'eth_chainId' });
            
            // Only attempt network switch if explicitly specified in contractData
            if (this.contractData && this.contractData.network) {
                const targetNetwork = this.contractData.network;
                
                // If network doesn't match, try to switch
                if (currentNetwork !== `0x${Number(targetNetwork).toString(16)}`) {
                    try {
                        await provider.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: `0x${Number(targetNetwork).toString(16)}` }],
                        });
                    } catch (switchError) {
                        // If the network doesn't exist, add it
                        if (switchError.code === 4902) {
                            await provider.request({
                                method: 'wallet_addEthereumChain',
                                params: [{
                                    chainId: `0x${Number(targetNetwork).toString(16)}`,
                                    rpcUrls: [this.contractData.rpcUrl || 'https://eth-sepolia.g.alchemy.com/v2/demo'],
                                    chainName: 'Sepolia Test Network',
                                    nativeCurrency: {
                                        name: 'ETH',
                                        symbol: 'ETH',
                                        decimals: 18
                                    }
                                }]
                            });
                        } else {
                            throw switchError;
                        }
                    }
                }
            }

            // Store the provider for future use
            this.provider = provider;

            // Update the selected wallet display
            this.walletModal.updateSelectedWalletDisplay(walletType);

            // Some providers (like Rabby) need to be explicitly activated
            if (walletType === 'rabby' && provider.activate) {
                await provider.activate();
            }

            this.statusMessage.update(this.statusMessages.WALLET_SELECTED + walletType.toUpperCase());
            await this.connectWallet();

        } catch (error) {
            console.error('Error in handleWalletSelection:', error);
            this.statusMessage.update(`${error.message}. Please install ${walletType}.`, true);
            throw error;
        }
    }


    async connectWallet() {
        if (!this.selectedWallet || !this.provider) {
            throw new Error('Please select a wallet first');
        }

        try {
            this.statusMessage.update(this.statusMessages.CONNECTING);
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            let accounts;
            switch (this.selectedWallet) {
                case 'phantom':
                    accounts = await window.phantom.ethereum.request({
                        method: 'eth_requestAccounts'
                    });
                    break;
                    
                default:
                    accounts = await this.provider.request({
                        method: 'eth_requestAccounts',
                        params: []
                    });
            }
            
            if (!accounts || !accounts[0]) {
                throw new Error('No accounts found');
            }

            this.connected = true;
            this.connectedAddress = accounts[0];
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Remove wallet UI elements
            this.walletModal.hideWalletDisplay();
            
            // Show trading interface
            await this.showTradingInterface();
            
            // Emit wallet connected event
            eventBus.emit('wallet:connected', this.connectedAddress);
            
            return this.connectedAddress;

        } catch (error) {
            console.error('Connection error:', error);
            // Show select button again on error
            this.walletModal.showSelectButton();
            
            if (error.code === 4001) {
                this.statusMessage.update('Connection request declined. Please try again.', true);
            } else {
                this.statusMessage.update(this.statusMessages.ERROR + error.message, true);
            }
            throw error;
        }
    }

    async verifyWhitelist(address) {
        this.statusMessage.update(this.statusMessages.VERIFYING_WHITELIST);
        
        try {
            const response = await fetch(`/api/whitelist/${address}`);
            const data = await response.json();
            
            if (!data.isWhitelisted) {
                throw new Error('Address not whitelisted');
            }

            // Request signature
            await this.requestSignature(address);
            
            // If we get here, show the trading interface
            this.showTradingInterface();
            
        } catch (error) {
            this.statusMessage.update('Whitelist verification failed: ' + error.message, true);
            throw error;
        }
    }

    async requestSignature(address) {
        this.statusMessage.update(this.statusMessages.SIGN_REQUIRED);
        
        const message = `CULT EXECS Whitelist Verification\nAddress: ${address}\nTimestamp: ${Date.now()}`;
        
        try {
            this.statusMessage.update(this.statusMessages.SIGN_PENDING);
            const signature = await this.provider.request({
                method: 'personal_sign',
                params: [message, address]
            });
            
            // Verify signature server-side if needed
            // await this.verifySignature(signature, address, message);
            
            this.statusMessage.update(this.statusMessages.VERIFIED);
        } catch (error) {
            this.statusMessage.update('Signature failed: ' + error.message, true);
            throw error;
        }
    }

    async showTradingInterface() {
        if (!this.connectedAddress) {
            throw new Error('No connected address found');
        }

        try {
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

            // Create and mount trading interface using BlockchainService
            this.tradingInterface = new TradingInterface(
                this.connectedAddress, 
                this.blockchainService,
                ethers,
                {
                    walletAddress: this.connectedAddress,
                    isConnected: true,
                    networkId: this.contractData.network
                }
            );

            // Create ChatPanel after TradingInterface is initialized
            this.chatPanel = new ChatPanel();
            this.statusPanel = new StatusPanel();

            // Mount the interface
            this.tradingInterface.mount(bondingInterface);

            // Show the container
            bondingInterface.style.display = 'block';
            bondingInterface.classList.add('active');

            // Update panels
            await this.updateInterfacePanels();

        } catch (error) {
            console.error('Error showing trading interface:', error);
            throw error;
        }
    }

    async updateInterfacePanels() {
        if (!this.chatPanel) {
            console.warn('ChatPanel not initialized');
            return;
        }

        // Replace the checker panel with the chat interface
        const checkerPanel = document.querySelector('.checker-panel');
        if (checkerPanel) {
            // Create a new container for the chat panel
            const chatContainer = document.createElement('div');
            chatContainer.className = 'chat-panel-container';
            
            // Replace the checker panel with our new container
            checkerPanel.parentNode.replaceChild(chatContainer, checkerPanel);
            
            // Mount the chat panel to the container
            this.chatPanel.mount(chatContainer);
        }
        const statsPanel = document.querySelector('.stats-panel')
        if (statsPanel) {
            // Create a new ocntainer for the status panel 
            const statusContainer = document.createElement('div');
            statsPanel.className = 'status-panel-container';

            statsPanel.parentNode.replaceChild(statusContainer, statsPanel)

            this.statusPanel.mount(statusContainer)
        }

        // Update the tabs active state (if still needed)
        document.querySelector('#whitelistTab')?.classList.remove('active');
        document.querySelector('#presaleTab')?.classList.add('active');
    }

    async getCurrentPrice() {
        try {
            if (!this.blockchainService) {
                throw new Error('BlockchainService not initialized');
            }
            const price = await this.blockchainService.getCurrentPrice();
            return price.eth/10;
        } catch (error) {
            console.error('Error in getCurrentPrice:', error);
            throw error;
        }
    }

    setupBottomSectionCollapse() {
        const toggleBar = document.createElement('div');
        toggleBar.className = 'bottom-section-toggle';
        toggleBar.innerHTML = `
            <span class="toggle-arrow">↑</span>
            <span class="toggle-text">SHOW INFO</span>
        `;

        const colorBar = document.querySelector('.color-bar');
        const mainContent = document.querySelector('.main-content');
        
        // Insert toggle bar before color bar
        colorBar.parentNode.insertBefore(toggleBar, colorBar);
        
        // Set initial state on mobile
        if (window.innerWidth <= 768) {
            mainContent.classList.add('collapsed');
            toggleBar.querySelector('.toggle-arrow').textContent = '↑';
            toggleBar.querySelector('.toggle-text').textContent = 'SHOW INFO';
        }

        // Add click handler
        toggleBar.addEventListener('click', () => {
            mainContent.classList.toggle('collapsed');
            const isCollapsed = mainContent.classList.contains('collapsed');
            toggleBar.querySelector('.toggle-arrow').textContent = isCollapsed ? '↑' : '↓';
            toggleBar.querySelector('.toggle-text').textContent = isCollapsed ? 'SHOW INFO' : 'HIDE INFO';
        });
    }

    showContractInput() {
        // Get the middle section
        const middleSection = document.querySelector('.middle-section');
        if (!middleSection) return;

        // Create contract input interface
        const inputHTML = `
            <div class="contract-input-container">
                <h2>Enter Contract Address</h2>
                <div class="input-group">
                    <input type="text" 
                           id="contractAddressInput" 
                           placeholder="0x..." 
                           class="contract-address-input">
                    <button id="loadContractButton" class="load-contract-button">
                        Load Contract
                    </button>
                </div>
                <div id="contractInputStatus" class="input-status"></div>
            </div>
        `;

        // Clear existing content and add input interface
        middleSection.innerHTML = inputHTML;

        // Add event listeners
        const input = document.getElementById('contractAddressInput');
        const button = document.getElementById('loadContractButton');
        const status = document.getElementById('contractInputStatus');

        // Handle input validation
        input.addEventListener('input', () => {
            const address = input.value.trim();
            if (ethers.utils.isAddress(address)) {
                input.classList.add('valid');
                input.classList.remove('invalid');
                button.disabled = false;
            } else {
                input.classList.add('invalid');
                input.classList.remove('valid');
                button.disabled = true;
            }
        });

        // Handle contract loading
        button.addEventListener('click', async () => {
            const address = input.value.trim();
            if (ethers.utils.isAddress(address)) {
                // Update URL without reload
                const newUrl = `${window.location.pathname}?contract=${address}`;
                window.history.pushState({ path: newUrl }, '', newUrl);
                
                // Reinitialize with new address
                this.contractAddress = address;
                await this.init();
            } else {
                status.textContent = 'Please enter a valid contract address';
                status.classList.add('error');
            }
        });
    }
}

export default Web3Handler; 