import {Component} from '../../core/Component.js';
import { tradingStore } from '../../store/tradingStore.js';
import { eventBus } from '../../core/EventBus.js';
import priceService from '../../services/PriceService.js';
import { layoutService, LAYOUT_EVENTS } from '../../services/LayoutService.js';
import SwapInterface from '../SwapInterface/SwapInterface.js';

import BondingCurve from '../BondingCurve/BondingCurve.js';

import PortfolioModal from '../PortfolioModal/PortfolioModal.js';

// Add event name constants at the top of the file
const EVENTS = {
    INPUT: {
        ETH_AMOUNT: 'trading:input:ethAmount',
        EXEC_AMOUNT: 'trading:input:execAmount',
        MESSAGE: 'trading:input:message'
    },
    CLICK: {
        QUICK_FILL: 'trading:click:quickFill',
        SWAP: 'trading:click:swap',
        SWAP_BUTTON: 'trading:click:swapButton',
        TAB: 'trading:click:tab'
    },
    CHANGE: {
        MESSAGE_OPTION: 'trading:change:messageOption',
        MINT_OPTION: 'trading:change:mintOption'
    },
    VIEW: {
        CHANGE: 'trading:view:change',
        RESIZE: 'trading:view:resize'
    }
};

export class TradingInterface extends Component {
    constructor(address, blockchainService, ethers, walletConnection) {
        super();
        const {walletAddress, isConnected, networkId} = walletConnection;
        tradingStore.setWalletAddress(walletAddress);
        tradingStore.setWalletConnected(isConnected);
        tradingStore.setWalletNetworkId(networkId);
        
        // Validate required parameters
        if (!blockchainService) throw new Error('BlockchainService is required');
        if (!address) throw new Error('Address is required');
        if (!ethers) throw new Error('Ethers is required');

        // Store instance variables
        this.address = address;
        this.blockchainService = blockchainService;
        this.ethers = ethers;
        this.walletConnection = walletConnection;
        this.state = {
            isPhase2: false, // New state to track phase 2
            activeView: 'swap',
            showNotAllowedOverlay: false,
            currentWhitelistTier: null,
            isMobile: layoutService.getState().isMobile
        };
        
        // Initialize services
        priceService.initialize(blockchainService);

        // Initialize child components
        this.bondingCurve = new BondingCurve();
        this.swapInterface = new SwapInterface(blockchainService, address);
        
        // Single source of truth for layout state
        this.layoutState = {
            isMobile: layoutService.getState().isMobile,
            activeView: 'swap',
            visibleViews: layoutService.getState().isMobile ? ['swap'] : ['swap', 'curve']
        };

        // Initialize store with layout state
        tradingStore.setState({
            view: {
                isMobile: this.layoutState.isMobile,
                showCurve: !this.layoutState.isMobile,
                showSwap: true,
                current: this.layoutState.activeView
            }
        });
        
        tradingStore.updateBalances({
            eth: '0',
            exec: '0',
            nfts: '0'
        });
        
        tradingStore.updatePrice(0);
        tradingStore.updateAmounts('0', '0');
        
        // Bind methods that will be used as callbacks
        this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
        this.handleTradeExecuted = this.handleTradeExecuted.bind(this);
        this.handleWalletConnected = this.handleWalletConnected.bind(this);
        this.handlePriceUpdate = this.handlePriceUpdate.bind(this);
        this.handleLayoutChange = this.handleLayoutChange.bind(this);
        this.handleViewChange = this.handleViewChange.bind(this);
        this.handleTabClick = this.handleTabClick.bind(this);

        // Add portfolio handling
        this.handlePortfolioOpen = this.handlePortfolioOpen.bind(this);
        this.handlePortfolioClose = this.handlePortfolioClose.bind(this);
    }

    async initialize() {
        try {
            // Check phase 2 status from current contract data (if available)
            this.checkPhase2Status();

            // Listen for contract data updates to re-check phase 2 status
            this.unsubscribeContractData = eventBus.on('contractData:updated', () => {
                this.checkPhase2Status();
            });

            // Fetch initial balances and price concurrently
            const [ethAmount, execAmount, nfts, currentPrice, freeSituation, currentTier] = await Promise.all([
                this.blockchainService.getEthBalance(this.address),
                this.blockchainService.getTokenBalance(this.address),
                this.blockchainService.getNFTBalance(this.address),
                this.blockchainService.getCurrentPrice(),
                this.blockchainService.getFreeSituation(this.address),
                this.blockchainService.getCurrentTier()
            ]);

            // Re-check phase 2 status after fetching data (contract data might be loaded by now)
            this.checkPhase2Status();

            const proof = await this.blockchainService.getMerkleProof(this.address, currentTier);
            
            // Only show overlay if: NOT Phase 2 AND no proof
            // If we're in Phase 2, overlay should never show
            if (!this.state.isPhase2 && !proof) {
                this.setState({
                    showNotAllowedOverlay: true,
                    currentWhitelistTier: currentTier
                });
            } else {
                // If we have a valid proof or phase 2 is active, make sure overlay is hidden
                this.setState({ showNotAllowedOverlay: false });
            }

            // Update store with fetched balances
            tradingStore.updateBalances({
                eth: ethAmount,
                exec: execAmount,
                nfts: nfts,
                lastUpdated: Date.now()
            });

            tradingStore.updateFreeSituation(freeSituation);

            // Update store with fetched price
            tradingStore.updatePrice(currentPrice);

            // Set up event listeners
            this.setupEventListeners();

        } catch (error) {
            console.error('Error in initialize:', error);
            const tierText = this.element.querySelector('.tier-text');
            if (tierText) {
                tierText.innerHTML = 'Current Whitelist: Tier ?';
            }
            this.state.currentWhitelistTier = '?'; // Set a fallback value if there's an error
            this.updateViewVisibility();
        }
    }

    checkPhase2Status() {
        const contractData = tradingStore.selectContractData();
        const isPhase2 = contractData && contractData.liquidityPool && contractData.liquidityPool !== '0x0000000000000000000000000000000000000000';
        
        // If we're entering Phase 2, hide the overlay immediately
        if (isPhase2 && this.state.showNotAllowedOverlay) {
            this.setState({ 
                isPhase2,
                showNotAllowedOverlay: false 
            });
        } else {
            this.setState({ isPhase2 });
        }
        
        // Update view visibility to reflect overlay state changes
        if (this.mounted) {
            this.updateViewVisibility();
        }
    }

    setupEventListeners() {
        // Listen for events that affect balances or price
        this.unsubscribeHandlers = [
            eventBus.on('transaction:confirmed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            }),
            
            eventBus.on('account:changed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            }),

            eventBus.on('network:changed', async () => {
                await Promise.all([
                    this.updateBalances(),
                    this.updatePrice()
                ]);
            })
        ];
    }

    async updatePrice() {
        try {
            const currentPrice = await this.blockchainService.getCurrentPrice();
            tradingStore.updatePrice(currentPrice);
        } catch (error) {
            console.error('Error updating price:', error);
        }
    }

    async updateBalances() {
        try {
            const [ethAmount, execAmount, nfts] = await Promise.all([
                this.blockchainService.getEthBalance(this.address),
                this.blockchainService.getTokenBalance(this.address),
                this.blockchainService.getNFTBalance(this.address)
            ]);

            tradingStore.updateBalances({
                eth: ethAmount,
                exec: execAmount,
                nfts: nfts,
                lastUpdated: Date.now()
            });
        } catch (error) {
            console.error('Error updating balances:', error);
        }
    }

    cleanup() {
        console.log('Cleaning up TradingInterface event listeners');
        
        // Unsubscribe from contract data updates
        if (this.unsubscribeContractData) {
            this.unsubscribeContractData();
            this.unsubscribeContractData = null;
        }
        
        // Unsubscribe from all event listeners
        if (this.unsubscribeHandlers) {
            this.unsubscribeHandlers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            });
            this.unsubscribeHandlers = [];
        }
        
        // Explicitly remove event bus listeners
        eventBus.off('transaction:confirmed', this.handleTransactionEvents);
        eventBus.off('transaction:pending', this.handleTransactionEvents);
        eventBus.off('transaction:success', this.handleTransactionEvents);
        eventBus.off('transaction:error', this.handleTransactionEvents);
        eventBus.off('account:changed', this.handleAccountChange);
        eventBus.off('layout:change', this.handleLayoutChange);
        eventBus.off('price:update', this.handlePriceUpdate);
        eventBus.off('portfolio:open', this.handlePortfolioOpen);
        eventBus.off('portfolio:close', this.handlePortfolioClose);
        
        // Remove DOM event listeners
        if (this.element) {
            this.element.removeEventListener('click', this.handleClick);
            this.element.removeEventListener('input', this.handleInput);
            this.element.removeEventListener('change', this.handleChange);
        }
    }

    mount(container) {
        if (this.mounted) return;

        // Manually handle mounting from Component core to avoid initial render
        this.element = container;
        if (this.constructor.styles) {
            const styleElement = document.createElement('style');
            styleElement.textContent = this.constructor.styles;
            document.head.appendChild(styleElement);
            this.styleElement = styleElement;
        }

        const { isMobile } = this.state;
        const html = `
            <div class="trading-interface ${isMobile ? 'mobile' : ''}">
                <div class="tab-navigation">
                    ${isMobile ? `
                        <button class="tab-button" data-view="curve">Bonding Curve</button>
                        <button class="tab-button" data-view="swap">Swap</button>
                    ` : ''}
                    <button class="portfolio-button">Portfolio</button>
                </div>
                <div class="trading-container">
                    <div class="trading-view" data-view="curve"></div>
                    <div class="trading-view" data-view="swap"></div>
                </div>
            </div>
        `;
        this.element.innerHTML = html;

        // Mount children persistently
        const curveContainer = this.element.querySelector('.trading-view[data-view="curve"]');
        this.bondingCurve.mount(curveContainer);
        const swapContainer = this.element.querySelector('.trading-view[data-view="swap"]');
        this.swapInterface.mount(swapContainer);

        this.mounted = true;

        // Initialize layout service first
        layoutService.initialize();
        
        // Setup event listeners
        eventBus.on(LAYOUT_EVENTS.VIEW_CHANGE, this.handleViewChange);
        eventBus.on(LAYOUT_EVENTS.RESIZE, this.handleLayoutChange);
        eventBus.on('portfolio:open', this.handlePortfolioOpen);
        eventBus.on('portfolio:close', this.handlePortfolioClose);

        // Setup tab click listeners
        this.setupTabListeners();
        
        // Setup portfolio button
        this.setupPortfolioButton();

        // Set initial view visibility
        this.updateViewVisibility();

        // Now run async initialization
        this.initialize();
    }

    update() {
        // State changes only affect visibility, not structure.
        this.updateViewVisibility();
    }

    unmount() {
        try {
            console.log('Unmounting TradingInterface');
            
            // Clean up event listeners
            this.cleanup();
            
            // Unmount child components
            if (this.bondingCurve) {
                this.bondingCurve.unmount();
            }
            
            if (this.swapInterface) {
                console.log('Unmounting SwapInterface from TradingInterface');
                this.swapInterface.unmount();
                this.swapInterface = null;
            }
            
            // Unbind any DOM events
            if (this.element) {
                const allButtons = this.element.querySelectorAll('button');
                allButtons.forEach(button => {
                    button.removeEventListener('click', this.handleButtonClick);
                });
                
                const tabButtons = this.element.querySelectorAll('.trading-tab');
                tabButtons.forEach(tab => {
                    tab.removeEventListener('click', this.handleTabClick);
                });
                
                const swapButton = this.element.querySelector('.swap-button');
                if (swapButton) {
                    swapButton.removeEventListener('click', this.handleSwapButton);
                }
                
                const portfolioButton = this.element.querySelector('.portfolio-button');
                if (portfolioButton) {
                    portfolioButton.removeEventListener('click', this.handlePortfolioClick);
                }
            }
            
            // Clear the element HTML
            if (this.element) {
                this.element.innerHTML = '';
                // Remove from DOM 
                if (this.element.parentNode) {
                    this.element.parentNode.removeChild(this.element);
                }
                this.element = null;
            }
            
            console.log('TradingInterface unmounted successfully');
        } catch (error) {
            console.error('Error unmounting TradingInterface:', error);
        }
    }

    handleStoreUpdate(state) {
        if (this.mounted) {
            requestAnimationFrame(() => {
                this.update();
            });
        }
    }

    handleTradeExecuted(tradeData) {
        console.log('Trade executed:', tradeData);
        this.loadBalances();
    }

    handleWalletConnected(walletAddress) {
        this.loadBalances();
    }

    handlePriceUpdate(data) {
        if (typeof data?.price === 'number' && !isNaN(data.price)) {
            tradingStore.setState({ 
                price: {
                    current: data.price,
                    lastUpdated: Date.now()
                }
            });
            
            if (this.mounted) {
                requestAnimationFrame(() => {
                    this.bondingCurve.initializeCurveChart();
                });
            }
        } else {
            console.warn('Invalid price data received:', data);
        }
    }

    handleLayoutChange(layoutState) {
        const isMobile = layoutState.isMobile;
        this.layoutState.isMobile = isMobile;
        this.layoutState.visibleViews = isMobile ? [this.layoutState.activeView] : ['swap', 'curve'];

        this.setState({ isMobile });

        // Update store to match
        tradingStore.setState({
            view: {
                isMobile: this.layoutState.isMobile,
                showCurve: this.shouldShowComponent('curve'),
                showSwap: this.shouldShowComponent('swap'),
                current: this.layoutState.activeView
            }
        });
    }

    handleViewChange(viewState) {


        // Skip if this is a response to our own tab click
        if (viewState.activeTab === this.state.activeView) {
            return;
        }

        this.layoutState.activeView = viewState.activeTab;
        this.layoutState.visibleViews = this.state.isMobile ? 
            [viewState.activeTab] : 
            viewState.visibleViews;

        // Update component state, which will trigger a visibility update
        this.setState({ activeView: viewState.activeTab });

        // Update store
        this.batchUpdate(() => {
            tradingStore.setState({
                view: {
                    isMobile: this.state.isMobile,
                    showCurve: this.shouldShowComponent('curve'),
                    showSwap: this.shouldShowComponent('swap'),
                    current: this.state.activeView
                }
            });
        });
    }

    handlePortfolioClick() {
        eventBus.emit('portfolio:open');
    }

    handlePortfolioOpen() {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'portfolio-modal-container';
        document.body.appendChild(modalContainer);
        
        this.portfolioModal = new PortfolioModal(this.blockchainService);
        this.portfolioModal.mount(modalContainer);
    }

    handlePortfolioClose() {
        const container = document.getElementById('portfolio-modal-container');
        if (container) {
            container.remove();
        }
        this.portfolioModal = null;
    }

    batchUpdate(updateFn) {
        if (this._batchTimeout) {
            clearTimeout(this._batchTimeout);
        }

        this._batchTimeout = setTimeout(() => {
            updateFn();
            this._batchTimeout = null;
        }, 0);
    }

    setupDOMEventListeners() {
        if (!this.element) {
            console.error('Element not found for DOM event setup');
            return;
        }

        // Create a single delegated click handler for all button interactions
        const handleClick = (e) => {
            // Quick fill button handling
            const quickFillButton = e.target.closest('.quick-fill');
            if (quickFillButton) {
                const value = quickFillButton.dataset.value;
                const isEthFill = quickFillButton.classList.contains('eth-fill');
                
                // Prevent double-firing of events
                e.preventDefault();
                e.stopPropagation();
                
                eventBus.emit(EVENTS.CLICK.QUICK_FILL, {
                    value,
                    isEthFill,
                    target: quickFillButton
                });
                return;
            }

            // Swap direction button
            const swapButton = e.target.closest('.swap-arrow-button');
            if (swapButton) {
                eventBus.emit(EVENTS.CLICK.SWAP);
                return;
            }

            // Main swap/trade button
            const mainSwapButton = e.target.closest('#swapButton');
            if (mainSwapButton) {
                eventBus.emit(EVENTS.CLICK.SWAP_BUTTON);
                return;
            }

            // Tab buttons
            const tabButton = e.target.closest('.tab-button');
            if (tabButton) {
                eventBus.emit(EVENTS.CLICK.TAB, {
                    view: tabButton.dataset.view
                });
                return;
            }
        };

        // Input event handlers with debouncing
        const createDebouncedHandler = (eventName, delay = 300) => {
            let timeout;
            return (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    eventBus.emit(eventName, {
                        value: e.target.value,
                        target: e.target
                    });
                }, delay);
            };
        };

        // Setup input handlers
        const inputHandlers = {
            '#ethAmount': createDebouncedHandler(EVENTS.INPUT.ETH_AMOUNT),
            '#execAmount': createDebouncedHandler(EVENTS.INPUT.EXEC_AMOUNT),
            '#transactionMessage': createDebouncedHandler(EVENTS.INPUT.MESSAGE, 1000)
        };

        // Setup change handlers
        const changeHandlers = {
            '#leaveMessage': (e) => eventBus.emit(EVENTS.CHANGE.MESSAGE_OPTION, {
                checked: e.target.checked
            }),
            '#mintNFT': (e) => eventBus.emit(EVENTS.CHANGE.MINT_OPTION, {
                checked: e.target.checked
            })
        };

        // Store cleanup functions
        this.domCleanupFunctions = [];

        // Add click handler
        this.element.addEventListener('click', handleClick);
        this.domCleanupFunctions.push(() => 
            this.element.removeEventListener('click', handleClick)
        );

        // Add input handlers
        Object.entries(inputHandlers).forEach(([selector, handler]) => {
            const element = this.element.querySelector(selector);
            if (element) {
                element.addEventListener('input', handler);
                this.domCleanupFunctions.push(() => 
                    element.removeEventListener('input', handler)
                );
            }
        });

        // Add change handlers
        Object.entries(changeHandlers).forEach(([selector, handler]) => {
            const element = this.element.querySelector(selector);
            if (element) {
                element.addEventListener('change', handler);
                this.domCleanupFunctions.push(() => 
                    element.removeEventListener('change', handler)
                );
            }
        });

        if (this.debugMode) {
            console.log('DOM event listeners setup complete');
        }
    }

    handleSwapButton(e) {
        const state = tradingStore.getState();
        if (state.isEthToExec) {
            this.handleBuyExec();
        } else {
            this.handleSellExec();
        }
    }

    handleMessageChange(e) {
        tradingStore.setState({
            showMessageOption: e.checked
        });
    }

    handleMessageInput(e) {
        if (this.messageDebounce) {
            clearTimeout(this.messageDebounce);
        }
        const value = e.target.value;
        this.messageDebounce = setTimeout(() => {
            tradingStore.setState({ 
                transactionMessage: value,
                messageDebounceActive: false 
            });
        }, 3000);
        
        // Set immediate visual feedback
        tradingStore.setState({ 
            messageDebounceActive: true,
            pendingMessage: value 
        });
    }

    handleMintChange(e) {
        tradingStore.setState({
            mintOptionChecked: e.checked
        });
    }

    handleEthInput(e) {
        tradingStore.setState({
            ethAmount: e.value,
            execAmount: ''
        });
    }

    handleExecInput(e) {
        tradingStore.setState({
            execAmount: e.value,
            ethAmount: ''
        });
    }

    handleQuickFill(e) {
        const { value, isEthFill } = e;
        
        if (isEthFill) {
            tradingStore.setState({
                ethAmount: value,
                execAmount: ''
            });
        } else {
            const { exec: execBalance } = tradingStore.selectBalances();
            const percent = parseInt(value);
            const amount = (execBalance * (percent / 100)).toFixed(2);
            
            tradingStore.setState({
                execAmount: amount,
                ethAmount: ''
            });
        }
    }

    handleSwap() {
        const state = tradingStore.getState();
        tradingStore.setState({
            isEthToExec: !state.isEthToExec,
            ethAmount: state.execAmount,
            execAmount: state.ethAmount
        });
    }

    async loadBalances() {
        try {
            if (!this.blockchainService) {
                throw new Error('BlockchainService not initialized');
            }
            
            const tokenBalance = await this.blockchainService.getTokenBalance(this.address);
            const nftBalance = await this.blockchainService.getNFTBalance(this.address);
            const ethBalance = await this.blockchainService.getEthBalance(this.address);
            
            tradingStore.updateBalances({
                eth: parseFloat(this.ethers.utils.formatEther(ethBalance)),
                exec: parseInt(tokenBalance),
                nfts: nftBalance
            });
        } catch (error) {
            console.error('Error loading balances:', {
                error,
                blockchainService: this.blockchainService,
                address: this.address
            });
            throw error;
        }
    }

    async updatePrice() {
        try {
            const price = await priceService.getCurrentPrice();
            tradingStore.setState({ currentPrice: price });
        } catch (error) {
            console.error('Error updating price:', error);
        }
    }

    handleTabClick(event) {
        const view = event.target.dataset.view;

        if (view === this.state.activeView) {
            return;
        }

        // Update internal state, which will trigger updateViewVisibility
        this.setState({ activeView: view });

        // Update layout state for other services
        this.layoutState.activeView = view;
        this.layoutState.visibleViews = this.state.isMobile ? [view] : ['swap', 'curve'];

        // Batch our updates to prevent multiple renders
        this.batchUpdate(() => {
            // Update store
            tradingStore.setState({
                view: {
                    isMobile: this.state.isMobile,
                    showCurve: this.shouldShowComponent('curve'),
                    showSwap: this.shouldShowComponent('swap'),
                    current: view
                }
            });

            // Notify layout service
            eventBus.emit(LAYOUT_EVENTS.VIEW_CHANGE, {
                activeTab: view,
                visibleViews: this.layoutState.visibleViews
            });
        });
    }

    setupTabListeners() {
        const tabButtons = this.element.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.removeEventListener('click', this.handleTabClick);
            button.addEventListener('click', this.handleTabClick);
        });
    }

    async handleBuyExec() {
        const state = tradingStore.getState();
        if (!state.isEthToExec) {
            console.error('Sell functionality not yet implemented');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(state.execAmount);
            const ethValue = parseFloat(state.ethAmount);
            
            if (isNaN(amount) || isNaN(ethValue) || amount <= 0 || ethValue <= 0) {
                throw new Error('Invalid input amounts');
            }

            // Convert amounts to contract format
            const execAmount = BigInt(Math.floor(amount)).toString();
            const maxCost = BigInt(Math.floor(ethValue * 1e18)).toString();
            
            // Get merkle proof from blockchain service
            const proof = await this.blockchainService.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                maxCost: maxCost,
                mintNFT: state.mintOptionChecked || false,
                proof: proof,
                message: state.transactionMessage || ''
            };

            // Send transaction using BlockchainService
            const receipt = await this.blockchainService.buyBonding(params, ethValue);

            console.log('Transaction confirmed:', receipt);
            eventBus.emit('trade:executed', { type: 'buy', receipt });
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            tradingStore.setState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false,
                mintOptionChecked: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            eventBus.emit('transaction:error', error);
        }
    }

    async handleSellExec() {
        const state = tradingStore.getState();
        if (state.isEthToExec) {
            console.error('Buy functionality should use handleBuyExec');
            return;
        }

        try {
            // Validate inputs
            const amount = parseFloat(state.execAmount);
            const minEthReturn = parseFloat(state.ethAmount);
            
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
            
            // Get merkle proof from blockchain service
            const proof = await this.blockchainService.getMerkleProof(this.address);
            
            const params = {
                amount: execAmount,
                minReturn: minReturn,
                proof: proof,
                message: state.transactionMessage || ''
            };

            // Send transaction using BlockchainService
            const receipt = await this.blockchainService.sellBonding(params);

            console.log('Transaction confirmed:', receipt);
            eventBus.emit('trade:executed', { type: 'sell', receipt });
            
            // Refresh balances and price
            await this.loadBalances();
            await this.updatePrice();

            // Clear inputs
            tradingStore.setState({
                ethAmount: '',
                execAmount: '',
                transactionMessage: '',
                showMessageOption: false
            });

        } catch (error) {
            console.error('Transaction failed:', error);
            eventBus.emit('transaction:error', error);
        }
    }

    checkNFTBalanceWarning() {
        const { isEthToExec } = tradingStore.selectDirection();
        const { exec: execAmount } = tradingStore.selectAmounts();
        const { exec: execBalance, nfts } = tradingStore.selectBalances();

        // Only check for warnings when selling EXEC and user has NFTs
        if (isEthToExec || nfts === 0) return null;

        const amount = parseFloat(execAmount || 0);
        const remainingBalance = execBalance - amount;
        const requiredBalance = nfts * 1000000;

        if (remainingBalance < requiredBalance) {
            return {
                type: 'error',
                message: `Warning: This sale would reduce your balance below ${nfts}M EXEC required to support your NFTs. Please reduce the sale amount or burn NFTs first.`
            };
        }

        return null;
    }

    shouldShowMintOption() {
        const { isEthToExec } = tradingStore.selectDirection();
        const { exec: execAmount } = tradingStore.selectAmounts();
        const { exec: execBalance, nfts } = tradingStore.selectBalances();

        // Only show mint option for ETH to EXEC transactions
        if (!isEthToExec) return false;

        const amount = parseFloat(execAmount || 0);
        
        // If user has no NFTs, check if total balance would be enough
        if (nfts === 0) {
            const totalExec = execBalance + amount;
            return totalExec >= 1000000;
        }
        
        // If user has NFTs, they need a full 1M new EXEC to mint another
        return amount >= 1000000;
    }

    async updatePreciseExecAmount(ethValue) {
        try {
            // Convert ETH to wei
            const weiValue = this.ethers.utils.parseEther(ethValue.toString());
            
            // Get the current price from price service
            const price = await priceService.getCurrentPrice();
            
            // Calculate approximate EXEC amount based on current price
            const execAmount = (ethValue * (1000000 / parseFloat(price))).toFixed(2);
            
            // Update the state with the more precise amount
            tradingStore.setState({
                execAmount: execAmount
            });

            // Update the curve chart to reflect new position
            if (this.mounted) {
                requestAnimationFrame(() => {
                    this.bondingCurve.initializeCurveChart();
                });
            }
        } catch (error) {
            console.error('Error calculating precise EXEC amount:', error);
            // Keep the current estimate if precise calculation fails
        }
    }

    shouldShowComponent(view) {
        if (this.state.isMobile) {
            return view === this.state.activeView;
        }
        // On desktop, both components are always present in the DOM
        return ['swap', 'curve'].includes(view);
    }

    updateViewVisibility() {
        const { isMobile, activeView, showNotAllowedOverlay, currentWhitelistTier, isPhase2 } = this.state;
        
        const wasMobile = this.element.classList.contains('mobile');
        this.element.classList.toggle('mobile', isMobile);

        // Update tab navigation structure if mobile state changes
        if (isMobile !== wasMobile) {
            const tabNav = this.element.querySelector('.tab-navigation');
            const portfolioButtonHTML = `<button class="portfolio-button">Portfolio</button>`;
            if (isMobile) {
                tabNav.innerHTML = `
                    <button class="tab-button" data-view="curve">Bonding Curve</button>
                    <button class="tab-button" data-view="swap">Swap</button>
                    ${portfolioButtonHTML}
                `;
            } else {
                tabNav.innerHTML = portfolioButtonHTML;
            }
            this.setupTabListeners();
            this.setupPortfolioButton();
        }

        // Update active class on tabs
        if (isMobile) {
            const tabButtons = this.element.querySelectorAll('.tab-button');
            tabButtons.forEach(button => {
                button.classList.toggle('active', button.dataset.view === activeView);
            });
        }
        
        // Cache visibility results
        const showCurve = this.shouldShowComponent('curve');
        const showSwap = this.shouldShowComponent('swap');
        
        // Toggle view visibility
        this.element.querySelector('.trading-view[data-view="curve"]').style.display = showCurve ? 'block' : 'none';
        this.element.querySelector('.trading-view[data-view="swap"]').style.display = showSwap ? 'block' : 'none';

        // Handle the "Not Allowed" overlay
        const container = this.element.querySelector('.trading-container');
        let overlay = container.querySelector('.not-allowed-overlay');

        if (!isPhase2 && showNotAllowedOverlay) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'not-allowed-overlay';
                overlay.addEventListener('click', () => this.hideOverlay());
                container.insertBefore(overlay, container.firstChild);
            }
            overlay.innerHTML = `
                <img src="/public/stop.png" alt="Not Allowed" />
                <div class="overlay-text">NOT ALLOWED</div>
                <div class="tier-text">Current Whitelist: Tier ${currentWhitelistTier !== null ? currentWhitelistTier : 'Loading...'}</div>
            `;
            overlay.style.display = 'flex';
        } else if (overlay) {
            overlay.remove();
        }
    }

    static get styles() {
        return `
            .trading-interface {
                display: flex;
                flex-direction: column;
                gap: 20px;
                height: 100%;
            }

            .trading-interface.mobile {
                flex-direction: column;
            }

            .trading-container {
                position: relative;
                flex: 1;
                display: flex;
            }

            .trading-view {
                flex: 1;
            }

            .view-container {
                flex: 1;
                min-height: 0;  /* Important for flex containers */
            }

            .view-container.active {
                display: flex;
            }

            .tab-navigation {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
            }

            .portfolio-button {
                padding: 8px 16px;
                border-radius: 4px;
                color: white;
                background-color: #000000;
                border: 1px solid #fdb523;
                cursor: pointer;
                margin-left: auto;
            }

            .portfolio-button:hover {
                background-color: #e0e0e0;
            }

            .trading-interface-container {
                position: relative;
            }

            .not-allowed-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .not-allowed-overlay img {
                max-width: 200px;
                margin-bottom: 20px;
            }

            .overlay-text {
                color: white;
                font-size: 32px;
                font-weight: bold;
                text-align: center;
            }

            .tier-text {
                color: white;
                font-size: 24px;
                margin-top: 10px;
                text-align: center;
                font-family: monospace;
            }
        `;
    }

    setupPortfolioButton() {
        const portfolioButton = this.element.querySelector('.portfolio-button');
        if (portfolioButton) {
            portfolioButton.addEventListener('click', this.handlePortfolioClick.bind(this));
        }
    }

    hideOverlay() {
        this.setState({ showNotAllowedOverlay: false });
    }
}

export default TradingInterface; 