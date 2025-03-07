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
        this.blockchainService = blockchainService;
        
        // Initialize trading interface first
        this.tradingInterface = null;
        this.chatPanel = null;  // Don't create immediately
        this.statusPanel = null;
        
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
            const response = await fetch('/EXEC404/switch.json');
            
            if (!response.ok) {
                this.statusMessage.update('System offline', true);
                return false;
            }
            
            this.contractData = await response.json();
            
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

            // Check and enforce network settings
            const targetNetwork = this.contractData.network;
            const targetRpcUrl = this.contractData.rpcUrl;
            
            // Get current network
            const currentNetwork = await provider.request({ method: 'eth_chainId' });
            
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
                                rpcUrls: [targetRpcUrl],
                                chainName: 'Local Test Network',
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

    // async initializeCurveChart(currentPrice) {
    //     const canvas = document.getElementById('curveChart');
    //     const ctx = canvas.getContext('2d');
        
    //     // Set canvas size
    //     canvas.width = canvas.offsetWidth;
    //     canvas.height = canvas.offsetHeight;
        
    //     // Clear canvas
    //     ctx.clearRect(0, 0, canvas.width, canvas.height);
        
    //     // Set styles
    //     ctx.strokeStyle = '#FFD700';
    //     ctx.lineWidth = 2;
        
    //     // Modified curve function with even more dramatic curve
    //     const curve = (x) => {
    //         // Add padding of 10% at bottom and top
    //         const paddedX = 0.1 + (x * 0.8);
    //         return Math.pow(paddedX, 3.5); // Increased from 2.5 to 3.5 for steeper curve
    //     }
        
    //     // Calculate the maximum price point for scaling
    //     const maxPrice = curve(1);
        
    //     // Adjust position calculation to account for padding
    //     const currentPosition = Math.max(0.1, Math.min(0.9, Math.pow(currentPrice / maxPrice, 1/3.5))); // Match the curve power
        
    //     // Draw main curve
    //     ctx.beginPath();
    //     const startX = canvas.width * 0.1;
    //     const startY = canvas.height * 0.9;
    //     ctx.moveTo(startX, startY);
        
    //     const points = 100;
    //     const curvePoints = []; // Store points for later use
        
    //     // First populate all curve points
    //     for (let i = 0; i <= points; i++) {
    //         const x = i / points;
    //         const y = curve(x);
            
    //         const canvasX = x * canvas.width * 0.8 + canvas.width * 0.1;
    //         const canvasY = canvas.height * 0.9 - y * canvas.height * 0.8;
            
    //         curvePoints.push({ x: canvasX, y: canvasY });
    //     }
        
    //     // Now draw the main curve using the points
    //     ctx.beginPath();
    //     ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
    //     for (let i = 0; i < curvePoints.length; i++) {
    //         ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
    //     }
    //     ctx.stroke();
        
    //     // Update position indicator code
    //     const segmentSize = 0.05; // Reduced size for more precise indication
        
    //     // Ensure position stays within bounds
    //     const boundedPosition = Math.max(0, Math.min(0.99, currentPosition));
        
    //     // Calculate indices for highlighted segment
    //     const startIndex = Math.max(0, Math.min(points - 1, Math.floor((boundedPosition - segmentSize/2) * points)));
    //     const endIndex = Math.max(0, Math.min(points - 1, Math.floor((boundedPosition + segmentSize/2) * points)));
        
    //     if (startIndex < curvePoints.length && endIndex < curvePoints.length) {
    //         // Draw highlighted segment
    //         ctx.beginPath();
    //         ctx.strokeStyle = '#FFD700';
    //         ctx.lineWidth = 4; // Slightly thicker
            
    //         // Start slightly before the current position
    //         ctx.moveTo(curvePoints[startIndex].x, curvePoints[startIndex].y);
            
    //         // Draw the highlighted segment
    //         for (let i = startIndex; i <= endIndex && i < curvePoints.length; i++) {
    //             ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
    //         }
            
    //         ctx.stroke();
            
    //         // Draw the indicator dot at the center of the highlighted segment
    //         const centerIndex = Math.floor((startIndex + endIndex) / 2);
    //         if (centerIndex < curvePoints.length) {
    //             const centerPoint = curvePoints[centerIndex];
                
    //             ctx.beginPath();
    //             ctx.arc(centerPoint.x, centerPoint.y, 4, 0, Math.PI * 2);
    //             ctx.fillStyle = '#FF0000';
    //             ctx.fill();
    //         }
    //     }
        
    //     // Add labels with dimmer color
    //     ctx.fillStyle = '#666666';
    //     ctx.font = '12px Courier New';
    //     ctx.fillText(`${currentPrice.toFixed(4)} ETH / CULT EXECUTIVE COLLECTIBLE`, 10, 20); // Price in top left
    //     //ctx.fillText('', canvas.width - 70, canvas.height - 10); // $EXEC label at bottom
    // }

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
}

export default Web3Handler; 