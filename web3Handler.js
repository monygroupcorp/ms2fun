import WalletModal from './src/components/WalletModal/WalletModal.js';
import StatusMessage from './src/components/StatusMessage/StatusMessage.js';

class Web3Handler {
    constructor() {
        this.contractData = null;
        this.web3 = null;
        this.contract = null;
        this.connected = false;
        this.selectedWallet = null;
        this.connectedAddress = null;
        
        this.statusMessage = new StatusMessage('contractStatus');
        
        console.log('Web3Handler initialized');
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
            metamask: () => {
                // MetaMask specific detection
                const provider = window.ethereum;
                if (provider?.isMetaMask && !provider.isRabby) {
                    return provider;
                }
                return null;
            },
            walletconnect: () => null // Will implement later with WalletConnect v2
        };
        
        // Add wallet icons mapping
        this.walletIcons = {
            rabby: '/public/wallets/rabby.webp',
            rainbow: '/public/wallets/rainbow.webp',
            phantom: '/public/wallets/phantom.webp',
            metamask: '/public/wallets/metamask.webp',
            walletconnect: '/public/wallets/walletconnect.webp'
        };

        this.walletModal = new WalletModal(this.providerMap, this.walletIcons);
    }

    async init() {
        console.log('Starting Web3Handler init...');
        try {
            console.log('Attempting to load switch.json from EXEC404 directory...');
            const response = await fetch('/EXEC404/switch.json');
            console.log('Response:', response);
            
            if (!response.ok) {
                this.statusMessage.update('System offline', true);
                return false;
            }
            
            this.contractData = await response.json();
            
            // Replace system status panel with chat panel
            const statsPanel = document.querySelector('.stats-panel');
            if (statsPanel) {
                const chatInterface = document.createElement('div');
                chatInterface.className = 'chat-panel';
                chatInterface.innerHTML = `
                    <div class="chat-header">
                        <h2>EXEC INSIDER BULLETIN</h2>
                    </div>
                    <div class="chat-messages" id="chatMessages">
                        <!-- Messages will be populated here -->
                    </div>
                    <div class="chat-status">
                        <span>MESSAGES LOADED FROM CHAIN</span>
                        <span class="message-count">0</span>
                    </div>
                `;
                statsPanel.parentNode.replaceChild(chatInterface, statsPanel);
                
                // Initialize chat messages
                await this.loadChatMessages();
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

            // Store the provider for future use
            this.provider = provider;

            // Update the selected wallet display
            this.updateSelectedWalletDisplay(walletType);

            // Some providers (like Rabby) need to be explicitly activated
            if (walletType === 'rabby' && provider.activate) {
                await provider.activate();
            }

            this.statusMessage.update(this.statusMessages.WALLET_SELECTED + walletType.toUpperCase());
            await this.connectWallet();

        } catch (error) {
            this.statusMessage.update(`${error.message}. Please install ${walletType}.`, true);
        }
    }

    updateSelectedWalletDisplay(walletType) {
        const display = document.getElementById('selectedWalletDisplay');
        const icon = document.getElementById('selectedWalletIcon');
        const name = document.getElementById('selectedWalletName');
        const continuePrompt = document.getElementById('continuePrompt');
        const selectButton = document.getElementById('selectWallet');

        // Update display
        icon.src = this.walletIcons[walletType];
        name.textContent = walletType.toUpperCase();
        display.classList.add('active');
        continuePrompt.style.display = 'block';
        selectButton.style.display = 'none';

        // Add fallback for icon load error
        icon.onerror = () => {
            icon.style.display = 'none';
        };
    }

    async connectWallet() {
        if (!this.selectedWallet || !this.provider) {
            throw new Error('Please select a wallet first');
        }

        this.statusMessage.update(this.statusMessages.CONNECTING);
        
        try {
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
            
            if (accounts && accounts[0]) {
                this.connected = true;
                this.connectedAddress = accounts[0];
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Remove the wallet selection display completely
                const selectedWalletDisplay = document.getElementById('selectedWalletDisplay');
                if (selectedWalletDisplay) {
                    selectedWalletDisplay.remove();
                }
                document.getElementById('continuePrompt')?.remove();
                document.getElementById('selectWallet')?.remove();
                
                // Skip verification and show trading interface directly
                await this.showTradingInterface();
                
                return this.connectedAddress;
            } else {
                throw new Error('No accounts found');
            }
        } catch (error) {
            // Show select button again on error
            document.getElementById('selectWallet').style.display = 'block';
            document.getElementById('selectedWalletDisplay').classList.remove('active');
            document.getElementById('continuePrompt').style.display = 'none';
            
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

        const currentPrice = await this.getCurrentPrice();
        const shortAddress = this.connectedAddress.slice(0, 6) + '...' + this.connectedAddress.slice(-4);
        
        // Remove the original status message element
        const originalStatus = document.getElementById('contractStatus');
        if (originalStatus) {
            originalStatus.remove();
        }

        const tradingInterface = document.createElement('div');
        tradingInterface.className = 'trading-interface';
        tradingInterface.innerHTML = `
            <div class="trading-container">
                <div class="curve-display">
                    <canvas id="curveChart"></canvas>
                </div>
                <div class="swap-interface">
                    <h2>CULT EXECS</h2>
                    <div class="price-info">
                        <div class="price-display">
                            <span class="current-price">0.0025ETH/1M</span>
                        </div>
                        <div class="connection-status">
                            <span class="status-message" id="contractStatus">CONNECTION ESTABLISHED: ${shortAddress}</span>
                        </div>
                    </div>
                    <div class="swap-module">
                        <div class="quick-fill-buttons">
                            <button class="quick-fill eth-fill" data-value="0.0025">0.0025</button>
                            <button class="quick-fill eth-fill" data-value="0.005">0.005</button>
                            <button class="quick-fill eth-fill" data-value="0.01">0.01</button>
                            <button class="quick-fill eth-fill" data-value="0.1">0.1</button>
                            <button class="quick-fill exec-fill hidden" data-value="25">25%</button>
                            <button class="quick-fill exec-fill hidden" data-value="50">50%</button>
                            <button class="quick-fill exec-fill hidden" data-value="75">75%</button>
                            <button class="quick-fill exec-fill hidden" data-value="100">100%</button>
                        </div>
                        <div class="input-group">
                            <input type="number" id="ethAmount" placeholder="0.0" autofocus>
                            <span class="currency-label">ETH</span>
                        </div>
                        <button class="swap-arrow-button"><span class="arrow">↓</span></button>
                        <div class="input-group">
                            <input type="number" id="execAmount" placeholder="0.0">
                            <span class="currency-label">EXEC</span>
                        </div>
                        <button id="swapButton" class="swap-button">BUY EXEC</button>
                    </div>
                </div>
            </div>
            
            <!-- Mobile Tab Controls -->
            <div class="mobile-tabs">
                <button class="tab-button active" data-view="curve">Price Curve</button>
                <button class="tab-button" data-view="swap">Swap</button>
            </div>
        `;

        const bondingInterface = document.getElementById('bondingCurveInterface');
        bondingInterface.innerHTML = '';
        bondingInterface.appendChild(tradingInterface);
        bondingInterface.style.display = 'block';
        bondingInterface.classList.add('active');
        
        // Initialize the curve chart
        requestAnimationFrame(() => {
            this.initializeCurveChart(currentPrice);
            this.setupSwapListeners();
        });

        // After adding the interface to the DOM
        if (window.innerWidth <= 768) {
            this.setupMobileTabbing();
            // Remove the forced swap interface visibility
            // document.querySelector('.swap-interface').classList.add('active');
        }

        // Restore system status panel
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            const statsPanel = document.createElement('div');
            statsPanel.className = 'panel stats-panel';
            statsPanel.innerHTML = `
                <h2>3) SYSTEM STATUS | SYS</h2>
                <div class="stats-content">
                    <p>NETWORK: <span class="status-indicator">CONNECTED</span></p>
                    <p>CHAIN ID: <span>1 (ETHEREUM)</span></p>
                    <p>BLOCK: <span>19,234,567</span></p>
                    <p>LAST UPDATE: <span>2024-03-14 19:32</span></p>
                    <p>API STATUS: <span class="status-indicator">ACTIVE</span></p>
                    <p>CACHE: <span class="status-indicator">SYNCED</span></p>
                    <p>TOTAL CHECKS: <span>1,234</span></p>
                    <p>SUCCESS RATE: <span>99.9%</span></p>
                </div>
            `;
            chatPanel.parentNode.replaceChild(statsPanel, chatPanel);
        }

        // Replace the checker panel with the chat interface
        const checkerPanel = document.querySelector('.checker-panel');
        if (checkerPanel) {
            const chatInterface = document.createElement('div');
            chatInterface.className = 'chat-panel';
            chatInterface.innerHTML = `
                <div class="chat-header">
                    <h2>EXEC INSIDER BULLETIN</h2>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <!-- Messages will be populated here -->
                </div>
                <div class="chat-status">
                    <span>MESSAGES LOADED FROM CHAIN</span>
                    <span class="message-count">0</span>
                </div>
            `;
            checkerPanel.parentNode.replaceChild(chatInterface, checkerPanel);
        }

        //update the tabs active
        document.querySelector('#whitelistTab').classList.remove('active');
        document.querySelector('#presaleTab').classList.add('active');

        // Initialize the chat messages
        await this.loadChatMessages();
    }

    async getCurrentPrice() {
        // Implement contract call to get current price
        return 0.0025; // Example price
    }

    async initializeCurveChart(currentPrice) {
        const canvas = document.getElementById('curveChart');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Set styles
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        
        // Simple quadratic curve function
        const curve = (x) => {
            return Math.pow(x, 1.5); // Slightly gentler curve
        }
        
        // Draw main curve
        ctx.beginPath();
        const startX = canvas.width * 0.1;
        const startY = canvas.height * 0.9;
        ctx.moveTo(startX, startY);
        
        const points = 100;
        const curvePoints = []; // Store points for later use
        
        for (let i = 0; i <= points; i++) {
            const x = i / points;
            const y = curve(x);
            
            const canvasX = x * canvas.width * 0.8 + canvas.width * 0.1;
            const canvasY = canvas.height * 0.9 - y * canvas.height * 0.8;
            
            curvePoints.push({ x: canvasX, y: canvasY });
            ctx.lineTo(canvasX, canvasY);
        }
        
        ctx.stroke();
        
        // Draw current position indicator
        // Let's say we're at 20% of the curve
        const currentPosition = 0.2;
        const segmentSize = 0.1; // Size of highlighted segment
        
        // Find the points around our current position
        const startIndex = Math.floor(currentPosition * points);
        const endIndex = Math.floor((currentPosition + segmentSize) * points);
        
        // Draw highlighted segment
        ctx.beginPath();
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 4; // Slightly thicker
        
        // Start slightly before the current position
        ctx.moveTo(curvePoints[startIndex].x, curvePoints[startIndex].y);
        
        // Draw the highlighted segment
        for (let i = startIndex; i <= endIndex; i++) {
            ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
        }
        
        ctx.stroke();
        
        // Draw the indicator dot at the center of the highlighted segment
        const centerIndex = Math.floor((startIndex + endIndex) / 2);
        const centerPoint = curvePoints[centerIndex];
        
        ctx.beginPath();
        ctx.arc(centerPoint.x, centerPoint.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#FF0000';
        ctx.fill();
        
        // Add labels with dimmer color
        ctx.fillStyle = '#666666';
        ctx.font = '12px Courier New';
        ctx.fillText('reserve y', 10, 20);
        ctx.fillText('reserve x', canvas.width - 70, canvas.height - 10);
    }

    setupSwapListeners() {
        const ethInput = document.getElementById('ethAmount');
        const execInput = document.getElementById('execAmount');
        const swapButton = document.getElementById('swapButton');

        ethInput.addEventListener('input', (e) => {
            const ethAmount = parseFloat(e.target.value) || 0;
            execInput.value = (ethAmount * 400000).toFixed(2); // Example conversion rate
        });

        execInput.addEventListener('input', (e) => {
            const execAmount = parseFloat(e.target.value) || 0;
            ethInput.value = (execAmount / 400000).toFixed(4); // Example conversion rate
        });

        swapButton.addEventListener('click', () => {
            // Implement swap functionality
            console.log('Swap clicked:', {
                eth: ethInput.value,
                exec: execInput.value
            });
        });
    }

    setupMobileTabbing() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const curveDisplay = document.querySelector('.curve-display');
        const swapInterface = document.querySelector('.swap-interface');

        // Set initial state
        curveDisplay.classList.add('active');
        swapInterface.classList.remove('active');
        
        // Set initial active tab
        tabButtons.forEach(b => b.classList.remove('active'));
        const curveTab = Array.from(tabButtons).find(b => b.dataset.view === 'curve');
        if (curveTab) curveTab.classList.add('active');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Update active tab
                tabButtons.forEach(b => b.classList.remove('active'));
                button.classList.add('active');

                // Show/hide appropriate view
                if (button.dataset.view === 'curve') {
                    curveDisplay.classList.add('active');
                    swapInterface.classList.remove('active');
                    // Redraw curve AFTER setting display classes
                    this.initializeCurveChart(this.getCurrentPrice());
                } else {
                    swapInterface.classList.add('active');
                    curveDisplay.classList.remove('active');
                }
            });
        });
    }

    // Add new method to handle chat messages
    async loadChatMessages() {
        try {
            // Here you would fetch messages from your smart contract
            // For now we'll just show a placeholder
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = `
                <div class="message">
                    <span class="message-address">0x1234...5678</span>
                    <span class="message-time">19:32</span>
                    <p class="message-content">First message on EXEC chain</p>
                </div>
            `;
        } catch (error) {
            console.error('Error loading chat messages:', error);
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
}

export default Web3Handler; 

function initializeSwapInterface() {
    const ethAmount = document.getElementById('ethAmount');
    const execAmount = document.getElementById('execAmount');
    const swapArrowButton = document.querySelector('.swap-arrow-button');
    const swapButton = document.getElementById('swapButton');
    const ethFillButtons = document.querySelectorAll('.eth-fill');
    const execFillButtons = document.querySelectorAll('.exec-fill');
    let isEthToExec = true; // Track the current swap direction

    // Update the arrow button HTML to include a span for rotation
    swapArrowButton.innerHTML = '<span class="arrow">↓</span>';

    // Set initial focus
    ethAmount.focus();

    // Handle quick fill buttons
    ethFillButtons.forEach(button => {
        button.addEventListener('click', () => {
            ethAmount.value = button.dataset.value;
            updateExecAmount(); // You'll need to implement this based on your conversion rate
        });
    });

    execFillButtons.forEach(button => {
        button.addEventListener('click', () => {
            const percentage = parseInt(button.dataset.value);
            // Implement max balance calculation here
            execAmount.value = (maxBalance * percentage / 100).toFixed(6);
            updateEthAmount(); // You'll need to implement this based on your conversion rate
        });
    });

    // Handle swap button
    swapArrowButton.addEventListener('click', () => {
        isEthToExec = !isEthToExec; // Toggle direction
        swapArrowButton.classList.toggle('flipped');

        // Swap input values
        const tempValue = ethAmount.value;
        ethAmount.value = execAmount.value;
        execAmount.value = tempValue;

        // Swap IDs
        const tempId = ethAmount.id;
        ethAmount.id = execAmount.id;
        execAmount.id = tempId;

        // Swap labels
        const labels = document.querySelectorAll('.currency-label');
        const tempLabel = labels[0].textContent;
        labels[0].textContent = labels[1].textContent;
        labels[1].textContent = tempLabel;

        // Toggle quick fill buttons
        document.querySelectorAll('.eth-fill').forEach(btn => btn.classList.toggle('hidden'));
        document.querySelectorAll('.exec-fill').forEach(btn => btn.classList.toggle('hidden'));

        // Update swap button text
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';

        // Focus the top input
        document.querySelector('.input-group input').focus();
    });

    // Update the swap button text when values change
    ethAmount.addEventListener('input', () => {
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';
    });

    execAmount.addEventListener('input', () => {
        swapButton.textContent = isEthToExec ? 'BUY EXEC' : 'SELL EXEC';
    });
}

// Call this function after your DOM is loaded
document.addEventListener('DOMContentLoaded', initializeSwapInterface); 