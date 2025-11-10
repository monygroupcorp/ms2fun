import stylesheetLoader from '../utils/stylesheetLoader.js';
import { ProjectDiscovery } from '../components/ProjectDiscovery/ProjectDiscovery.js';
import { WalletSplash } from '../components/WalletSplash/WalletSplash.js';
import walletService from '../services/WalletService.js';
import { eventBus } from '../core/EventBus.js';

/**
 * Home page route handler
 * This is the new landing page for the launchpad
 */
export function renderHomePage() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');
    
    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }
    
    // Load home page specific stylesheet
    stylesheetLoader.load('src/routes/home.css', 'home-styles');
    // Load wallet splash stylesheet
    stylesheetLoader.load('src/components/WalletSplash/WalletSplash.css', 'wallet-splash-styles');
    
    // Unload CULT EXEC styles if they were loaded
    stylesheetLoader.unload('cultexecs-styles');
    
    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';
    
    // Create container for wallet splash (overlay)
    const splashContainer = document.createElement('div');
    splashContainer.id = 'wallet-splash-container';
    document.body.appendChild(splashContainer);
    
    // Create container for ProjectDiscovery
    const discoveryContainer = document.createElement('div');
    discoveryContainer.id = 'project-discovery-container';
    appContainer.appendChild(discoveryContainer);
    
    // Mount ProjectDiscovery component (will be hidden until wallet connects)
    const projectDiscovery = new ProjectDiscovery();
    projectDiscovery.mount(discoveryContainer);
    
    // Function to show discovery and hide splash
    const showDiscovery = () => {
        discoveryContainer.style.display = 'block';
        if (splashContainer) {
            splashContainer.style.display = 'none';
        }
    };
    
    // Function to hide discovery and show splash
    const hideDiscovery = () => {
        discoveryContainer.style.display = 'none';
        if (splashContainer) {
            splashContainer.style.display = 'flex';
        }
    };
    
    // Mount WalletSplash component
    const walletSplash = new WalletSplash(() => {
        // Callback when wallet connects - show discovery
        showDiscovery();
    });
    walletSplash.mount(splashContainer);
    
    // Check if wallet is already connected (after a short delay to ensure wallet service is initialized)
    setTimeout(async () => {
        try {
            if (!walletService.isInitialized) {
                await walletService.initialize();
            }
            
            if (walletService.isConnected()) {
                // Wallet already connected, show discovery immediately
                showDiscovery();
            } else {
                // Wallet not connected, hide discovery
                hideDiscovery();
            }
        } catch (error) {
            console.error('Error checking wallet connection:', error);
            hideDiscovery();
        }
    }, 100);
    
    // Listen for wallet disconnection
    const unsubscribeDisconnected = eventBus.on('wallet:disconnected', () => {
        hideDiscovery();
    });
    
    // Return cleanup function
    return {
        cleanup: () => {
            // Unsubscribe from events
            if (unsubscribeDisconnected) {
                unsubscribeDisconnected();
            }
            
            // Unmount components
            if (walletSplash && typeof walletSplash.unmount === 'function') {
                walletSplash.unmount();
            }
            if (projectDiscovery && typeof projectDiscovery.unmount === 'function') {
                projectDiscovery.unmount();
            }
            
            // Remove splash container from body
            if (splashContainer && splashContainer.parentNode) {
                splashContainer.parentNode.removeChild(splashContainer);
            }
            
            // Unload stylesheets
            stylesheetLoader.unload('wallet-splash-styles');
            // stylesheetLoader.unload('home-styles');
        }
    };
}

