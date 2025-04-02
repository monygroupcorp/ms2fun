import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { TransactionOptions } from '../TransactionOptions/TransactionOptions.js';
import MessagePopup from '../MessagePopup/MessagePopup.js';
import { eventBus } from '../../core/EventBus.js';
import PriceDisplay  from '../PriceDisplay/PriceDisplay.js';

export default class SwapInterface extends Component {
    constructor(blockchainService) {
        super();
        this.blockchainService = blockchainService;
        this.store = tradingStore;
        this.state = {
            direction: 'buy',
            ethAmount: '',
            execAmount: '',
            activeInput: null,
            freeMint: false,
            freeSupply: 0,
            calculatingAmount: false,
            liquidityPool: null
        };
        
        // Initialize child components
        this.transactionOptions = new TransactionOptions();
        this.messagePopup = new MessagePopup('status-message');
        this.priceDisplay = new PriceDisplay();
        this.messagePopup.initialize();
        
        // Debounce timer
        this.calculateTimer = null;
        
        // Bind event handlers
        this.handleTransactionEvents = this.handleTransactionEvents.bind(this);
        this.handleBalanceUpdate = this.handleBalanceUpdate.bind(this);
        
        // Add handler for transaction options updates
        this.handleTransactionOptionsUpdate = this.handleTransactionOptionsUpdate.bind(this);
        
        // Add transaction options state to SwapInterface
        this.transactionOptionsState = {
            message: '',
            nftMintingEnabled: false
        };
    }

    // Add new method to handle balance updates
    handleBalanceUpdate() {
        // Update only the balance displays without full re-render
        const balances = this.store.selectBalances();
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();

        const { freeSupply, freeMint } = this.store.selectFreeSituation();
        console.log('handleBalanceUpdate freeMint', freeMint);
        this.freeMint = freeMint;
        this.freeSupply = freeSupply;

        // Update all balance displays
        const balanceDisplays = this.element.querySelectorAll('.token-balance');
        balanceDisplays.forEach(display => {
            const isEthBalance = display.previousElementSibling.textContent.includes('ETH');
            display.textContent = `Balance: ${isEthBalance ? formattedEthBalance : formattedExecBalance}`;
        });
    }

    updateElements() {
        const { activeInput, calculatingAmount, direction } = this.state;
        
        // Update inactive input
        if (activeInput === 'top') {
            const bottomInput = this.element.querySelector('.bottom-input');
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.execAmount : this.state.ethAmount);
            }
        } else if (activeInput === 'bottom') {
            const topInput = this.element.querySelector('.top-input');
            if (topInput && !topInput.matches(':focus')) {
                topInput.value = calculatingAmount ? 'Loading...' : 
                    (direction === 'buy' ? this.state.ethAmount : this.state.execAmount);
            }
        }

        // Update action button
        const actionButton = this.element.querySelector('.swap-button');
        if (actionButton) {
            actionButton.textContent = this.state.direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC';
        }
    }

    async calculateSwapAmount(amount, inputType) {
        // Handle empty or invalid input
        if (!amount || isNaN(parseFloat(amount))) {
            return '';
        }

        try {
            if (inputType === 'eth') {
                // Calculate how much EXEC user will receive for their ETH
                const execAmount = await this.blockchainService.getExecForEth(amount);

                // Check if user is eligible for free mint
                const { freeSupply, freeMint } = this.store.selectFreeSituation();
                console.log('calculateSwapAmount freeMint', freeMint);
                // If free supply is available and user hasn't claimed their free mint
                const freeMintBonus = (freeSupply > 0 && !freeMint) ? 1000000 : 0;
                
                // Round down to ensure we don't exceed maxCost
                return Math.floor(execAmount + freeMintBonus).toString();
            } else {
                // Calculate how much ETH user will receive for their EXEC
                const ethAmount = await this.blockchainService.getEthForExec(amount);
                // Reduce the minRefund slightly (0.1% less) to account for any calculation differences
                // This ensures we stay above the actual minRefund requirement

                //update lets do this tailoring amount at the contract call in handle sawp
                return ethAmount.toString();//(parseFloat(ethAmount) * 0.999).toFixed(18); // Use more decimals for precision
            }
        } catch (error) {
            console.error('Error calculating swap amount:', error);
            return '';
        }
    }

    async loadUniswapWidget() {
        console.log('Starting Uniswap interface load...');
        try {
            await this.renderUniswapIframe();
        } catch (error) {
            console.error('Failed to load Uniswap interface:', error);
            const container = this.element.querySelector('.swap-container');
            if (container) {
                container.innerHTML = `
                    <div class="widget-error">
                        Failed to load Uniswap interface. Please try refreshing the page.
                        <br>
                        Error: ${error.message || 'Unknown error'}
                    </div>
                `;
            }
        }
    }

    async renderUniswapIframe() {
        const container = this.element.querySelector('.swap-container');
        if (!container) {
            console.error('Swap container not found');
            return;
        }

        console.log('Rendering Uniswap iframe');
        
        // Get contract address
        const { ca } = this.store.selectContracts();
        if (!ca) {
            console.error('Contract address not found');
            return;
        }

        // Get the current provider and ensure we're connected
        const provider = window.ethereum;
        if (provider) {
            try {
                // Request accounts first
                await provider.request({ method: 'eth_requestAccounts' });
                const chainId = await provider.request({ method: 'eth_chainId' });
                
                // Construct iframe URL with our token and chain
                const uniswapUrl = new URL('https://app.uniswap.org/#/swap');
                uniswapUrl.searchParams.set('outputCurrency', ca);
                uniswapUrl.searchParams.set('chain', parseInt(chainId, 16));

                console.log('Loading Uniswap with URL:', uniswapUrl.toString());

                container.innerHTML = `
                    <iframe
                        src="${uniswapUrl.toString()}"
                        height="660px"
                        width="100%"
                        style="
                            border: 0;
                            margin: 0 auto;
                            display: block;
                            border-radius: 10px;
                            max-width: 600px;
                            min-width: 300px;
                            background: transparent;
                        "
                        title="Uniswap Interface"
                    ></iframe>
                `;

                // Try to inject provider into iframe
                const iframe = container.querySelector('iframe');
                iframe.onload = () => {
                    if (window.ethereum) {
                        try {
                            // Send only the necessary provider information
                            iframe.contentWindow.postMessage({
                                type: 'ETHEREUM_PROVIDER_INJECTED',
                                // Send only the necessary properties
                                providerInfo: {
                                    chainId,
                                    selectedAddress: provider.selectedAddress,
                                    isConnected: provider.isConnected(),
                                    networkVersion: provider.networkVersion
                                }
                            }, '*');
                        } catch (error) {
                            console.warn('Failed to send provider info to iframe:', error);
                        }
                    }
                };
            } catch (error) {
                console.error('Failed to setup provider:', error);
                container.innerHTML = `
                    <div class="widget-error">
                        Failed to connect wallet. Please ensure your wallet is connected.
                        <br>
                        Error: ${error.message || 'Unknown error'}
                    </div>
                `;
            }
        } else {
            console.error('No provider found');
            container.innerHTML = `
                <div class="widget-error">
                    No Web3 provider found. Please install a Web3 wallet.
                </div>
            `;
        }
    }

    async onMount() {
        // Check initial liquidity pool status
        const contractData = this.store.selectContractData();
        console.log('SwapInterface - Initial Liquidity Pool:', contractData.liquidityPool);
        this.setState({ liquidityPool: contractData.liquidityPool });

        // Subscribe to contract data updates
        eventBus.on('contractData:updated', () => {
            const contractData = this.store.selectContractData();
            console.log('SwapInterface - Contract Data Updated, New Liquidity Pool:', contractData.liquidityPool);
            
            if (contractData.liquidityPool !== this.state.liquidityPool) {
                this.setState({ liquidityPool: contractData.liquidityPool });
                
                if (this.isLiquidityDeployed()) {
                    console.log('SwapInterface - Switching to Uniswap Widget');
                    this.loadUniswapWidget();
                }
            }
        });

        if (this.isLiquidityDeployed()) {
            console.log('SwapInterface - Loading Uniswap Widget');
            await this.loadUniswapWidget();
        } else {
            console.log('SwapInterface - Setting up bonding curve interface');
            // Original bonding curve swap interface
            this.bindEvents();
            
            // Mount transaction options
            const optionsContainer = this.element.querySelector('.transaction-options-container');
            if (optionsContainer) {
                this.transactionOptions.mount(optionsContainer);
            }
            this.priceDisplay.mount(this.element.querySelector('.price-display-container'));

            // Subscribe to events
            eventBus.on('transaction:pending', this.handleTransactionEvents);
            eventBus.on('transaction:confirmed', this.handleTransactionEvents);
            eventBus.on('transaction:success', this.handleTransactionEvents);
            eventBus.on('transaction:error', this.handleTransactionEvents);
            eventBus.on('balances:updated', this.handleBalanceUpdate);
            eventBus.on('transactionOptions:update', this.handleTransactionOptionsUpdate);
        }
    }

    isLiquidityDeployed() {
        return this.state.liquidityPool && 
               this.state.liquidityPool !== '0x0000000000000000000000000000000000000000';
    }

    onUnmount() {
        // Clean up all event listeners
        eventBus.off('contractData:updated');
        eventBus.off('transaction:pending', this.handleTransactionEvents);
        eventBus.off('transaction:confirmed', this.handleTransactionEvents);
        eventBus.off('transaction:success', this.handleTransactionEvents);
        eventBus.off('transaction:error', this.handleTransactionEvents);
        eventBus.off('balances:updated', this.handleBalanceUpdate);
        eventBus.off('transactionOptions:update', this.handleTransactionOptionsUpdate);

        // Unmount child components if they exist
        if (this.transactionOptions) {
            this.transactionOptions.unmount();
        }
        if (this.priceDisplay) {
            this.priceDisplay.unmount();
        }
    }

    handleTransactionEvents(event) {
        console.log('handleTransactionEvents called with:', {
            event,
            eventType: event?.type,
            hasError: !!event?.error,
            hasHash: !!event?.hash,
            stack: new Error().stack
        });
        
        const direction = this.state.direction === 'buy' ? 'Buy' : 'Sell';

        // Check if this is a transaction event
        if (!event || !event.type) {
            console.warn('Invalid transaction event:', event);
            return;
        }

        // For transaction events - only show if it's not an error
        if ((event.type === 'buy' || event.type === 'sell') && !event.error) {
            console.log('Showing transaction submitted message for type:', event.type);
            this.messagePopup.info(
                `${direction} transaction. Simulating...`,
                'Transaction Pending'
            );
        }

        // For confirmed transactions
        if (event.hash) {
            this.messagePopup.info(
                `Transaction confirmed, waiting for completion...`,
                'Transaction Confirmed'
            );
        }

        // For successful transactions
        if (event.receipt && (event.type == 'buy' || event.type == 'sell')) {
            const amount = this.state.direction === 'buy' 
                ? this.state.execAmount + ' EXEC'
                : this.state.ethAmount + ' ETH';
                
            this.messagePopup.success(
                `Successfully ${direction.toLowerCase() == 'buy' ? 'bought' : 'sold'} ${amount}`,
                'Transaction Complete'
            );

            // Clear inputs after successful transaction
            this.setState({
                ethAmount: '',
                execAmount: '',
                calculatingAmount: false
            });

            // Re-mount child components after state update
            const optionsContainer = this.element.querySelector('.transaction-options-container');
            const priceContainer = this.element.querySelector('.price-display-container');
            
            if (optionsContainer) {
                this.transactionOptions.mount(optionsContainer);
            }
            
            if (priceContainer) {
                this.priceDisplay.mount(priceContainer);
            }
        }

        // For error transactions
        if (event.error && !event.handled) {
            console.log('Handling error in handleTransactionEvents:', event.error);
            
            let errorMessage = event.error?.message || 'Transaction failed';
            
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            const context = this.state.direction === 'buy' ? 
                'Buy Failed' : 
                'Sell Failed';
            
            this.messagePopup.error(
                `${context}: ${errorMessage}`,
                'Transaction Failed'
            );

            event.handled = true;
        }
    }

    handleTransactionOptionsUpdate(options) {
        this.transactionOptionsState = {
            message: options.message,
            nftMintingEnabled: options.nftMintingEnabled
        };
    }

    handleInput(inputType, value) {
        // Clear any existing timer
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        // Update state immediately to show we're calculating
        this.state.activeInput = inputType;
        if (this.state.direction === 'buy') {
            if (inputType === 'top') {
                this.state.ethAmount = value;
            } else {
                this.state.execAmount = value;
            }
        } else {
            if (inputType === 'top') {
                this.state.execAmount = value;
            } else {
                this.state.ethAmount = value;
            }
        }
        this.state.calculatingAmount = true;
        this.updateElements();

        // Set debounced calculation
        this.calculateTimer = setTimeout(async () => {
            try {
                const isEthInput = (this.state.direction === 'buy') === (inputType === 'top');
                const calculatedAmount = await this.calculateSwapAmount(value, isEthInput ? 'eth' : 'exec');
                
                // Update the opposite input after calculation
                if (isEthInput) {
                    this.state.execAmount = calculatedAmount;
                } else {
                    this.state.ethAmount = calculatedAmount;
                }
                this.state.calculatingAmount = false;
                this.updateElements();
            } catch (error) {
                console.error('Error calculating swap amount:', error);
                this.state.calculatingAmount = false;
                this.updateElements();
            }
        }, 750);
    }

    events() {
        return {
            'input .top-input': (e) => this.handleInput('top', e.target.value),
            'input .bottom-input': (e) => this.handleInput('bottom', e.target.value),
            'click .direction-switch': (e) => this.handleDirectionSwitch(e),
            'click .swap-button': (e) => this.handleSwap(),
            'click [data-amount]': (e) => this.handleQuickFill(e),
            'click [data-percentage]': (e) => this.handleQuickFill(e)
        };
    }

    handleDirectionSwitch(e) {
        // Prevent default button behavior and stop propagation
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // Clear any pending calculations
        if (this.calculateTimer) {
            clearTimeout(this.calculateTimer);
        }

        const newDirection = this.state.direction === 'buy' ? 'sell' : 'buy';
        

        console.log('Direction Switch - Current State:', {
            direction: this.state.direction,
            newDirection,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply
        });

        // Store current values but DON'T swap them
        // Just change the direction
        this.state = {
            ...this.state,
            direction: newDirection,
            calculatingAmount: false,
            activeInput: null
        };

        this.store.setDirection(newDirection === 'buy');

        console.log('Direction Switch - Updated State:', {
            direction: this.state.direction,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply
        });

        // Unbind events before updating content
        this.unbindEvents();
        
        // Force full re-render
        const newContent = this.render();
        this.element.innerHTML = newContent;
        
        // Re-mount both transaction options and price display
        const optionsContainer = this.element.querySelector('.transaction-options-container');
        const priceContainer = this.element.querySelector('.price-display-container');
        
        if (optionsContainer) {
            this.transactionOptions.mount(optionsContainer);
        }
        
        if (priceContainer) {
            this.priceDisplay.mount(priceContainer);
        }
        
        // Rebind events
        this.bindEvents();
    }

    async handleSwap() {
        try {
            // Remove any commas from execAmount and convert to string
            const cleanExecAmount = this.state.execAmount.replace(/,/g, '');
            
            // Get merkle proof with proper error handling
            let proof;
            try {
                const currentTier = await this.blockchainService.getCurrentTier();
                proof = await this.blockchainService.getMerkleProof(
                    await this.store.selectConnectedAddress(),
                    currentTier
                );
                
                if (!proof) {
                    this.messagePopup.error(
                        `You are not whitelisted for Tier ${currentTier + 1}. Please wait for your tier to be activated.`,
                        'Not Whitelisted'
                    );
                    return;
                }
            } catch (error) {
                this.messagePopup.error(
                    'Failed to verify whitelist status. Please try again later.',
                    'Whitelist Check Failed'
                );
                return;
            }

            // If buying and eligible for free mint, subtract the bonus amount before sending transaction
            let adjustedExecAmount = cleanExecAmount;
            if (this.state.direction === 'buy') {
                const { freeSupply, freeMint } = this.store.selectFreeSituation();
                console.log('handle swap freeSupply, freeMint', freeSupply, freeMint);
                if (freeSupply > 0 && !freeMint) {
                    // Subtract 1,000,000 from the amount since contract will add it automatically
                    const numAmount = parseInt(cleanExecAmount);
                    adjustedExecAmount = Math.max(0, numAmount - 1000000).toString();
                }
            }

            // Parse amounts with proper decimal handling for contract interaction
            const ethValue = this.blockchainService.parseEther(this.state.ethAmount);
            const execAmount = this.blockchainService.parseExec(adjustedExecAmount);

            if (this.state.direction === 'buy') {
                await this.blockchainService.buyBonding({
                    amount: execAmount,      // Will be like "1000000000000000000000000" for 1M EXEC
                    maxCost: ethValue,       // Will be like "2500000000000000" for 0.0025 ETH
                    mintNFT: this.transactionOptionsState.nftMintingEnabled,
                    proof: proof.proof,
                    message: this.transactionOptionsState.message
                }, ethValue);
            } else {
                // For sells, we calculate minRefund as slightly less than the expected return
                const minReturn = BigInt(ethValue) * BigInt(999) / BigInt(1000); // 0.1% less
                console.log('handleSwap minReturn', minReturn);
                await this.blockchainService.sellBonding({
                    amount: execAmount,      // Will be like "1000000000000000000000000" for 1M EXEC
                    minReturn: minReturn,     // Will be like "2500000000000000" for 0.0025 ETH
                    proof: proof.proof,
                    message: this.transactionOptionsState.message
                });
            }
        } catch (error) {
            console.error('Swap failed:', error);
            
            // Clean up the error message but preserve the Tx Reverted prefix
            let errorMessage = error.message;
            if (errorMessage.includes('Contract call')) {
                const parts = errorMessage.split(': ');
                errorMessage = parts[parts.length - 1];
            }
            
            // Add context based on the operation
            const context = this.state.direction === 'buy' ? 
                'Buy Failed' : 
                'Sell Failed';
            
            this.messagePopup.error(
                `${context}: ${errorMessage}`,
                'Transaction Failed'
            );
        }
    }

    handleQuickFill(e) {
        e.preventDefault();
        
        const amount = e.target.dataset.amount;
        const percentage = e.target.dataset.percentage;
        
        let value;
        
        if (amount) {
            // Direct amount fill
            value = amount;
        } else if (percentage) {
            // Percentage of balance (only used for selling EXEC)
            const balances = this.store.selectBalances();
            const execBalance = balances.exec;
            
            if (!execBalance || execBalance === '0') {
                console.warn('No EXEC balance available for quick fill');
                return;
            }

            // Convert from full decimal representation to human-readable number first
            let readableBalance = BigInt(execBalance) / BigInt(1e18);
            
            // If user has free mint, subtract 1M from available balance
            if (this.freeMint) {
                readableBalance = readableBalance - BigInt(1000000);    
                // Check if there's any sellable balance after subtracting free mint
                if (readableBalance <= 0) {
                    this.messagePopup.info(
                        'You only have free mint tokens which cannot be sold.',
                        'Cannot Quick Fill'
                    );
                    return;
                }
            }

            // Calculate percentage of sellable balance
            const amount = (readableBalance * BigInt(percentage)) / BigInt(100);
            value = amount.toString();
        }

        // Update the top input with the new value
        this.handleInput('top', value);
        
        // Update the input element directly
        const topInput = this.element.querySelector('.top-input');
        if (topInput) {
            topInput.value = value;
        }
    }

    render() {
        if (this.isLiquidityDeployed()) {
            return `
                <div class="swap-container">
                    <div class="loading-widget">Loading Uniswap widget...</div>
                </div>
            `;
        }

        // Original bonding curve swap interface render
        const { direction, ethAmount, execAmount, calculatingAmount } = this.state;

        console.log('Render - Current State:', {
            direction,
            freeMint: this.state.freeMint,
            freeSupply: this.state.freeSupply,
            condition: `direction === 'sell' && this.freeMint = ${direction === 'sell' && this.freeMint}`
        });
        
        const balances = this.store.selectBalances();
        
        // Format balances with appropriate decimals
        const formattedEthBalance = parseFloat(balances.eth).toFixed(6);
        const formattedExecBalance = parseInt(balances.exec).toLocaleString();
        // Calculate available balance for selling
        const availableExecBalance = direction === 'sell' && this.freeMint
        ? `Available: ${(parseInt(balances.exec) - 1000000).toLocaleString()}`
        : `Balance: ${formattedExecBalance}`;
        
        return `
            <div class="price-display-container"></div>
            ${direction === 'sell' && this.freeMint ? 
                `<div class="free-mint-notice">
                    You have 1,000,000 $EXEC you received for free that cannot be sold here.
                </div>` 
                : direction === 'buy' && this.freeSupply > 0 && !this.freeMint ?
                `<div class="free-mint-notice free-mint-bonus">
                    1,000,000 $EXEC will be added to your purchase. Thank you.
                </div>`
                : ''
            }
            <div class="quick-fill-buttons">
                ${direction === 'buy' ? 
                    `<button data-amount="0.0025">0.0025</button>
                    <button data-amount="0.01">0.01</button>
                    <button data-amount="0.05">0.05</button>
                    <button data-amount="0.1">0.1</button>`
                :
                    `<button data-percentage="25">25%</button>
                    <button data-percentage="50">50%</button>
                    <button data-percentage="75">75%</button>
                    <button data-percentage="100">100%</button>`
                }
            </div>
            <div class="swap-inputs">
                <div class="input-container">
                    <input type="text" 
                           class="top-input" 
                           value="${direction === 'buy' ? ethAmount : execAmount}" 
                           placeholder="0.0"
                           pattern="^[0-9]*[.]?[0-9]*$">
                    <div class="token-info">
                        <span class="token-symbol">${direction === 'buy' ? 'ETH' : '$EXEC'}</span>
                        <span class="token-balance">Balance: ${direction === 'buy' ? formattedEthBalance : availableExecBalance}</span>
                    </div>
                </div>
                <button class="direction-switch">↑↓</button>
                <div class="input-container">
                    <input type="text" 
                           class="bottom-input" 
                           value="${direction === 'buy' ? execAmount : ethAmount}" 
                           placeholder="0.0"
                           pattern="^[0-9]*[.]?[0-9]*$">
                    <div class="token-info">
                        <span class="token-symbol">${direction === 'buy' ? '$EXEC' : 'ETH'}</span>
                        <span class="token-balance">Balance: ${direction === 'buy' ? formattedExecBalance : formattedEthBalance}</span>
                    </div>
                </div>
            </div>
            <div class="transaction-options-container"></div>
            <button class="swap-button">
                ${direction === 'buy' ? 'Buy $EXEC' : 'Sell $EXEC'}
            </button>
        `;
    }

    static get styles() {
        return `
            ${super.styles || ''}
            
            .swap-container {
                width: 100%;
                min-height: 660px;
                background: transparent;
                border-radius: 8px;
                padding: 0px;
                box-sizing: border-box;
                overflow: hidden;
            }

            .uniswap-widget {
                width: 100%;
                height: 100%;
                min-height: 560px;
            }

            .widget-error {
                color: #ff4444;
                text-align: center;
                padding: 20px;
                background: #2a2a2a;
                border-radius: 8px;
                margin: 20px 0;
            }

            .loading-widget {
                color: #666;
                text-align: center;
                padding: 20px;
            }

            /* ... rest of the original styles ... */
        `;
    }
}