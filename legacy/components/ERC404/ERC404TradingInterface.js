import { Component } from '../../core/Component.js';
import { projectStore } from '../../store/projectStore.js';
import { eventBus } from '../../core/EventBus.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import SwapInterface from '../SwapInterface/SwapInterface.js';
import BondingCurve from '../BondingCurve/BondingCurve.js';
import PriceDisplay from '../PriceDisplay/PriceDisplay.js';
import BalanceDisplay from '../BalanceDisplay/BalanceDisplay.js';
// WalletConnector removed - WalletDisplay is handled by ProjectDetail component
import stylesheetLoader from '../../utils/stylesheetLoader.js';

/**
 * ERC404TradingInterface Component
 * 
 * Trading interface for ERC404 projects that works with ProjectService and projectStore.
 * Similar to TradingInterface but uses projectStore instead of tradingStore.
 */
export class ERC404TradingInterface extends Component {
    constructor(projectId, adapter) {
        super();
        this.projectId = projectId;
        this.adapter = adapter;
        this.state = {
            loading: true,
            price: 0,
            balances: {
                eth: '0',
                token: '0',
                nfts: '0'
            },
            isEthToExec: true,
            ethAmount: '',
            tokenAmount: '',
            error: null
        };
        
        // Ensure project exists in store
        this.ensureProjectInStore();
    }
    
    /**
     * Ensure project exists in projectStore
     */
    ensureProjectInStore() {
        if (!projectStore.hasProject(this.projectId)) {
            // Get project metadata from ProjectService
            const projectService = serviceFactory.getProjectService();
            const instance = projectService.getInstance(this.projectId);
            
            if (instance) {
                const metadata = {
                    contractAddress: this.adapter.contractAddress,
                    contractType: 'ERC404',
                    name: instance.metadata?.name || this.projectId,
                    factoryAddress: instance.metadata?.factoryAddress || null,
                    isFactoryCreated: instance.metadata?.isFactoryCreated || false
                };
                
                // Create project with explicit buy direction (isEthToExec: true)
                projectStore.createProject(this.projectId, metadata, {
                    isEthToExec: true
                });
            }
        }
        
        // Switch to this project
        projectStore.switchProject(this.projectId);
        
        // Note: Direction will be set to buy in onMount() to override any localStorage state
    }
    
    async onMount() {
        // Load ERC404 styles
        stylesheetLoader.load('src/components/ERC404/erc404.css', 'erc404-styles');
        
        // Always ensure we start in buy mode, even if localStorage has sell mode
        // Do this BEFORE setting up subscriptions so the initial state is correct
        projectStore.setDirection(this.projectId, true);
        
        // Update local state immediately to reflect buy mode
        this.state.isEthToExec = true;
        this._directionExplicitlySet = true; // Mark that we've explicitly set it
        
        this.setupSubscriptions();
        await this.loadData();
        
        // Setup child components after data loads and DOM is ready
        // Use setTimeout to ensure DOM is ready after render
        this.setTimeout(() => {
            if (!this.state.loading) {
                this.setupChildComponents();
                this.setupDOMEventListeners();
            }
        }, 100);
    }
    
    onStateUpdate(oldState, newState) {
        // When loading completes, setup child components if not already done
        if (oldState.loading && !newState.loading && !this._childComponentsSetup) {
            this.setTimeout(() => {
                this.setupChildComponents();
                this.setupDOMEventListeners();
                this.updateDisplays(); // Ensure displays are updated with latest data
                this._childComponentsSetup = true;
            }, 50);
        }
    }
    
    onUnmount() {
        // Unload styles when component unmounts
        stylesheetLoader.unload('erc404-styles');
        
        // Clean up subscriptions
        if (this.unsubscribeStore) {
            this.unsubscribeStore();
        }
        
        if (this.unsubscribeEvents) {
            this.unsubscribeEvents.forEach(unsub => unsub());
        }
        
        // Clean up swap listeners
        const swapSection = this.getRef('swap-section', '.swap-section');
        if (swapSection && this._swapClickHandler) {
            swapSection.removeEventListener('click', this._swapClickHandler);
        }
        if (swapSection && this._swapInputHandler) {
            swapSection.removeEventListener('input', this._swapInputHandler);
        }
        
        // Clear calculation timeout
        if (this._calculationTimeout) {
            clearTimeout(this._calculationTimeout);
            this._calculationTimeout = null;
        }
        
        this._swapListenersSetup = false;
    }
    
    async loadData() {
        try {
            this.setState({ loading: true, error: null });
            
            // Get wallet address (optional - can work without wallet)
            const walletAddress = walletService.getAddress();
            
            // Load price (always available)
            const price = await this.adapter.getCurrentPrice().catch(() => 0);
            
            // Update projectStore with price
            projectStore.updatePrice(this.projectId, price);
            
            // Load balances if wallet is connected
            if (walletAddress) {
                const [tokenBalance, ethBalance, nftBalance] = await Promise.all([
                    this.adapter.getTokenBalance(walletAddress).catch(() => '0'),
                    this.adapter.getEthBalance(walletAddress).catch(() => '0'),
                    this.adapter.getNFTBalance(walletAddress).catch(() => 0)
                ]);
                
                // Format balances
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                const ethFormatted = parseFloat(ethers.utils.formatEther(ethBalance));
                const tokenFormatted = parseFloat(ethers.utils.formatUnits(tokenBalance, 0));
                
                // Update projectStore
                projectStore.updateBalances(this.projectId, {
                    eth: ethFormatted.toString(),
                    exec: tokenFormatted.toString(),
                    nfts: nftBalance.toString()
                });
                
                // Update local state
                this.setState({
                    loading: false,
                    price,
                    balances: {
                        eth: ethFormatted.toString(),
                        token: tokenFormatted.toString(),
                        nfts: nftBalance.toString()
                    }
                });
            } else {
                // No wallet connected, just show price
                this.setState({
                    loading: false,
                    price,
                    balances: {
                        eth: '0',
                        token: '0',
                        nfts: '0'
                    }
                });
            }
        } catch (error) {
            console.error('[ERC404TradingInterface] Error loading data:', error);
            this.setState({ 
                loading: false, 
                error: error.message || 'Failed to load data' 
            });
        }
    }
    
    /**
     * Override shouldUpdate to prevent re-renders on input changes
     * Input changes are handled by selective DOM updates
     */
    shouldUpdate(oldState, newState) {
        if (!oldState || !newState) return true;
        if (oldState === newState) return false;
        
        // Check if user is currently typing
        const activeElement = document.activeElement;
        const isUserTyping = activeElement && (
            activeElement.classList.contains('swap-input-top') || 
            activeElement.classList.contains('swap-input-bottom')
        );
        
        // Don't update if only input values changed and user is typing
        // These are handled by selective DOM updates
        if (isUserTyping) {
            const inputOnlyChanges = 
                (oldState.ethAmount !== newState.ethAmount) ||
                (oldState.tokenAmount !== newState.tokenAmount) ||
                (oldState.isEthToExec !== newState.isEthToExec);
            
            if (inputOnlyChanges) {
                // Update selectively instead of full re-render
                this.updateSwapInterfaceSelectively(newState);
                return false; // Prevent full re-render
            }
        }
        
        // Default shallow comparison for other changes
        const oldKeys = Object.keys(oldState);
        const newKeys = Object.keys(newState);
        if (oldKeys.length !== newKeys.length) return true;
        return oldKeys.some(key => oldState[key] !== newState[key]);
    }
    
    setupSubscriptions() {
        // Subscribe to projectStore changes
        this.unsubscribeStore = projectStore.subscribe(() => {
            const projectState = projectStore.selectProjectState(this.projectId);
            if (projectState) {
                // Update state directly without triggering re-render for input values
                // Only use setState for non-input state changes
                const newPrice = projectState.price?.current || 0;
                const newBalances = projectState.balances || { eth: '0', exec: '0', nfts: '0' };
                
                // Always default to buy mode unless user has explicitly changed it
                // This prevents localStorage sell state from overriding our initial buy mode
                let newIsEthToExec = projectState.isEthToExec !== undefined ? projectState.isEthToExec : true;
                if (!this._directionExplicitlySet && newIsEthToExec === false) {
                    // If we haven't explicitly set direction and it's false, force it to true
                    newIsEthToExec = true;
                    projectStore.setDirection(this.projectId, true);
                }
                
                // Update state directly for input values (won't trigger re-render due to shouldUpdate)
                this.state.ethAmount = projectState.ethAmount || '';
                this.state.tokenAmount = projectState.execAmount || '';
                this.state.isEthToExec = newIsEthToExec;
                
                // Use setState only for non-input changes (will trigger selective updates)
                if (this.state.price !== newPrice || 
                    this.state.balances.eth !== newBalances.eth ||
                    this.state.balances.exec !== newBalances.exec ||
                    this.state.balances.nfts !== newBalances.nfts) {
                    this.setState({
                        price: newPrice,
                        balances: newBalances
                    });
                } else {
                    // Just update displays without state change
                    this.updateDisplaysSelectively();
                }
            }
        });
        
        // Subscribe to transaction events
        this.unsubscribeEvents = [
            eventBus.on('transaction:confirmed', async () => {
                await this.loadData();
            }),
            eventBus.on('account:changed', async () => {
                await this.loadData();
            }),
            eventBus.on('network:changed', async () => {
                await this.loadData();
            })
        ];
    }
    
    /**
     * Update swap interface selectively without destroying focused inputs
     */
    updateSwapInterfaceSelectively(newState) {
        const swapSection = this.getRef('swap-section', '.swap-section');
        if (!swapSection) return;
        
        const existingSwap = swapSection.querySelector('.swap-interface-simple');
        if (!existingSwap) return;
        
        // Update only non-focused inputs and labels
        const topInput = existingSwap.querySelector('.swap-input-top');
        const bottomInput = existingSwap.querySelector('.swap-input-bottom');
        
        // Update top input only if not focused
        if (topInput && !topInput.matches(':focus')) {
            const newValue = newState.isEthToExec ? newState.ethAmount : newState.tokenAmount;
            if (topInput.value !== newValue) {
                topInput.value = newValue;
            }
        }
        
        // Update bottom input only if not focused (it's readonly anyway)
        if (bottomInput && !bottomInput.matches(':focus')) {
            const newValue = newState.isEthToExec ? newState.tokenAmount : newState.ethAmount;
            if (bottomInput.value !== newValue) {
                bottomInput.value = newValue;
            }
        }
        
        // Update labels and button text
        const title = existingSwap.querySelector('.swap-title');
        if (title) title.textContent = `${newState.isEthToExec ? 'Buy' : 'Sell'} Tokens`;
        
        const swapButton = existingSwap.querySelector('.swap-button');
        if (swapButton) swapButton.textContent = newState.isEthToExec ? 'Buy' : 'Sell';
    }
    
    /**
     * Update displays selectively without touching focused inputs
     */
    updateDisplaysSelectively() {
        // Update price display
        const priceSection = this.getRef('price-section', '.price-section');
        if (priceSection && priceSection.parentNode) {
            this.createPriceDisplay(priceSection);
        }
        
        // Update balance display
        const balanceSection = this.getRef('balance-section', '.balance-section');
        if (balanceSection && balanceSection.parentNode) {
            this.createBalanceDisplay(balanceSection);
        }
        
        // Update swap interface selectively
        const swapSection = this.getRef('swap-section', '.swap-section');
        if (swapSection && swapSection.parentNode) {
            const existingSwap = swapSection.querySelector('.swap-interface-simple');
            if (existingSwap && existingSwap.parentNode) {
                const projectState = projectStore.selectProjectState(this.projectId);
                const balances = projectState?.balances || { eth: '0', exec: '0', nfts: '0' };
                
                // Update balance displays only - never touch inputs
                const balanceDisplays = existingSwap.querySelectorAll('.token-balance-display');
                if (balanceDisplays[0]) {
                    const isEthToExec = projectState?.isEthToExec !== false;
                    balanceDisplays[0].textContent = `Balance: ${isEthToExec ? parseFloat(balances.eth || '0').toFixed(4) : parseInt(balances.exec || '0').toLocaleString()}`;
                }
                if (balanceDisplays[1]) {
                    const isEthToExec = projectState?.isEthToExec !== false;
                    balanceDisplays[1].textContent = `Balance: ${isEthToExec ? parseInt(balances.exec || '0').toLocaleString() : parseFloat(balances.eth || '0').toFixed(4)}`;
                }
            }
        }
        
        // Update bonding curve
        const curveSection = this.getRef('curve-section', '.curve-section');
        if (curveSection && curveSection.parentNode) {
            const projectState = projectStore.selectProjectState(this.projectId);
            const price = projectState?.price?.current || 0;
            const existingCurve = curveSection.querySelector('.bonding-curve-simple');
            if (existingCurve && existingCurve.parentNode) {
                const statValue = existingCurve.querySelector('.stat-value');
                if (statValue) {
                    statValue.textContent = `${price.toFixed(6)} ETH per 1M tokens`;
                }
                this.drawBondingCurve(curveSection, price);
            }
        }
    }
    
    updateDisplays() {
        // Full update - only called when not typing
        this.updateDisplaysSelectively();
    }
    
    render() {
        if (this.state.loading) {
            return `
                <div class="erc404-trading-interface loading marble-bg">
                    <div class="loading-spinner"></div>
                    <p>Loading trading interface...</p>
                </div>
            `;
        }
        
        if (this.state.error) {
            return `
                <div class="erc404-trading-interface error marble-bg">
                    <p class="error-message">${this.escapeHtml(this.state.error)}</p>
                    <button class="retry-button" ref="retry-button">Retry</button>
                </div>
            `;
        }
        
        return `
            <div class="erc404-trading-interface marble-bg">
                <div class="trading-header marble-bg">
                    <h2>Trading Interface</h2>
                </div>
                
                <div class="trading-content">
                    <div class="trading-left">
                        <div class="price-section marble-bg" ref="price-section">
                            <!-- PriceDisplay will be mounted here -->
                        </div>
                        <div class="balance-section marble-bg" ref="balance-section">
                            <!-- BalanceDisplay will be mounted here -->
                        </div>
                    </div>
                    
                    <div class="trading-center-right">
                        <div class="swap-section marble-bg" ref="swap-section">
                            <!-- SwapInterface will be mounted here -->
                    </div>
                    
                        <div class="curve-section marble-bg" ref="curve-section">
                            <!-- BondingCurve will be mounted here -->
                        </div>
                    </div>
                </div>
                
                <!-- WalletDisplay is handled by ProjectDetail component, not here -->
            </div>
        `;
    }
    
    setupChildComponents() {
        // Note: SwapInterface, BondingCurve, PriceDisplay, and BalanceDisplay
        // are currently tightly coupled to tradingStore. For now, we'll mount them
        // but they may need adaptation to work with projectStore.
        // This is a known limitation mentioned in Task 5.
        
        // For now, we'll create a simplified interface that works with the adapter
        // and projectStore directly
        
        const priceSection = this.getRef('price-section', '.price-section');
        const balanceSection = this.getRef('balance-section', '.balance-section');
        const swapSection = this.getRef('swap-section', '.swap-section');
        const curveSection = this.getRef('curve-section', '.curve-section');
        
        // WalletDisplay is handled by ProjectDetail component, not here
        
        // For now, create simplified displays that work with projectStore
        // TODO: Adapt SwapInterface, BondingCurve, PriceDisplay, BalanceDisplay
        // to work with projectStore or create projectStore versions
        
        if (priceSection && !this._children.has('price')) {
            this.createPriceDisplay(priceSection);
        }
        
        if (balanceSection && !this._children.has('balance')) {
            this.createBalanceDisplay(balanceSection);
        }
        
        if (swapSection && !this._children.has('swap')) {
            this.createSwapInterface(swapSection);
        }
        
        if (curveSection && !this._children.has('curve')) {
            this.createBondingCurve(curveSection);
        }
    }
    
    createPriceDisplay(container) {
        const projectState = projectStore.selectProjectState(this.projectId);
        const price = projectState?.price?.current || 0;
        
        container.innerHTML = `
            <div class="price-display-simple marble-bg">
                <h3>Current Price</h3>
                <div class="price-value">${price.toFixed(6)} ETH per 1M tokens</div>
            </div>
        `;
    }
    
    createBalanceDisplay(container) {
        const projectState = projectStore.selectProjectState(this.projectId);
        const balances = projectState?.balances || { eth: '0', exec: '0', nfts: '0' };
        
        container.innerHTML = `
            <div class="balance-display-simple marble-bg">
                <h3>Your Balances</h3>
                <div class="balance-item">
                    <span class="label">ETH:</span>
                    <span class="value">${parseFloat(balances.eth || '0').toFixed(4)}</span>
                </div>
                <div class="balance-item">
                    <span class="label">Tokens:</span>
                    <span class="value">${parseFloat(balances.exec || '0').toFixed(0)}</span>
                </div>
                <div class="balance-item">
                    <span class="label">NFTs:</span>
                    <span class="value">${parseInt(balances.nfts || '0')}</span>
                </div>
            </div>
        `;
    }
    
    createSwapInterface(container) {
        // Ensure container exists and is valid
        if (!container || !container.parentNode) {
            console.warn('[ERC404TradingInterface] Container is invalid, skipping swap interface creation');
            return;
        }
        
        const projectState = projectStore.selectProjectState(this.projectId);
        // Force buy mode on initial load - use local state if available, otherwise default to true
        // This overrides any localStorage state that might have sell mode
        let isEthToExec = this.state.isEthToExec !== undefined ? this.state.isEthToExec : true;
        
        // If we haven't explicitly set it yet, ensure it's buy mode
        if (isEthToExec === false && !this._directionExplicitlySet) {
            isEthToExec = true;
            projectStore.setDirection(this.projectId, true);
            this.state.isEthToExec = true;
        }
        
        const balances = projectState?.balances || { eth: '0', exec: '0', nfts: '0' };
        
        // Check if swap interface already exists
        let existingSwap = container.querySelector('.swap-interface-simple');
        
        // If it doesn't exist or was removed, create it
        if (!existingSwap) {
            // Store current input values before recreating (if any)
            let topValue = '';
            let bottomValue = '';
            if (existingSwap) {
                const oldTopInput = existingSwap.querySelector('.swap-input-top');
                const oldBottomInput = existingSwap.querySelector('.swap-input-bottom');
                if (oldTopInput) topValue = oldTopInput.value;
                if (oldBottomInput) bottomValue = oldBottomInput.value;
            }
        
        container.innerHTML = `
            <div class="swap-interface-simple marble-bg">
                    <h3 class="swap-title">${isEthToExec ? 'Buy' : 'Sell'} Tokens</h3>
                    <div class="quick-fill-buttons-container">
                        <div class="quick-fill-buttons"></div>
                    </div>
                <div class="swap-inputs">
                    <div class="input-group">
                            <label class="input-label">${isEthToExec ? 'ETH Amount' : 'Token Amount'}</label>
                        <input 
                            type="number" 
                                class="swap-input-top"
                            id="erc404-${isEthToExec ? 'eth' : 'token'}-amount"
                            placeholder="0.0"
                                value="${topValue || projectState?.ethAmount || projectState?.execAmount || ''}"
                        />
                            <div class="token-balance-display">
                                Balance: ${isEthToExec ? parseFloat(balances.eth || '0').toFixed(4) : parseInt(balances.exec || '0').toLocaleString()}
                            </div>
                    </div>
                        <button class="swap-direction-button" data-ref="swap-direction">
                        ⇄
                    </button>
                    <div class="input-group">
                            <label class="input-label">${isEthToExec ? 'Token Amount' : 'ETH Amount'}</label>
                        <input 
                            type="number" 
                                class="swap-input-bottom"
                            id="erc404-${isEthToExec ? 'token' : 'eth'}-amount"
                            placeholder="0.0"
                                value="${bottomValue || projectState?.execAmount || projectState?.ethAmount || ''}"
                            readonly
                        />
                            <div class="token-balance-display">
                                Balance: ${isEthToExec ? parseInt(balances.exec || '0').toLocaleString() : parseFloat(balances.eth || '0').toFixed(4)}
                            </div>
                        </div>
                    </div>
                    <button class="swap-button" data-ref="swap-button">
                    ${isEthToExec ? 'Buy' : 'Sell'}
                </button>
            </div>
        `;
        
            // Re-setup listeners after recreation
            this.setupSwapListeners(container);
        } else {
            // Update existing elements - be very careful not to break anything
            const title = existingSwap.querySelector('.swap-title');
            if (title) title.textContent = `${isEthToExec ? 'Buy' : 'Sell'} Tokens`;
            
            const topLabel = existingSwap.querySelector('.input-group:first-child .input-label');
            if (topLabel) topLabel.textContent = `${isEthToExec ? 'ETH Amount' : 'Token Amount'}`;
            
            const bottomLabel = existingSwap.querySelector('.input-group:last-child .input-label');
            if (bottomLabel) bottomLabel.textContent = `${isEthToExec ? 'Token Amount' : 'ETH Amount'}`;
            
            const swapButton = existingSwap.querySelector('.swap-button');
            if (swapButton) swapButton.textContent = isEthToExec ? 'Buy' : 'Sell';
            
            // Update input IDs and values - NEVER update the top input if user is typing
            const topInput = existingSwap.querySelector('.swap-input-top');
            const bottomInput = existingSwap.querySelector('.swap-input-bottom');
            
            // NEVER update the top input if it has focus - preserve user's typing
            if (topInput && document.activeElement !== topInput) {
                const newId = `erc404-${isEthToExec ? 'eth' : 'token'}-amount`;
                if (topInput.id !== newId) {
                    topInput.id = newId;
                }
                // Only update value if it's different and user isn't actively editing
                const newValue = projectState?.ethAmount || projectState?.execAmount || '';
                if (topInput.value !== newValue && !topInput.matches(':focus')) {
                    topInput.value = newValue;
                }
            }
            
            // Bottom input is readonly, safe to update
            if (bottomInput && document.activeElement !== bottomInput) {
                const newId = `erc404-${isEthToExec ? 'token' : 'eth'}-amount`;
                if (bottomInput.id !== newId) {
                    bottomInput.id = newId;
                }
                const newValue = projectState?.execAmount || projectState?.ethAmount || '';
                if (bottomInput.value !== newValue) {
                    bottomInput.value = newValue;
                }
            }
            
            // Update balance displays
            const balanceDisplays = existingSwap.querySelectorAll('.token-balance-display');
            if (balanceDisplays[0]) {
                balanceDisplays[0].textContent = `Balance: ${isEthToExec ? parseFloat(balances.eth || '0').toFixed(4) : parseInt(balances.exec || '0').toLocaleString()}`;
            }
            if (balanceDisplays[1]) {
                balanceDisplays[1].textContent = `Balance: ${isEthToExec ? parseInt(balances.exec || '0').toLocaleString() : parseFloat(balances.eth || '0').toFixed(4)}`;
            }
        }
        
        // Always update quick fill buttons
        this.updateQuickFillButtons(container, isEthToExec, balances);
        
        // Ensure event listeners are set up
        this.setupSwapListeners(container);
    }
    
    updateQuickFillButtons(container, isEthToExec, balances) {
        const quickFillContainer = container.querySelector('.quick-fill-buttons');
        if (!quickFillContainer) return;
        
        if (isEthToExec) {
            // Buy mode: show ETH amounts
            quickFillContainer.innerHTML = `
                <button class="quick-fill-btn" data-amount="0.0025">0.0025</button>
                <button class="quick-fill-btn" data-amount="0.01">0.01</button>
                <button class="quick-fill-btn" data-amount="0.05">0.05</button>
                <button class="quick-fill-btn" data-amount="0.1">0.1</button>
            `;
        } else {
            // Sell mode: show percentages
            quickFillContainer.innerHTML = `
                <button class="quick-fill-btn" data-percentage="25">25%</button>
                <button class="quick-fill-btn" data-percentage="50">50%</button>
                <button class="quick-fill-btn" data-percentage="75">75%</button>
                <button class="quick-fill-btn" data-percentage="100">100%</button>
            `;
        }
        
        // Attach event listeners to new buttons
        quickFillContainer.querySelectorAll('.quick-fill-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleQuickFill(e, isEthToExec, balances));
        });
    }
    
    handleQuickFill(e, isEthToExec, balances) {
        e.preventDefault();
        e.stopPropagation();
        
        const amount = e.target.dataset.amount;
        const percentage = e.target.dataset.percentage;
        
        let value;
        
        if (amount) {
            // Direct amount fill (buy mode)
            value = amount;
            const topInput = document.getElementById(`erc404-${isEthToExec ? 'eth' : 'token'}-amount`);
            if (topInput) {
                topInput.value = value;
                topInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else if (percentage) {
            // Percentage of balance (sell mode)
            const execBalance = parseFloat(balances.exec || '0');
            if (execBalance <= 0) {
                console.warn('No token balance available for quick fill');
                return;
            }
            
            const amount = Math.floor((execBalance * parseInt(percentage)) / 100);
            value = amount.toString();
            
            const topInput = document.getElementById(`erc404-${isEthToExec ? 'eth' : 'token'}-amount`);
            if (topInput) {
                topInput.value = value;
                topInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
    
    setupSwapListeners(container) {
        // Ensure container is valid
        if (!container || !container.parentNode) {
            return;
        }
        
        // Remove old listeners if they exist
        if (this._swapClickHandler && container) {
            container.removeEventListener('click', this._swapClickHandler);
        }
        if (this._swapInputHandler && container) {
            container.removeEventListener('input', this._swapInputHandler);
        }
        
        // Use event delegation to handle dynamically created elements
        this._swapClickHandler = (e) => {
            // Check if container still exists
            if (!container || !container.parentNode) {
                return;
            }
            
            const swapDirectionBtn = e.target.closest('[data-ref="swap-direction"]');
            const swapButton = e.target.closest('[data-ref="swap-button"]');
        
            if (swapDirectionBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                // Get fresh container reference
                const swapSection = this.getRef('swap-section', '.swap-section');
                if (!swapSection) {
                    console.warn('[ERC404TradingInterface] Swap section not found');
                    return;
                }
                
                const projectState = projectStore.selectProjectState(this.projectId);
                const newDirection = !projectState?.isEthToExec;
                projectStore.setDirection(this.projectId, newDirection);
                this._directionExplicitlySet = true; // User explicitly changed it
                
                // Update interface - use fresh container reference
                this.createSwapInterface(swapSection);
            }
        
        if (swapButton) {
                e.preventDefault();
                e.stopPropagation();
                this.handleSwap();
            }
        };
        
        this._swapInputHandler = async (e) => {
            // Check if container still exists
            if (!container || !container.parentNode) {
                return;
            }
            
            if (e.target.classList.contains('swap-input-top') || e.target.classList.contains('swap-input-bottom')) {
                const input = e.target;
                const value = input.value;
                
                const projectState = projectStore.selectProjectState(this.projectId);
                const isEthToExec = projectState?.isEthToExec !== false;
                
                if (e.target.classList.contains('swap-input-top')) {
                    // Top input changed - update state directly (won't trigger re-render due to shouldUpdate)
                    this.state.ethAmount = isEthToExec ? value : '';
                    this.state.tokenAmount = isEthToExec ? '' : value;
                    
                    // Update store
                    projectStore.updateAmounts(this.projectId, isEthToExec ? value : null, isEthToExec ? null : value);
                    
                    // Calculate asynchronously with debounce
                    if (this._calculationTimeout) {
                        clearTimeout(this._calculationTimeout);
                    }
                    
                    this._calculationTimeout = setTimeout(async () => {
                        if (isEthToExec) {
                            await this.calculateTokenAmount(value, input);
                        } else {
                            await this.calculateEthAmount(value, input);
                        }
                    }, 750); // Match SwapInterface debounce timing
                } else if (e.target.classList.contains('swap-input-bottom')) {
                    // Bottom input changed (shouldn't happen as it's readonly)
                    this.state.ethAmount = isEthToExec ? '' : value;
                    this.state.tokenAmount = isEthToExec ? value : '';
                    projectStore.updateAmounts(this.projectId, isEthToExec ? null : value, isEthToExec ? value : null);
                    
                    if (isEthToExec) {
                        await this.calculateEthAmount(value, input);
                    } else {
                        await this.calculateTokenAmount(value, input);
                    }
                }
            }
        };
        
        // Only add listeners if container is valid
        if (container && container.parentNode) {
            container.addEventListener('click', this._swapClickHandler, { passive: false });
            container.addEventListener('input', this._swapInputHandler, { passive: true });
        }
    }
    
    async calculateTokenAmount(ethAmount, inputElement = null) {
        if (!ethAmount || isNaN(parseFloat(ethAmount)) || parseFloat(ethAmount) <= 0) {
            // Clear the output if input is invalid
            const projectState = projectStore.selectProjectState(this.projectId);
            const isEthToExec = projectState?.isEthToExec !== false;
            const bottomInput = document.getElementById(`erc404-${isEthToExec ? 'token' : 'eth'}-amount`);
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = '';
            }
            return;
        }
        
        try {
            const tokenAmount = await this.adapter.getExecForEth(ethAmount);
            
            // Update state directly (won't trigger re-render)
            this.state.tokenAmount = tokenAmount;
            projectStore.updateAmounts(this.projectId, ethAmount, tokenAmount);
            
            // Update only the bottom (readonly) input - only if not focused
            const projectState = projectStore.selectProjectState(this.projectId);
            const isEthToExec = projectState?.isEthToExec !== false;
            const bottomInput = document.getElementById(`erc404-${isEthToExec ? 'token' : 'eth'}-amount`);
            if (bottomInput && !bottomInput.matches(':focus') && bottomInput !== inputElement) {
                bottomInput.value = tokenAmount;
            }
        } catch (error) {
            console.error('Error calculating token amount:', error);
        }
    }
    
    async calculateEthAmount(tokenAmount, inputElement = null) {
        if (!tokenAmount || isNaN(parseFloat(tokenAmount)) || parseFloat(tokenAmount) <= 0) {
            // Clear the output if input is invalid
            const projectState = projectStore.selectProjectState(this.projectId);
            const isEthToExec = projectState?.isEthToExec !== false;
            const bottomInput = document.getElementById(`erc404-${isEthToExec ? 'eth' : 'token'}-amount`);
            if (bottomInput && !bottomInput.matches(':focus')) {
                bottomInput.value = '';
            }
            return;
        }
        
        try {
            const ethAmount = await this.adapter.getEthForExec(tokenAmount);
            
            // Update state directly (won't trigger re-render)
            this.state.ethAmount = ethAmount;
            projectStore.updateAmounts(this.projectId, ethAmount, tokenAmount);
            
            // Update only the bottom (readonly) input - only if not focused
            const projectState = projectStore.selectProjectState(this.projectId);
            const isEthToExec = projectState?.isEthToExec !== false;
            const bottomInput = document.getElementById(`erc404-${isEthToExec ? 'eth' : 'token'}-amount`);
            if (bottomInput && !bottomInput.matches(':focus') && bottomInput !== inputElement) {
                bottomInput.value = ethAmount;
            }
        } catch (error) {
            console.error('Error calculating ETH amount:', error);
        }
    }
    
    async handleSwap() {
        try {
            const projectState = projectStore.selectProjectState(this.projectId);
            const isEthToExec = projectState?.isEthToExec !== false;
            
            if (isEthToExec) {
                await this.handleBuy();
            } else {
                await this.handleSell();
            }
        } catch (error) {
            console.error('Error handling swap:', error);
            this.setState({ error: error.message || 'Transaction failed' });
        }
    }
    
    async handleBuy() {
        const projectState = projectStore.selectProjectState(this.projectId);
        const ethAmount = projectState?.ethAmount;
        const tokenAmount = projectState?.execAmount;
        
        if (!ethAmount || !tokenAmount || parseFloat(ethAmount) <= 0 || parseFloat(tokenAmount) <= 0) {
            throw new Error('Invalid amounts');
        }
        
        // Get wallet address
        const walletService = serviceFactory.getWalletService();
        const walletAddress = walletService.getAddress();
        
        if (!walletAddress) {
            throw new Error('Wallet not connected');
        }
        
        // Get merkle proof if needed
        const currentTier = await this.adapter.getCurrentTier().catch(() => null);
        const proof = await this.adapter.getMerkleProof(walletAddress, currentTier).catch(() => null);
        
        // Convert amounts
        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        const tokenWei = ethers.utils.parseUnits(tokenAmount.toString(), 0);
        const maxCost = ethers.utils.parseEther(ethAmount.toString());
        
        // Execute buy
        await this.adapter.buyBonding(
            tokenWei.toString(),
            maxCost.toString(),
            proof,
            ''
        );
        
        // Reload data
        await this.loadData();
    }
    
    async handleSell() {
        const projectState = projectStore.selectProjectState(this.projectId);
        const ethAmount = projectState?.ethAmount;
        const tokenAmount = projectState?.execAmount;
        
        if (!ethAmount || !tokenAmount || parseFloat(ethAmount) <= 0 || parseFloat(tokenAmount) <= 0) {
            throw new Error('Invalid amounts');
        }
        
        // Get wallet address
        const walletService = serviceFactory.getWalletService();
        const walletAddress = walletService.getAddress();
        
        if (!walletAddress) {
            throw new Error('Wallet not connected');
        }
        
        // Get merkle proof if needed
        const currentTier = await this.adapter.getCurrentTier().catch(() => null);
        const proof = await this.adapter.getMerkleProof(walletAddress, currentTier).catch(() => null);
        
        // Convert amounts
        const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
        const tokenWei = ethers.utils.parseUnits(tokenAmount.toString(), 0);
        const minReturn = ethers.utils.parseEther(ethAmount.toString());
        
        // Execute sell
        await this.adapter.sellBonding(
            tokenWei.toString(),
            minReturn.toString(),
            proof,
            ''
        );
        
        // Reload data
        await this.loadData();
    }
    
    createBondingCurve(container) {
        // Create a simple bonding curve visualization
        // For now, create a canvas-based visualization
        const projectState = projectStore.selectProjectState(this.projectId);
        const price = projectState?.price?.current || 0;
        
        container.innerHTML = `
            <div class="bonding-curve-simple marble-bg">
                <h3>Bonding Curve</h3>
                <div class="curve-chart-container">
                    <canvas id="erc404-bonding-curve-canvas" width="400" height="300"></canvas>
                </div>
                <div class="curve-info">
                    <div class="curve-stat">
                        <span class="stat-label">Current Price:</span>
                        <span class="stat-value">${price.toFixed(6)} ETH per 1M tokens</span>
                    </div>
                </div>
            </div>
        `;
        
        // Draw the curve after a short delay to ensure canvas is ready
        this.setTimeout(() => {
            this.drawBondingCurve(container, price);
        }, 100);
    }
    
    drawBondingCurve(container, currentPrice) {
        const canvas = container.querySelector('#erc404-bonding-curve-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Draw axes
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, height - 40);
        ctx.lineTo(width - 20, height - 40);
        ctx.moveTo(40, height - 40);
        ctx.lineTo(40, 20);
        ctx.stroke();
        
        // Draw a simple exponential curve (bonding curve approximation)
        ctx.strokeStyle = '#764ba2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const points = 100;
        for (let i = 0; i <= points; i++) {
            const x = 40 + (i / points) * (width - 60);
            // Simple exponential curve: price increases with supply
            const supplyRatio = i / points;
            const priceRatio = Math.pow(supplyRatio, 1.5); // Exponential curve
            const y = height - 40 - (priceRatio * (height - 60));
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Mark current price point
        if (currentPrice > 0) {
            const priceRatio = Math.min(currentPrice / (currentPrice * 2), 1); // Normalize
            const x = 40 + priceRatio * (width - 60);
            const y = height - 40 - (priceRatio * (height - 60));
            
            ctx.fillStyle = '#ff3b30';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Labels
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.fillText('Supply', width / 2, height - 10);
        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Price', 0, 0);
        ctx.restore();
    }
    
    setupDOMEventListeners() {
        const retryButton = this.getRef('retry-button', '.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.loadData();
            });
        }
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

