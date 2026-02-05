import { eventBus } from './core/EventBus.js';
import walletService from './services/WalletService.js';
import MessagePopup from './components/MessagePopup/MessagePopup.js';
import Router from './core/Router.js';
import { renderHomePage } from './routes/HomePage.js';
import { renderCultExecsPage } from './routes/CultExecsPage.js';
import serviceFactory from './services/ServiceFactory.js';
import { testMockSystem } from './services/mock/test-mock-system.js';
import { FloatingWalletButton } from './components/FloatingWalletButton/FloatingWalletButton.microact.js';
import { h, render, unmountRoot } from './core/microact-setup.js';
import stylesheetLoader from './utils/stylesheetLoader.js';
import contractReloadService from './services/ContractReloadService.js';

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

        // Expose serviceFactory globally for debugging
        window.serviceFactory = serviceFactory;

        // Expose mock system test globally for console testing
        if (serviceFactory.isUsingMock()) {
            window.testMockSystem = testMockSystem;
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

        // Create route with chain ID and factory title (new format)
        router.on('/:chainId/:factoryTitle/create', async (params) => {
            const { renderProjectCreation } = await import('./routes/ProjectCreation.js');
            return renderProjectCreation(params);
        });

        // Three-part route - could be either project or edition
        // /:chainId/:factoryTitle/:instanceName (project with factory)
        // /:chainId/:instanceName/:pieceTitle (edition)
        router.on('/:chainId/:param1/:param2', async (params) => {
            // Try to load config to check if param1 is a factory
            try {
                const configResponse = await fetch('/src/config/contracts.local.json');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    const slugify = (text) => {
                        if (!text) return '';
                        return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    };

                    const factory = config.factories?.find(f =>
                        slugify(f.title) === slugify(params.param1)
                    );

                    if (factory) {
                        // It's a factory title, so render project detail
                        const { renderProjectDetail } = await import('./routes/ProjectDetail.js');
                        return renderProjectDetail({
                            chainId: params.chainId,
                            factoryTitle: params.param1,
                            instanceName: params.param2
                        });
                    }
                }
            } catch (error) {
                console.warn('[Router] Failed to check factory config:', error);
            }

            // Not a factory, so treat as edition detail
            const { renderEditionDetail } = await import('./routes/EditionDetail.js');
            return renderEditionDetail({
                chainId: params.chainId,
                instanceName: params.param1,
                pieceTitle: params.param2
            });
        });

        // Two-part route for projects without factory (simpler format)
        router.on('/:chainId/:instanceName', async (params) => {
            const { renderProjectDetail } = await import('./routes/ProjectDetail.js');
            return renderProjectDetail(params);
        });

        // NFT Gallery route for ERC404 projects
        router.on('/project/:id/gallery', async (params) => {
            const { renderNFTGalleryPage } = await import('./routes/NFTGalleryPage.js');
            return renderNFTGalleryPage(params);
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
        
        // Old create route for backward compatibility
        router.on('/create', async () => {
            const { renderProjectCreation } = await import('./routes/ProjectCreation.js');
            return renderProjectCreation();
        });
        
        router.on('/factories', async () => {
            const { renderFactoryExploration } = await import('./routes/FactoryExploration.js');
            return renderFactoryExploration();
        });

        router.on('/factories/apply', async () => {
            const { renderFactoryApplicationPage } = await import('./routes/FactoryApplicationPage.js');
            return renderFactoryApplicationPage();
        });

        router.on('/factories/application/:address', async (params) => {
            const { renderFactoryApplicationStatusPage } = await import('./routes/FactoryApplicationStatusPage.js');
            return renderFactoryApplicationStatusPage(params);
        });

        router.on('/voting', async () => {
            const { renderExecVotingDashboard } = await import('./routes/ExecVotingDashboard.js');
            return renderExecVotingDashboard();
        });

        router.on('/exec/voting', async () => {
            const { renderExecVotingDashboard } = await import('./routes/ExecVotingDashboard.js');
            return renderExecVotingDashboard();
        });

        // Vault routes
        router.on('/vaults', async () => {
            const { renderVaultExplorer } = await import('./routes/VaultExplorer.js');
            return renderVaultExplorer();
        });

        router.on('/vaults/:address', async (params) => {
            const { renderVaultDetail } = await import('./routes/VaultDetail.js');
            return renderVaultDetail(params);
        });

        // Global activity feed route
        router.on('/messages', async () => {
            const { renderGlobalActivityFeed } = await import('./routes/GlobalActivityFeed.js');
            return renderGlobalActivityFeed();
        });

        // Portfolio route (user holdings + settings)
        router.on('/portfolio', async () => {
            const { renderPortfolio } = await import('./routes/Portfolio.js');
            return renderPortfolio();
        });

        // Register 404 handler
        router.notFound((path) => {
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.innerHTML = `
                    <div class="error-page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem;">
                        <h1 style="font-size: 4rem; margin-bottom: 2rem;">404</h1>
                        <img src="/public/execs/0109_2.gif" alt="404" style="max-width: 100%; height: auto;" />
                    </div>
                `;
            }
        });
        
        // Start the router
        await router.start();

        console.log('Router initialized successfully');

        // Add FloatingWalletButton globally (appears on all pages)
        initializeFloatingWalletButton();

        // Mark body as ready to show content (removes loading overlay)
        document.body.classList.add('app-ready');
        
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

        // Initialize service factory (checks RPC availability, falls back to mock)
        await serviceFactory.initialize();
        console.log('Service factory initialized, mode:', serviceFactory.isUsingMock() ? 'mock' : 'real');

        // Check if wallet service is already initialized
        if (!walletService.isInitialized) {
            // Initialize wallet service
            await walletService.initialize();
            console.log('Wallet service initialized');
        } else {
            console.log('Wallet service already initialized');
        }

        // Start contract reload service (local dev only - skip in mock mode)
        if (!serviceFactory.isUsingMock()) {
            contractReloadService.start();
        }

        // Read-only mode is now lazy-loaded only when user clicks "Continue" on splash screen
        // No auto-initialization here

        return true;
    } catch (error) {
        console.error('Service initialization error:', error);
        throw error;
    }
}

/**
 * Initialize FloatingWalletButton globally
 * This button appears on all pages and provides wallet connection + power user menu
 */
function initializeFloatingWalletButton() {
    try {
        // Load stylesheet
        stylesheetLoader.load(
            'src/components/FloatingWalletButton/FloatingWalletButton.css',
            'floating-wallet-button-styles'
        );

        // Create container for FloatingWalletButton
        const floatingWalletContainer = document.createElement('div');
        floatingWalletContainer.id = 'floating-wallet-container-global';
        document.body.appendChild(floatingWalletContainer);

        // Mount FloatingWalletButton using microact render
        render(h(FloatingWalletButton), floatingWalletContainer);

        // Store container for potential cleanup
        window.floatingWalletContainer = floatingWalletContainer;

        console.log('FloatingWalletButton initialized globally');
    } catch (error) {
        console.error('Failed to initialize FloatingWalletButton:', error);
    }
}

/**
 * Initialize read-only mode for wallet-free blockchain access
 * Called on-demand when user clicks "Continue" button on splash screen
 * @returns {Promise<boolean>} True if initialized successfully
 */
export async function initializeReadOnlyMode() {
    try {
        // Dynamically import ReadOnlyService
        const { default: readOnlyService } = await import('./services/ReadOnlyService.js');
        
        // Initialize read-only service
        await readOnlyService.initialize();
        
        console.log('Read-only mode initialized');
        return true;
    } catch (error) {
        // Read-only mode is optional, so we don't throw
        console.warn('Read-only mode not available:', error.message);
        return false;
    }
}


// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization slightly to avoid conflicts with wallet injections
    setTimeout(() => {
        initializeApp();
        
        // Performance monitoring is disabled by default to avoid overhead
        // Enable with: ?performance=true in URL or run enablePerformanceMonitoring() in console
        // initializePerformanceMonitoring();
    }, 100);
});

/**
 * Performance monitoring state
 */
let performanceMonitoringState = {
    isEnabled: false,
    services: {
        scrollMonitor: null,
        tracker: null,
        reporter: null
    },
    updateInterval: null
};

/**
 * Initialize performance monitoring system
 * Can be toggled on/off via query parameter or localStorage
 */
async function initializePerformanceMonitoring() {
    // Check if performance monitoring should be enabled
    const urlParams = new URLSearchParams(window.location.search);
    const queryParamEnabled = urlParams.get('performance') === 'true';
    const localStorageEnabled = localStorage.getItem('ms2fun-performance-monitoring') === 'true';
    
    // Enable if query param is set, or if it was previously enabled in localStorage
    const shouldEnable = queryParamEnabled || localStorageEnabled;

    if (!shouldEnable) {
        // Still expose the toggle function for manual control
        exposePerformanceToggle();
        return;
    }

    try {
        // Dynamically import to avoid blocking initial load
        const [
            { scrollPerformanceMonitor },
            { performanceTracker },
            { performanceReporter }
        ] = await Promise.all([
            import('./services/ScrollPerformanceMonitor.js'),
            import('./services/PerformanceTracker.js'),
            import('./utils/PerformanceReporter.js')
        ]);

        // Store references
        performanceMonitoringState.services.scrollMonitor = scrollPerformanceMonitor;
        performanceMonitoringState.services.tracker = performanceTracker;
        performanceMonitoringState.services.reporter = performanceReporter;

        // Start all services
        scrollPerformanceMonitor.start();
        performanceTracker.start();
        performanceReporter.start();

        // Update tracker with scroll metrics periodically
        performanceMonitoringState.updateInterval = setInterval(() => {
            const scrollMetrics = scrollPerformanceMonitor.getMetrics();
            performanceTracker.updateScrollMetrics(scrollMetrics);
        }, 5000); // Update every 5 seconds

        performanceMonitoringState.isEnabled = true;

        // Expose toggle function
        exposePerformanceToggle();

        console.log('✅ Performance monitoring enabled - reports will appear in console automatically');
        console.log('💡 To disable: Run togglePerformanceMonitoring(false) in console or add ?performance=false to URL');
    } catch (error) {
        // Performance monitoring is non-critical, so we don't throw
        console.warn('Performance monitoring not available:', error.message);
    }
}

/**
 * Expose performance monitoring toggle function globally
 */
function exposePerformanceToggle() {
    window.togglePerformanceMonitoring = async (enabled = null) => {
        // If no argument, toggle current state
        if (enabled === null) {
            enabled = !performanceMonitoringState.isEnabled;
        }

        if (enabled && !performanceMonitoringState.isEnabled) {
            // Enable performance monitoring
            await initializePerformanceMonitoring();
            localStorage.setItem('ms2fun-performance-monitoring', 'true');
            console.log('✅ Performance monitoring enabled');
        } else if (!enabled && performanceMonitoringState.isEnabled) {
            // Disable performance monitoring
            stopPerformanceMonitoring();
            localStorage.setItem('ms2fun-performance-monitoring', 'false');
            console.log('⏸️ Performance monitoring disabled');
        } else {
            console.log(`Performance monitoring is already ${enabled ? 'enabled' : 'disabled'}`);
        }
    };

    // Also expose a simple on/off function
    window.enablePerformanceMonitoring = () => window.togglePerformanceMonitoring(true);
    window.disablePerformanceMonitoring = () => window.togglePerformanceMonitoring(false);

    // Log help message
    if (!performanceMonitoringState.isEnabled) {
        console.log('💡 Performance monitoring is disabled. To enable:');
        console.log('   - Run: enablePerformanceMonitoring()');
        console.log('   - Or add ?performance=true to URL');
    }
}

/**
 * Stop all performance monitoring services
 */
function stopPerformanceMonitoring() {
    if (!performanceMonitoringState.isEnabled) {
        return;
    }

    const { scrollMonitor, tracker, reporter } = performanceMonitoringState.services;

    if (scrollMonitor) {
        scrollMonitor.stop();
    }

    if (tracker) {
        tracker.stop();
    }

    if (reporter) {
        reporter.stop();
    }

    if (performanceMonitoringState.updateInterval) {
        clearInterval(performanceMonitoringState.updateInterval);
        performanceMonitoringState.updateInterval = null;
    }

    performanceMonitoringState.isEnabled = false;
}