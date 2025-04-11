import { eventBus } from './core/EventBus.js';
import walletService from './services/WalletService.js';
import WalletConnector from './components/WalletConnector/WalletConnector.js';
import MessagePopup from './components/MessagePopup/MessagePopup.js';

// Add performance markers for monitoring
performance.mark('startApp');

// Initialize message popup system
const messagePopup = new MessagePopup();

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        console.log('Initializing blockchain application...');
        
        // Add global unhandled rejection handler for wallet errors
        window.addEventListener('unhandledrejection', event => {
            const error = event.reason;
            
            // Log all unhandled rejections
            console.warn('Global unhandled rejection:', error);
            
            // Specifically handle wallet account errors
            if (error && error.message && error.message.includes('wallet must has at least one account')) {
                console.error('Caught wallet account error:', error.message);
                messagePopup.warning('Your wallet has no accounts. Please create at least one account in your wallet and try again.', 'Wallet Error');
                
                // Prevent the error from showing in console as unhandled
                event.preventDefault();
            }
        });
        
        // Mark component loading
        performance.mark('componentsLoading');
        
        // Get contract interface
        let contractInterface = document.getElementById('contractInterface');
        if (!contractInterface) {
            console.warn('Contract interface element not found, creating a fallback');
            // Create a fallback container if needed
            const fallbackContainer = document.createElement('div');
            fallbackContainer.id = 'contractInterface';
            fallbackContainer.className = 'contract-interface-fallback';
            document.body.appendChild(fallbackContainer);
            
            // Use the fallback
            contractInterface = fallbackContainer;
        }
        
        // Get GIF container 
        const gifContainer = document.querySelector('.gif-container');
        
        // Hide GIF if switch.json exists
        await checkAndHandleSwitch(gifContainer, contractInterface);
        
        // Initialize wallet service
        await initializeServices();
        
        // Initialize UI components
        initializeUIComponents(contractInterface);
        
        // Show contract interface only after successful connection
        eventBus.on('wallet:connected', (data) => {
            // Make sure GIF is hidden
            if (gifContainer) {
                console.log('Wallet connected, hiding GIF container');
                gifContainer.style.display = 'none';
            }
            
            // Show contract interface
            if (contractInterface) {
                contractInterface.style.display = 'block';
            }
            
            // Show bonding curve interface
            const bondingInterface = document.getElementById('bondingCurveInterface');
            if (bondingInterface) {
                console.log('Showing bonding curve interface');
                bondingInterface.style.display = 'block';
            }
            
            // Change active tab to presale
            const whitelistTab = document.querySelector('#whitelistTab');
            const presaleTab = document.querySelector('#presaleTab');
            
            if (whitelistTab && presaleTab) {
                whitelistTab.classList.remove('active');
                presaleTab.classList.add('active');
            }
            
            document.body.classList.add('contract-interface-active');
        });
        
        // Mark components loaded
        performance.mark('componentsLoaded');
        performance.measure('componentLoadTime', 'componentsLoading', 'componentsLoaded');
        
        console.log('Blockchain app initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Show error using MessagePopup
        messagePopup.error(error.message, 'Initialization Error');
    }
}

/**
 * Check if switch.json exists and handle GIF/interface visibility
 */
async function checkAndHandleSwitch(gifContainer, contractInterface) {
    try {
        // Check if we've already initialized
        if (window.contractInterfaceInitialized) {
            console.log('Contract interface already initialized, skipping switch check');
            return true;
        }
        
        const switchResult = await fetch('/EXEC404/switch.json');
        
        if (switchResult.ok) {
            console.log('EXEC404/switch.json exists, hiding GIF and showing contract interface');
            
            // Hide GIF
            if (gifContainer) {
                gifContainer.style.display = 'none';
            }
            
            // Show contract interface
            if (contractInterface) {
                contractInterface.style.display = 'block';
            }
            
            // Mark as initialized
            window.contractInterfaceInitialized = true;
            
            return true;
        } else {
            console.log('switch.json not found or not accessible');
            
            // Show GIF, hide contract interface
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
        return false;
    }
}

/**
 * Initialize services
 */
async function initializeServices() {
    try {
        console.log('Initializing services...');
        
        // Check if wallet service is already initialized
        if (!walletService.isInitialized) {
            // Initialize wallet service
            await walletService.initialize();
            console.log('Wallet service initialized');
        } else {
            console.log('Wallet service already initialized');
        }
        
        return true;
    } catch (error) {
        console.error('Service initialization error:', error);
        throw error;
    }
}

/**
 * Initialize UI components
 * @param {HTMLElement} container - The container element
 */
function initializeUIComponents(container) {
    console.log('Initializing UI components...');
    
    // Check if wallet connector already initialized
    if (window.walletConnectorInitialized) {
        console.log('Wallet connector already initialized, skipping');
        return;
    }
    
    // Use the existing contract status container if it exists
    let walletContainer = document.querySelector('.contract-status');
    
    // If no contract status container exists, create a wallet container
    if (!walletContainer) {
        walletContainer = document.createElement('div');
        walletContainer.id = 'walletConnector';
        walletContainer.className = 'wallet-connector-container';
        container.appendChild(walletContainer);
    } else if (!walletContainer.id) {
        // Ensure the container has an ID
        walletContainer.id = 'walletConnector';
    }
    
    console.log('Wallet container ID:', walletContainer.id);
    
    // Initialize wallet connector with the container ID
    const walletConnector = new WalletConnector(walletContainer.id);
    
    // Set up event handlers for contract events
    eventBus.on('contract:error', (data) => {
        messagePopup.error(data.message, 'Contract Error');
    });
    
    // Handle transaction events
    eventBus.on('transaction:sent', (data) => {
        messagePopup.info(`Transaction sent: ${data.hash ? data.hash.slice(0, 6) + '...' + data.hash.slice(-4) : 'Unknown'}`, 'Transaction Pending');
    });
    
    eventBus.on('transaction:confirmed', (data) => {
        messagePopup.success(`Transaction confirmed!`, 'Success');
    });
    
    eventBus.on('transaction:failed', (data) => {
        messagePopup.error(data.error, 'Transaction Failed');
    });
    
    // Set up the tab navigation
    setupTabNavigation();
    
    // Load CSS for wallet connector if not already loaded
    loadStylesheet('./components/WalletConnector/WalletConnector.css');
    
    // Mark as initialized
    window.walletConnectorInitialized = true;
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab');
    
    if (!tabs.length) return;
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Handle different tab actions
            if (tab.id === 'presaleTab') {
                // Show bonding curve interface if a wallet is connected
                if (walletService.isConnected()) {
                    const bondingInterface = document.getElementById('bondingCurveInterface');
                    if (bondingInterface) {
                        bondingInterface.style.display = 'block';
                    }
                }
            }
        });
    });
}

/**
 * Load a stylesheet dynamically
 * @param {string} href - The stylesheet URL
 */
function loadStylesheet(href) {
    // Check if already loaded
    if (document.querySelector(`link[href="${href}"]`)) return;
    
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization slightly to avoid conflicts with wallet injections
    setTimeout(() => {
        initializeApp();
    }, 100);
});