import { eventBus } from './core/EventBus.js';
import walletService from './services/WalletService.js';
import MessagePopup from './components/MessagePopup/MessagePopup.js';
import Router from './core/Router.js';
import { renderHomePage } from './routes/HomePage.js';
import { renderCultExecsPage } from './routes/CultExecsPage.js';
import serviceFactory from './services/ServiceFactory.js';
import { testMockSystem } from './services/mock/test-mock-system.js';

// Add performance markers for monitoring
performance.mark('startApp');

// Initialize message popup system
const messagePopup = new MessagePopup();

/**
 * Initialize the application with routing
 */
async function initializeApp() {
    try {
        console.log('Initializing blockchain application with routing...');
        
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
        
        // Initialize wallet service
        await initializeServices();
        
        // Initialize router
        const router = new Router();
        window.router = router; // Make router globally available
        
        // Expose mock system test globally for console testing
        if (serviceFactory.isUsingMock()) {
            window.testMockSystem = testMockSystem;
            window.serviceFactory = serviceFactory;
            console.log('💡 Mock system loaded! Run testMockSystem() in the console to test.');
        }
        
        // Register routes
        router.on('/', renderHomePage);
        router.on('/cultexecs', renderCultExecsPage);
        router.on('/about', async () => {
            const { renderDocumentation } = await import('./routes/Documentation.js');
            return renderDocumentation();
        });
        router.on('/docs', async () => {
            const { renderDocumentation } = await import('./routes/Documentation.js');
            return renderDocumentation();
        });
        
        // Register dynamic routes (order matters - more specific first)
        // Edition detail route (most specific - must come before /project/:id)
        router.on('/project/:projectId/edition/:editionId', async (params) => {
            const { renderEditionDetail } = await import('./routes/EditionDetail.js');
            return renderEditionDetail(params);
        });
        
        // Triple-level route for ERC1155 pieces with chain ID
        router.on('/:chainId/:factoryTitle/:instanceName/:pieceTitle', async (params) => {
            const { renderPieceDetail } = await import('./routes/PieceDetail.js');
            return renderPieceDetail(params);
        });
        
        // Double-level route for projects with chain ID (less specific)
        router.on('/:chainId/:factoryTitle/:instanceName', async (params) => {
            const { renderProjectDetail } = await import('./routes/ProjectDetail.js');
            return renderProjectDetail(params);
        });
        
        // Address-based route for backward compatibility
        router.on('/project/:id', async (params) => {
            const { renderProjectDetail } = await import('./routes/ProjectDetail.js');
            return renderProjectDetail(params);
        });
        
        router.on('/factory/:id', async (params) => {
            const { renderFactoryDetail } = await import('./routes/FactoryDetail.js');
            return renderFactoryDetail(params);
        });
        
        router.on('/create', async () => {
            const { renderProjectCreation } = await import('./routes/ProjectCreation.js');
            return renderProjectCreation();
        });
        
        router.on('/factories', async () => {
            const { renderFactoryExploration } = await import('./routes/FactoryExploration.js');
            return renderFactoryExploration();
        });
        
        // Register 404 handler
        router.notFound((path) => {
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.innerHTML = `
                    <div class="error-page">
                        <h1>404 - Page Not Found</h1>
                        <p>The page "${path}" does not exist.</p>
                        <a href="/" class="home-link">Go Home</a>
                    </div>
                `;
            }
        });
        
        // Start the router
        await router.start();
        
        console.log('Router initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        // Show error using MessagePopup
        messagePopup.error(error.message, 'Initialization Error');
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


// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization slightly to avoid conflicts with wallet injections
    setTimeout(() => {
        initializeApp();
    }, 100);
});