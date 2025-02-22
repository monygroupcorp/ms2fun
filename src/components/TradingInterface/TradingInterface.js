import { eventBus } from '../../eventBus.js';

class TradingInterface {
    constructor(address, contractHandler, ethers) {
        this.address = address;
        this.contractHandler = contractHandler;
        this.priceUpdateInterval = null;
        this.ethers = ethers;
        // Centralized state
        this.state = {
            isEthToExec: true,
            ethAmount: '',
            execAmount: '',
            showMintOption: false,
            showMessageOption: false,
            transactionMessage: '',
            currentPrice: 0,
            userBalance: {
                eth: 0,
                exec: 0,
                nfts: 0
            }
        };

        // Load initial balances
        this.loadBalances();
        this.lastSwapInterfaceUpdate = 0;  // Add this to track last update time

        // Subscribe to events
        this.unsubscribeHandlers = [
            eventBus.on('trade:executed', this.handleTradeExecuted.bind(this)),
            eventBus.on('wallet:connected', this.handleWalletConnected.bind(this))
        ];
    }

    // State management
    updateState(updates) {
        this.state = { ...this.state, ...updates };
        this.updateUI();
    }

    updateUI() {
        this.updateInputValues();
        this.updateTransactionOptions();
        this.updateBalanceDisplay();
        this.updateSwapButton();
        
        // Add this new method to update the swap interface
        this.updateSwapInterface();
    }

    updateSwapInterface() {
        const swapModule = document.querySelector('.swap-module');
        if (swapModule) {
            // Only update the content that needs to change
            this.updateInputFields(swapModule);
            this.updateQuickFillButtons(swapModule);
            this.updateTransactionOptions();
        }
    }

    updateInputFields(container) {
        // First check if container exists
        if (!container) return;

        // Get all elements with null checks
        const elements = {
            topInput: container.querySelector('#ethAmount'),
            bottomInput: container.querySelector('#execAmount'),
            topLabel: container.querySelector('.input-group:first-child .currency-label'),
            bottomLabel: container.querySelector('.input-group:last-child .currency-label'),
            ethBalanceDisplay: container.querySelector('.eth-balance')
        };

        // Check if required elements exist before updating
        if (elements.topInput && elements.bottomInput) {
            // Update input values only if they're different
            if (elements.topInput.value !== this.state.ethAmount) {
                elements.topInput.value = this.state.ethAmount;
            }
            if (elements.bottomInput.value !== this.state.execAmount) {
                elements.bottomInput.value = this.state.execAmount;
            }
        }

        // Update currency labels if they exist
        if (elements.topLabel) {
            elements.topLabel.textContent = this.state.isEthToExec ? 'ETH' : 'EXEC';
        }
        if (elements.bottomLabel) {
            elements.bottomLabel.textContent = this.state.isEthToExec ? 'EXEC' : 'ETH';
        }

        // Update ETH balance display if it exists
        if (elements.ethBalanceDisplay) {
            if (this.state.isEthToExec) {
                elements.ethBalanceDisplay.textContent = `Balance: ${this.state.userBalance.eth === 0 ? 'Loading...' : this.state.userBalance.eth.toFixed(4)} ETH`;
                elements.ethBalanceDisplay.classList.remove('hidden');
            } else {
                elements.ethBalanceDisplay.classList.add('hidden');
            }
        }
    }

    updateQuickFillButtons(container) {
        const ethFills = container.querySelectorAll('.eth-fill');
        const execFills = container.querySelectorAll('.exec-fill');
        
        // Show/hide appropriate quick fill buttons based on swap direction
        ethFills.forEach(btn => btn.classList.toggle('hidden', !this.state.isEthToExec));
        execFills.forEach(btn => btn.classList.toggle('hidden', this.state.isEthToExec));
    }

    // UI update methods
    updateInputValues() {
        // Simply update the input values without recreating the HTML
        const ethAmount = document.getElementById('ethAmount');
        const execAmount = document.getElementById('execAmount');
        
        // Only update if values are different to avoid triggering unnecessary input events
        if (ethAmount && ethAmount.value !== this.state.ethAmount) {
            ethAmount.value = this.state.ethAmount;
        }
        if (execAmount && execAmount.value !== this.state.execAmount) {
            execAmount.value = this.state.execAmount;
        }
    }

    updateSwapButton() {
        const swapButton = document.getElementById('swapButton');
        if (swapButton) {
            swapButton.textContent = this.state.isEthToExec ? 'BUY EXEC' : 'SELL EXEC';
        }
    }

    updateBalanceDisplay() {
        const balanceInfo = document.querySelector('.balance-info');
        if (balanceInfo) {
            balanceInfo.innerHTML = `
                <span>Balance: ${this.state.userBalance.exec.toLocaleString()} EXEC</span>
                <span>NFTs: ${this.state.userBalance.nfts}</span>
            `;
        }
    }

    // Balance loading
    async loadBalances() {
        try {
            const tokenBalance = await this.contractHandler.getTokenBalance(this.address);
            const nftBalance = await this.contractHandler.getNFTBalance(this.address);
            const ethBalance = await this.contractHandler.provider.getBalance(this.address);
            console.log("ethBalance", parseFloat(this.ethers.utils.formatEther(ethBalance)));
            this.updateState({
                userBalance: {
                    eth: parseFloat(this.ethers.utils.formatEther(ethBalance)),
                    exec: parseInt(tokenBalance),
                    nfts: nftBalance
                }
            });
        } catch (error) {
            console.error('Error loading balances:', error);
        }
    }

    // Price updates
    async updatePrice(container) {
        try {
            const price = await this.contractHandler.getCurrentPrice();
            const priceNum = parseFloat(price.eth/10);
            
            if (isNaN(priceNum)) {
                throw new Error('Invalid price value received');
            }

            this.updateState({ currentPrice: priceNum });

            const priceElement = container ? 
                container.querySelector('#currentPrice') : 
                document.getElementById('currentPrice');

            if (priceElement) {
                priceElement.textContent = `${priceNum.toFixed(4)} ETH/1M EXEC`;
            }
        } catch (error) {
            console.error('Error updating price:', error);
            const priceElement = container ? 
                container.querySelector('#currentPrice') : 
                document.getElementById('currentPrice');
            if (priceElement) {
                priceElement.textContent = 'Price unavailable';
            }
        }
    }

    render() {
        const shortAddress = this.address.slice(0, 6) + '...' + this.address.slice(-4);
        
        const container = document.createElement('div');
        container.className = 'trading-interface';
        container.innerHTML = `
            <div class="trading-container">
                <div class="curve-display">
                    <canvas id="curveChart"></canvas>
                </div>
                <div class="swap-interface">
                    <h2>CULT EXECS</h2>
                    <div class="price-info">
                        <div class="price-display">
                            <span class="current-price" id="currentPrice">Loading...</span>
                        </div>
                        <div class="connection-status">
                            <span class="status-message" id="contractStatus">CONNECTION ESTABLISHED: ${shortAddress}</span>
                        </div>
                    </div>
                    <div class="swap-module">
                        ${this.renderSwapInputs()}
                    </div>
                </div>
            </div>
            
            <!-- Mobile Tab Controls -->
            <div class="mobile-tabs">
                <button class="tab-button active" data-view="curve">Price Curve</button>
                <button class="tab-button" data-view="swap">Swap</button>
            </div>
        `;

        // Setup event listeners only once during initial render
        this.setupEventListeners(container);
        return container;
    }

    renderQuickFillButtons() {
        return `
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
        `;
    }

    renderSwapInputs() {
        // Determine which currency goes where based on swap state
        const topCurrency = this.state.isEthToExec ? 'ETH' : 'EXEC';
        const bottomCurrency = this.state.isEthToExec ? 'EXEC' : 'ETH';
        
        // Add ETH balance display when ETH is the input currency, show loading state if balance is 0
        const ethBalanceDisplay = this.state.isEthToExec ? 
            `<div class="eth-balance">Balance: ${this.state.userBalance.eth === 0 ? 'Loading...' : this.state.userBalance.eth.toFixed(4)} ETH</div>` : '';

        return `
            <div class="user-holdings">
                <div class="balance-info">
                    <span>Balance: ${this.state.userBalance.exec === 0 ? 'Loading...' : this.state.userBalance.exec.toLocaleString()} EXEC</span>
                    <span>NFTs: ${this.state.userBalance.nfts}</span>
                </div>
            </div>
            ${this.renderQuickFillButtons()}
            <div class="input-group">
                <input type="number" id="ethAmount" placeholder="0.0" autofocus>
                <span class="currency-label">${topCurrency}</span>
                ${ethBalanceDisplay}
            </div>
            <button class="swap-arrow-button"><span class="arrow">↓</span></button>
            <div class="input-group">
                <input type="number" id="execAmount" placeholder="0.0">
                <span class="currency-label">${bottomCurrency}</span>
            </div>
            ${this.renderTransactionOptions()}
            <button id="swapButton" class="swap-button">BUY EXEC</button>
        `;
    }

    renderTransactionOptions() {
        return `
            <div class="transaction-options">
                ${this.shouldShowMintOption() ? `
                    <div class="option-group">
                        <input type="checkbox" id="mintNFT">
                        <label for="mintNFT">Mint NFT (Transaction > 1M EXEC)</label>
                    </div>
                ` : ''}
                <div class="option-group">
                    <input type="checkbox" id="leaveMessage">
                    <label for="leaveMessage">Leave a message with transaction</label>
                    <textarea id="transactionMessage" class="hidden" placeholder="Enter your message here..."></textarea>
                </div>
            </div>
        `;
    }

    shouldShowMintOption() {
        // Only show mint option for ETH to EXEC transactions
        if (!this.state.isEthToExec) return false;

        const execAmount = parseFloat(this.state.execAmount || 0);
        
        // If user has no NFTs, check if total balance would be enough
        if (this.state.userBalance.nfts === 0) {
            const totalExec = this.state.userBalance.exec + execAmount;
            return totalExec >= 1000000;
        }
        
        // If user has NFTs, they need a full 1M new EXEC to mint another
        return execAmount >= 1000000;
    }

    checkNFTBalanceWarning() {
        // Only check for warnings when selling EXEC and user has NFTs
        if (this.state.isEthToExec || this.state.userBalance.nfts === 0) return null;

        const execAmount = parseFloat(this.state.execAmount || 0);
        const remainingBalance = this.state.userBalance.exec - execAmount;
        const requiredBalance = this.state.userBalance.nfts * 1000000;

        if (remainingBalance < requiredBalance) {
            return {
                type: 'error',
                message: `Warning: This sale would reduce your balance below ${this.state.userBalance.nfts}M EXEC required to support your NFTs. Please reduce the sale amount or burn NFTs first.`
            };
        }

        return null;
    }

    updateTransactionOptions() {
        
        const transactionOptions = document.querySelector('.transaction-options');
        if (!transactionOptions) return;

        // Update the DOM
        transactionOptions.innerHTML = `
            ${this.checkNFTBalanceWarning()?.message ? `
                <div class="warning-message error">
                    ${this.checkNFTBalanceWarning().message}
                </div>
            ` : ''}
            
            ${this.shouldShowMintOption() ? `
                <div class="option-group">
                    <input type="checkbox" id="mintNFT" 
                        ${this.state.mintOptionChecked ? 'checked' : ''}>
                    <label for="mintNFT">Mint NFT (Transaction > 1M EXEC)</label>
                </div>
            ` : ''}
            
            <div class="option-group">
                <input type="checkbox" id="leaveMessage" 
                    ${this.state.showMessageOption ? 'checked' : ''}>
                <label for="leaveMessage">Leave a message with transaction</label>
                <textarea id="transactionMessage" 
                    class="${this.state.showMessageOption ? '' : 'hidden'}"
                    placeholder="Enter your message here..."
                >${this.state.transactionMessage || ''}</textarea>
            </div>
        `;

        // Attach listeners after DOM update
        this.attachTransactionOptionListeners(transactionOptions);
    }

    attachTransactionOptionListeners(container) {
        console.log("attaching transaction option listeners");
        // Message checkbox
        const messageCheckbox = container.querySelector('#leaveMessage');
        if (messageCheckbox) {
            const handleMessageChange = (e) => {
                const isChecked = e.target.checked;
                console.log("message checkbox changed", isChecked);
                this.updateState({ 
                    showMessageOption: isChecked,
                    transactionMessage: isChecked ? (this.state.transactionMessage || '') : ''
                });
            };
            
            messageCheckbox.removeEventListener('change', handleMessageChange);
            messageCheckbox.addEventListener('change', handleMessageChange);
        }

        // Message textarea with debounce
        const messageArea = container.querySelector('#transactionMessage');
        if (messageArea) {
            let debounceTimeout;
            const handleMessageInput = (e) => {
                // Update the textarea value immediately without triggering state update
                const newValue = e.target.value;
                
                // Clear any existing timeout
                clearTimeout(debounceTimeout);
                
                // Set new timeout for state update
                debounceTimeout = setTimeout(() => {
                    this.updateState({ 
                        transactionMessage: newValue 
                    });
                }, 3000); // 3 second delay
            };
            
            messageArea.removeEventListener('input', handleMessageInput);
            messageArea.addEventListener('input', handleMessageInput);
        }

        // Mint checkbox
        const mintCheckbox = container.querySelector('#mintNFT');
        if (mintCheckbox) {
            const handleMintChange = (e) => {
                this.updateState({ 
                    mintOptionChecked: e.target.checked 
                });
            };
            
            mintCheckbox.removeEventListener('change', handleMintChange);
            mintCheckbox.addEventListener('change', handleMintChange);
        }
    }

    // Update the handleExecInput to include warning checks
    async handleExecInput(value) {
        if (!value || isNaN(value)) {
            this.updateState({
                ethAmount: '',
                execAmount: '',
            });
            return;
        }

        try {
            const execValue = parseFloat(value);
            // Convert to contract format (BigInt string)
            const execAmount = BigInt(Math.floor(execValue)).toString();
            
            // Call contract to calculate cost
            const cost = await this.contractHandler.calculateCost(execAmount);
            // Convert wei to ETH
            const ethValue = parseFloat(this.ethers.utils.formatEther(cost));

            this.updateState({
                execAmount: value,
                ethAmount: ethValue.toFixed(4)
            });
        } catch (error) {
            console.error('Error calculating cost:', error);
            this.updateState({
                ethAmount: '',
                execAmount: value
            });
        }
    }

    handleEthInput(value) {
        if (!value || isNaN(value)) {
            this.updateState({
                ethAmount: '',
                execAmount: ''
            });
            return;
        }

        // For ETH input, we'll still need to estimate EXEC amount
        // This is less precise but gives immediate feedback
        const ethValue = parseFloat(value);
        const execValue = (ethValue * (1000000 / this.state.currentPrice));

        this.updateState({
            ethAmount: value,
            execAmount: execValue.toFixed(2)
        });

        // After setting initial estimate, calculate precise amount
        this.updatePreciseExecAmount(ethValue);
    }

    async updatePreciseExecAmount(ethValue) {
        try {
            // Convert ETH to wei
            const weiValue = this.ethers.utils.parseEther(ethValue.toString());
            // TODO: Add contract method to calculate exact EXEC amount for given ETH input
            // This would require a new view function in the contract
            // For now, we'll keep the estimate
        } catch (error) {
            console.error('Error calculating precise EXEC amount:', error);
        }
    }

    setupEventListeners(container) {
        // Use event delegation for the swap module
        const swapModule = container.querySelector('.swap-module');
        if (swapModule) {
            swapModule.addEventListener('input', (e) => {
                if (e.target.id === 'ethAmount') {
                    this.handleEthInput(e.target.value);
                } else if (e.target.id === 'execAmount') {
                    this.handleExecInput(e.target.value);
                }
            });

            swapModule.addEventListener('click', (e) => {
                // Handle quick fill buttons
                if (e.target.classList.contains('quick-fill')) {
                    const isEth = e.target.classList.contains('eth-fill');
                    this.handleQuickFill(e.target.dataset.value, isEth);
                }
                
                // Handle swap arrow button
                if (e.target.closest('.swap-arrow-button')) {
                    this.handleSwap(container);
                }

                // Handle swap button
                if (e.target.id === 'swapButton') {
                    if (this.state.isEthToExec) {
                        this.handleBuyExec();
                    } else {
                        this.handleSellExec();
                    }
                }
            });
        }

        // Set up one-time event listeners
        this.setupOneTimeListeners(container);
    }

    setupOneTimeListeners(container) {
        // Clean up interval when page is unloaded
        window.addEventListener('unload', () => this.stopPriceUpdates());

        // Start price updates
        this.updatePrice(container);
        this.startPriceUpdates(container);

        // Set up balance update interval
        setInterval(() => this.loadBalances(), 30000);
    }

    handleSwap(container) {
        this.updateState({
            isEthToExec: !this.state.isEthToExec,
            // Swap the input values
            ethAmount: this.state.execAmount,
            execAmount: this.state.ethAmount
        });

        const swapArrowButton = container.querySelector('.swap-arrow-button');
        
        // Handle arrow animation
        swapArrowButton.classList.remove('flipped');
        void swapArrowButton.offsetWidth; // Force reflow
        if (!this.state.isEthToExec) {
            swapArrowButton.classList.add('flipped');
        }

        // Focus the top input
        container.querySelector('.input-group input').focus();
    }

    handleQuickFill(value, isEth) {
        if (isEth) {
            this.handleEthInput(value);
        } else {
            // Handle percentage-based exec fills
            const maxExec = this.state.userBalance.exec;
            const execValue = (maxExec * (parseInt(value) / 100)).toFixed(2);
            this.handleExecInput(execValue);
        }
    }

    calculateExecAmount(percentage) {
        // Implement max balance calculation here
        const maxBalance = 1000000; // Example max balance
        return (maxBalance * percentage / 100).toFixed(6);
    }

    setupMobileTabbing() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const curveDisplay = document.querySelector('.curve-display');
        const swapInterface = document.querySelector('.swap-interface');

        if (window.innerWidth <= 768) {
            curveDisplay.classList.add('active');
            swapInterface.classList.remove('active');
            
            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    tabButtons.forEach(b => b.classList.remove('active'));
                    button.classList.add('active');

                    if (button.dataset.view === 'curve') {
                        curveDisplay.classList.add('active');
                        swapInterface.classList.remove('active');
                    } else {
                        swapInterface.classList.add('active');
                        curveDisplay.classList.remove('active');
                    }
                });
            });
        }
    }

    startPriceUpdates(container) {
        this.updatePrice(container);
        this.priceUpdateInterval = setInterval(() => this.updatePrice(container), 60000);
    }

    stopPriceUpdates() {
        if (this.priceUpdateInterval) {
            clearInterval(this.priceUpdateInterval);
            this.priceUpdateInterval = null;
        }
    }

    async handleBuyExec() {
        if (!this.state.isEthToExec) {
            console.error('Sell functionality not yet implemented');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(this.state.execAmount);
            const ethValue = parseFloat(this.state.ethAmount);
            
            if (isNaN(amount) || isNaN(ethValue) || amount <= 0 || ethValue <= 0) {
                throw new Error('Invalid input amounts');
            }

            // Convert amounts to contract format
            const execAmount = BigInt(Math.floor(amount)).toString();
            const maxCost = BigInt(Math.floor(ethValue * 1e18)).toString();
            
            const proof = await this.contractHandler.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                maxCost: maxCost,
                mintNFT: this.state.mintOptionChecked || false,
                proof: proof,
                message: this.state.transactionMessage || ''
            };

            // Send transaction and get receipt
            const receipt = await this.contractHandler.buyBonding(
                params,
                ethValue
            );

            console.log('Transaction confirmed:', receipt);
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            this.updateState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false,
                mintOptionChecked: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            // Handle error appropriately (you might want to show this to the user)
        }
    }

    async handleSellExec() {
        if (this.state.isEthToExec) {
            console.error('Buy functionality should use handleBuyExec');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(this.state.execAmount);
            const minEthReturn = parseFloat(this.state.ethAmount);
            
            if (isNaN(amount) || isNaN(minEthReturn) || amount <= 0 || minEthReturn <= 0) {
                throw new Error('Invalid input amounts');
            }

            // Check if sale would break NFT requirements
            const warning = this.checkNFTBalanceWarning();
            if (warning) {
                throw new Error(warning.message);
            }

            // Convert amounts to contract format
            const execAmount = BigInt(Math.floor(amount)).toString();
            const minReturn = BigInt(Math.floor(minEthReturn * 1e18)).toString();
            
            const proof = await this.contractHandler.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                minReturn: minReturn,
                proof: proof,
                message: this.state.transactionMessage || ''
            };

            // Send transaction and get receipt
            const receipt = await this.contractHandler.sellBonding(params);

            console.log('Transaction confirmed:', receipt);
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            this.updateState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            // Error is handled by contractHandler
        }
    }

    handleTradeExecuted(tradeData) {
        // Update UI with trade data
        console.log('Trade executed:', tradeData);
    }

    handleWalletConnected(walletAddress) {
        // Update UI with wallet info
        console.log('Wallet connected:', walletAddress);
    }

    cleanup() {
        // Unsubscribe from all events when component is destroyed
        this.unsubscribeHandlers.forEach(unsubscribe => unsubscribe());
    }
}

export default TradingInterface; 