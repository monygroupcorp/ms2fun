/**
 * CULT EXECS page route handler
 * This contains the EXEC404 trading interface functionality
 */
import { eventBus } from '../core/EventBus.js';
import walletService from '../services/WalletService.js';
import WalletConnector from '../components/WalletConnector/WalletConnector.js';
import MessagePopup from '../components/MessagePopup/MessagePopup.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

let messagePopup = null;
let walletConnector = null;
// Store event handler references for proper cleanup
let eventHandlers = {
    walletConnected: null,
    contractError: null,
    transactionSent: null,
    transactionConfirmed: null,
    transactionFailed: null
};
// Store tab click handlers for cleanup
let tabClickHandlers = new Map();

export async function renderCultExecsPage() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }
    
    // Reset global state flags at the start of page render
    // This ensures clean state when navigating back to the page
    delete window.contractInterfaceInitialized;
    delete window.tradingInterfaceInitialized;
    if (window.tradingInterfaceInstance) {
        try {
            if (typeof window.tradingInterfaceInstance.unmount === 'function') {
                window.tradingInterfaceInstance.unmount();
            }
        } catch (error) {
            console.warn('[CultExecsPage] Error unmounting existing trading interface:', error);
        }
        delete window.tradingInterfaceInstance;
    }
    
    // Load CULT EXEC specific stylesheet
    stylesheetLoader.load('src/routes/cultexecs.css', 'cultexecs-styles');
    
    // Add body class for CULT EXEC styling
    document.body.classList.add('cultexecs-active');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';
    
    // Render top section (terminal nav and price runner)
    appTopContainer.innerHTML = `
        <div class="top-section">
            <!-- Top Navigation -->
            <div class="terminal-nav">
                <div class="nav-left">
                    <span class="nav-arrows">&lt; &gt;</span>
                    <span class="nav-title">CULT EXECUTIVE ENTERPRISE INCORPORATED TERMINAL ⌄</span>
                    <span class="nav-mode">MS2 ⭐️</span>
                    <span class="nav-menu desktop-only">Related Functions Menu ↡</span>
                </div>
                <div class="nav-right">
                    <span class="nav-icon">✉️ Message</span>
                    <span class="nav-icon">⭑↓</span>
                    <span class="nav-icon">⎐↓</span>
                    <span class="nav-icon yellow">?↓</span>
                </div>
            </div>

            <!-- Top Runner -->
            <div class="price-runner">
                <div class="ticker-info">
                    <span class="ticker-symbol">💎CULT US $</span>
                    <span class="price up" id="currentPrice">1000.00</span>
                    <span class="change up" id="priceChange">+10000000</span>
                    <span class="mini-chart">📈</span>
                    <span class="price-range" id="priceRange">P123.12/123.24P</span>
                    <span class="multiplier">3×5</span>
                </div>
                <div class="ticker-details">
                    <span class="detail-item">At <span id="timeStamp">17:20</span></span>
                    <span class="detail-item">Vol <span id="cult volume">81,241,971</span></span>
                    <span class="detail-item">O <span id="openPrice" class="price">120.50P</span></span>
                    <span class="detail-item">H <span id="highPrice" class="price">123.87Z</span></span>
                    <span class="detail-item">L <span id="lowPrice" class="price">120.15Q</span></span>
                    <span class="detail-item">Val <span id="marketValue">9.993B</span></span>
                </div>
            </div>
        </div>
    `;
    
    // Load the EXEC404 page HTML structure
    // Middle section content
    appContainer.innerHTML = `
        <div class="cultexecs-page">
            <div class="middle-section">
                <!-- Contract Interaction Section -->
                <div id="contractInterface" style="display: none;" class="full-width">
                    <div class="contract-status">
                        <div id="contractStatus" class="status-message">INITIALIZING SYSTEM...</div>
                        
                        <!-- Add Selected Wallet Display -->
                        <div id="selectedWalletDisplay" class="selected-wallet-display">
                            <img id="selectedWalletIcon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E" alt="Selected Wallet">
                            <span class="wallet-name" id="selectedWalletName"></span>
                        </div>
                        <div id="continuePrompt" class="continue-prompt" style="display: none;">
                            CONTINUE IN YOUR WALLET
                        </div>
                        
                        <button id="selectWallet" class="connect-button">
                            <span class="button-text">SELECT WALLET</span>
                        </button>
                    </div>

                    <!-- Add Wallet Selection Modal -->
                    <div id="walletModal" class="wallet-modal">
                        <div class="wallet-modal-content">
                            <h3>Select Your Wallet</h3>
                            <div class="wallet-options">
                                <button class="wallet-option" data-wallet="rabby">
                                    <picture>
                                        <source srcset="public/wallets/rabby.avif" type="image/avif">
                                        <source srcset="public/wallets/rabby.webp" type="image/webp">
                                        <img src="public/wallets/rabby.png" alt="Rabby">
                                    </picture>
                                    <span>Rabby</span>
                                </button>
                                <button class="wallet-option" data-wallet="rainbow">
                                    <picture>
                                        <source srcset="public/wallets/rainbow.avif" type="image/avif">
                                        <source srcset="public/wallets/rainbow.webp" type="image/webp">
                                        <img src="public/wallets/rainbow.png" alt="Rainbow">
                                    </picture>
                                    <span>Rainbow</span>
                                </button>
                                <button class="wallet-option" data-wallet="phantom">
                                    <picture>
                                        <source srcset="public/wallets/phantom.avif" type="image/avif">
                                        <source srcset="public/wallets/phantom.webp" type="image/webp">
                                        <img src="public/wallets/phantom.png" alt="Phantom">
                                    </picture>
                                    <span>Phantom</span>
                                </button>
                                <button class="wallet-option" data-wallet="metamask">
                                    <picture>
                                        <source srcset="public/wallets/metamask.avif" type="image/avif">
                                        <source srcset="public/wallets/metamask.webp" type="image/webp">
                                        <img src="public/wallets/metamask.png" alt="MetaMask">
                                    </picture>
                                    <span>MetaMask</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="bondingCurveInterface" style="display: none;">
                        <div class="presale-info">
                            <h3>EXEC404 PRESALE STATUS</h3>
                            <div class="stats-grid">
                                <div class="stat-item">
                                    <span class="stat-label">TOTAL RAISED:</span>
                                    <span class="stat-value" id="totalRaised">0.00 ETH</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">CURRENT PRICE:</span>
                                    <span class="stat-value" id="currentTokenPrice">0.00 ETH</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">TOKENS REMAINING:</span>
                                    <span class="stat-value" id="tokensRemaining">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- GIF Display -->
                <div class="gif-container">
                    <img src="public/execs/cultexec.gif" alt="Terminal Animation" class="terminal-gif desktop-gif">
                    <img src="public/execs/0109_2.gif" alt="Terminal Animation Mobile" class="terminal-gif mobile-gif">
                </div>
            </div>
        </div>
    `;
    
    // Bottom section content
    appBottomContainer.innerHTML = `
        <div class="bottom-section">
            <!-- Color Bar -->
            <div class="color-bar">
            <div class="yellow-section">CULT EXEC</div>
            <div class="red-section">
                <span>99) Report</span>
                <span class="security-desc">Page 1/4 Security Description: Dual Nature</span>
            </div>
        </div>

        <!-- Tabs -->
        <div class="tabs">
            <div id="whitelistTab" class="tab active">
                <span class="tab-desktop">1) Whitelist Check</span>
                <span class="tab-mobile">Whitelist</span>
            </div>
            <div id="presaleTab" class="tab">
                <span class="tab-desktop">2) Bonding Curve</span>
                <span class="tab-mobile">Presale</span>
            </div>
            <div id="liveTab" class="tab">
                <span class="tab-desktop">3) Live Trading</span>
                <span class="tab-mobile">Live</span>
            </div>
            <div id="statsTab" class="tab">
                <span class="tab-desktop">4) Revenue & Stats</span>
                <span class="tab-mobile">Rev</span>
            </div>
            <div id="mintTab" class="tab">
                <span class="tab-desktop">5) Balance Mint</span>
                <span class="tab-mobile">Mint</span>
            </div>
        </div>

        <!-- Existing content -->
        <main class="main-content">
            <div class="panel checker-panel">
                <h2>1) ADDRESS VERIFICATION | VRF</h2>
                <input type="text" id="walletAddress" placeholder="ENTER ETH ADDRESS" autofocus>
                <p class="instructions desktop">PASTE ADDRESS (CTRL+V) AND PRESS ENTER ↵</p>
                <p class="instructions mobile">PASTE ETH ADDRESS AND TAP GO</p>
                <button id="checkButton">CHECK</button>
                <div id="result"></div>
                
                <div class="market-data">
                    <h2>2) MARKET DATA | MKT</h2>
                    <div class="market-row">
                        <span>ETH/USD</span>
                        <span class="price-up" id="ethPrice">13,482.45 +2.3%</span>
                    </div>
                    <div class="market-row">
                        <span>GAS (GWEI)</span>
                        <span class="price-down" id="gasPrice">0.004 -5</span>
                    </div>
                    <div class="market-row">
                        <span>24H VOLUME</span>
                        <span id="ethVolume">10.2B ETH</span>
                    </div>
                </div>
            </div>
            
            <div class="panel stats-panel">
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
            </div>
        </main>

        <footer class="news-ticker">
            <div class="ticker-content">
                <span class="ticker-item">SYSTEM ONLINE</span>
                <span class="ticker-item">ETH NETWORK: HIGH ACTIVITY</span>
                <span class="ticker-item">API V2.1.0 DEPLOYED</span>
                <span class="ticker-item">CACHE UPDATED: 30S AGO</span>
                <span class="ticker-item">NEW ADDRESSES INDEXED: 1.2K</span>
                <span class="ticker-item">VERIFICATION RATE: 240/MIN</span>
            </div>
        </footer>
        </div>
    `;
    
    // Initialize message popup
    messagePopup = new MessagePopup();
    
    // Initialize EXEC404 functionality
    await initializeCultExecs();
    
    // Return cleanup function
    return {
        cleanup: () => {
            console.log('[CultExecsPage] Starting cleanup...');
            
            // Cleanup event listeners and components
            if (walletConnector && typeof walletConnector.cleanup === 'function') {
                walletConnector.cleanup();
            }
            
            // Remove event listeners using stored references
            if (eventHandlers.walletConnected) {
                eventBus.off('wallet:connected', eventHandlers.walletConnected);
                eventHandlers.walletConnected = null;
            }
            if (eventHandlers.contractError) {
                eventBus.off('contract:error', eventHandlers.contractError);
                eventHandlers.contractError = null;
            }
            if (eventHandlers.transactionSent) {
                eventBus.off('transaction:sent', eventHandlers.transactionSent);
                eventHandlers.transactionSent = null;
            }
            if (eventHandlers.transactionConfirmed) {
                eventBus.off('transaction:confirmed', eventHandlers.transactionConfirmed);
                eventHandlers.transactionConfirmed = null;
            }
            if (eventHandlers.transactionFailed) {
                eventBus.off('transaction:failed', eventHandlers.transactionFailed);
                eventHandlers.transactionFailed = null;
            }
            
            // Clean up trading interface if it exists
            if (window.tradingInterfaceInstance) {
                try {
                    if (typeof window.tradingInterfaceInstance.unmount === 'function') {
                        window.tradingInterfaceInstance.unmount();
                    }
                } catch (error) {
                    console.warn('[CultExecsPage] Error unmounting trading interface:', error);
                }
                delete window.tradingInterfaceInstance;
            }
            
            // Reset global state flags
            delete window.contractInterfaceInitialized;
            delete window.tradingInterfaceInitialized;
            
            // Clean up tab navigation handlers
            tabClickHandlers.forEach((handler, tab) => {
                tab.removeEventListener('click', handler);
            });
            tabClickHandlers.clear();
            
            // Reset component references
            walletConnector = null;
            messagePopup = null;
            
            // Remove body class for CULT EXEC styling
            document.body.classList.remove('cultexecs-active');
            
            console.log('[CultExecsPage] Cleanup complete');
        }
    };
}

/**
 * Initialize CULT EXECS functionality
 */
async function initializeCultExecs() {
    try {
        // Get contract interface
        const contractInterface = document.getElementById('contractInterface');
        const gifContainer = document.querySelector('.gif-container');
        
        // Check if switch.json exists and handle GIF/interface visibility
        await checkAndHandleSwitch(gifContainer, contractInterface);
        
        // Initialize wallet service
        if (!walletService.isInitialized) {
            await walletService.initialize();
        }
        
        // Initialize UI components
        initializeUIComponents(contractInterface);
        
        // Show contract interface only after successful connection
        // Store handler reference for cleanup
        eventHandlers.walletConnected = (data) => {
            if (gifContainer) {
                gifContainer.style.display = 'none';
            }
            if (contractInterface) {
                contractInterface.style.display = 'block';
            }
            const bondingInterface = document.getElementById('bondingCurveInterface');
            if (bondingInterface) {
                bondingInterface.style.display = 'block';
            }
            const whitelistTab = document.querySelector('#whitelistTab');
            const presaleTab = document.querySelector('#presaleTab');
            if (whitelistTab && presaleTab) {
                whitelistTab.classList.remove('active');
                presaleTab.classList.add('active');
            }
            document.body.classList.add('contract-interface-active');
        };
        eventBus.on('wallet:connected', eventHandlers.walletConnected);
        
        // Initialize app.js functionality (animations, price updates, whitelist checker)
        // These are defined in app.js and should be available globally
        // Use requestAnimationFrame to ensure DOM is fully rendered
        requestAnimationFrame(() => {
            // Double-check DOM is ready
            const walletAddressInput = document.getElementById('walletAddress');
            const checkButton = document.getElementById('checkButton');
            
            if (walletAddressInput && checkButton) {
                if (window.initializeAnimations) {
                    window.initializeAnimations();
                }
                if (window.initializePriceUpdates) {
                    window.initializePriceUpdates();
                }
                if (window.initializeWhitelistChecker) {
                    window.initializeWhitelistChecker();
                }
            } else {
                // Retry after a short delay if elements aren't ready
                setTimeout(() => {
                    if (window.initializeAnimations) {
                        window.initializeAnimations();
                    }
                    if (window.initializePriceUpdates) {
                        window.initializePriceUpdates();
                    }
                    if (window.initializeWhitelistChecker) {
                        window.initializeWhitelistChecker();
                    }
                }, 200);
            }
        });
        
    } catch (error) {
        console.error('Failed to initialize CULT EXECS:', error);
        if (messagePopup) {
            messagePopup.error(error.message, 'Initialization Error');
        }
    }
}

/**
 * Check if switch.json exists and handle GIF/interface visibility
 */
async function checkAndHandleSwitch(gifContainer, contractInterface) {
    try {
        // Don't use global flag to prevent re-initialization - check fresh each time
        const switchResult = await fetch('/EXEC404/switch.json');
        
        if (switchResult.ok) {
            if (gifContainer) {
                gifContainer.style.display = 'none';
            }
            if (contractInterface) {
                contractInterface.style.display = 'block';
            }
            return true;
        } else {
            if (gifContainer) {
                gifContainer.style.display = 'flex';
            }
            if (contractInterface) {
                contractInterface.style.display = 'none';
            }
            return false;
        }
    } catch (error) {
        console.error('Error checking for switch.json:', error);
        // On error, show GIF container
        if (gifContainer) {
            gifContainer.style.display = 'flex';
        }
        if (contractInterface) {
            contractInterface.style.display = 'none';
        }
        return false;
    }
}

/**
 * Initialize UI components
 */
function initializeUIComponents(container) {
    let walletContainer = document.querySelector('.contract-status');
    
    if (!walletContainer) {
        walletContainer = document.createElement('div');
        walletContainer.id = 'walletConnector';
        walletContainer.className = 'wallet-connector-container';
        container.appendChild(walletContainer);
    } else if (!walletContainer.id) {
        walletContainer.id = 'walletConnector';
    }
    
    walletConnector = new WalletConnector(walletContainer.id);
    
    // Set up event handlers - store references for cleanup
    eventHandlers.contractError = (data) => {
        if (messagePopup) {
            messagePopup.error(data.message, 'Contract Error');
        }
    };
    eventBus.on('contract:error', eventHandlers.contractError);
    
    eventHandlers.transactionSent = (data) => {
        if (messagePopup) {
            messagePopup.info(`Transaction sent: ${data.hash ? data.hash.slice(0, 6) + '...' + data.hash.slice(-4) : 'Unknown'}`, 'Transaction Pending');
        }
    };
    eventBus.on('transaction:sent', eventHandlers.transactionSent);
    
    eventHandlers.transactionConfirmed = (data) => {
        if (messagePopup) {
            messagePopup.success(`Transaction confirmed!`, 'Success');
        }
    };
    eventBus.on('transaction:confirmed', eventHandlers.transactionConfirmed);
    
    eventHandlers.transactionFailed = (data) => {
        if (messagePopup) {
            messagePopup.error(data.error, 'Transaction Failed');
        }
    };
    eventBus.on('transaction:failed', eventHandlers.transactionFailed);
    
    // Set up tab navigation
    setupTabNavigation();
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab');
    
    if (!tabs.length) return;
    
    // Clear existing handlers
    tabClickHandlers.forEach((handler, tab) => {
        tab.removeEventListener('click', handler);
    });
    tabClickHandlers.clear();
    
    tabs.forEach(tab => {
        const handler = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            if (tab.id === 'presaleTab') {
                if (walletService.isConnected()) {
                    const bondingInterface = document.getElementById('bondingCurveInterface');
                    if (bondingInterface) {
                        bondingInterface.style.display = 'block';
                    }
                }
            }
        };
        tab.addEventListener('click', handler);
        tabClickHandlers.set(tab, handler);
    });
}

