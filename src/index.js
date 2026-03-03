import { eventBus } from './core/EventBus.js';
import walletService from './services/WalletService.js';
import MessagePopup from './components/MessagePopup/MessagePopup.js';
import Router from './core/Router.js';
import { HomePage } from './routes/HomePage.js';
import { ProjectDiscovery } from './routes/ProjectDiscovery.js';
import { Activity } from './routes/Activity.js';
import { Portfolio } from './routes/Portfolio.js';
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
        }
        
        // Initialize web3 infrastructure once (shared across all routes)
        let web3Context = null;
        async function ensureWeb3Ready() {
            if (web3Context) return web3Context;

            const EnvironmentDetector = (await import('./services/EnvironmentDetector.js')).EnvironmentDetector;
            const providerManager = (await import('./services/ProviderManager.js')).default;

            const { provider, type: providerType } = await providerManager.initialize();
            const detector = new EnvironmentDetector();
            const { mode, config } = await detector.detect();

            web3Context = { provider, providerType, mode, config, web3Ready: true };
            return web3Context;
        }

        // Register routes
        router.on('/', async () => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            if (!appContainer) {
                console.error('App container not found');
                return;
            }

            // Clear ALL containers
            appContainer.innerHTML = '';
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';

            // KILL all old Temple of Capital classes
            document.body.classList.remove(
                'marble-bg',
                'marble-smooth-render',
                'marble-pos-a',
                'marble-pos-b',
                'marble-pos-c',
                'marble-pos-d',
                'cultexecs-active'
            );

            // Add v2 class to body for styling
            document.body.classList.add('v2-route');

            // Ensure web3 is ready before rendering
            const web3 = await ensureWeb3Ready();

            // Render v2 HomePage component with web3 context
            render(h(HomePage, web3), appContainer);

            return {
                cleanup: () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:home');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Discovery page - browse all projects
        router.on('/discover', async () => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            if (!appContainer) {
                console.error('App container not found');
                return;
            }

            // Clear ALL containers
            appContainer.innerHTML = '';
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';

            // KILL all old Temple of Capital classes
            document.body.classList.remove(
                'marble-bg',
                'marble-smooth-render',
                'marble-pos-a',
                'marble-pos-b',
                'marble-pos-c',
                'marble-pos-d',
                'cultexecs-active'
            );

            // Add v2 class to body for styling
            document.body.classList.add('v2-route');

            // Ensure web3 is ready before rendering
            const web3 = await ensureWeb3Ready();

            // Render v2 ProjectDiscovery component with web3 context
            render(h(ProjectDiscovery, web3), appContainer);

            return {
                cleanup: () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:discovery');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Activity page - platform-wide activity feed
        router.on('/activity', async () => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            if (!appContainer) {
                console.error('App container not found');
                return;
            }

            // Clear ALL containers
            appContainer.innerHTML = '';
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';

            // KILL all old Temple of Capital classes
            document.body.classList.remove(
                'marble-bg',
                'marble-smooth-render',
                'marble-pos-a',
                'marble-pos-b',
                'marble-pos-c',
                'marble-pos-d',
                'cultexecs-active'
            );

            // Add v2 class to body for styling
            document.body.classList.add('v2-route');

            // Ensure web3 is ready before rendering
            const web3 = await ensureWeb3Ready();

            // Render v2 Activity component with web3 context
            render(h(Activity, web3), appContainer);

            return {
                cleanup: () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:activity');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

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

        // Legacy create route with chain ID and factory title — redirect to /create
        router.on('/:chainId/:factoryTitle/create', async () => {
            window.location.href = '/create';
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
        
        // Project creation wizard (v2)
        router.on('/create', async () => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            appTopContainer.innerHTML = '';
            appContainer.innerHTML = '';
            appBottomContainer.innerHTML = '';

            document.body.classList.remove('marble-bg', 'obsidian-bg');
            document.body.classList.add('v2-route');

            const { default: ProjectCreationPage } = await import('./routes/ProjectCreationPage.js');
            const page = new ProjectCreationPage(appContainer);
            page.mount(appContainer);

            return {
                cleanup: () => {
                    page.unmount();
                    document.body.classList.remove('v2-route');
                    document.body.classList.add('marble-bg');
                    stylesheetLoader.unload('route:create');
                }
            };
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

        // Portfolio page - user's personal portfolio
        router.on('/portfolio', async () => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            if (!appContainer) {
                console.error('App container not found');
                return;
            }

            // Clear ALL containers
            appContainer.innerHTML = '';
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';

            // KILL all old Temple of Capital classes
            document.body.classList.remove(
                'marble-bg',
                'marble-smooth-render',
                'marble-pos-a',
                'marble-pos-b',
                'marble-pos-c',
                'marble-pos-d',
                'cultexecs-active'
            );

            // Add v2 class to body for styling
            document.body.classList.add('v2-route');

            // Ensure web3 is ready before rendering
            const web3 = await ensureWeb3Ready();

            // Render v2 Portfolio component with web3 context
            render(h(Portfolio, web3), appContainer);

            return {
                cleanup: () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:portfolio');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Governance Hub routes
        router.on('/governance', async () => {
            const { renderGovernanceOverview } = await import('./routes/governance/GovernanceOverview.js');
            return renderGovernanceOverview();
        });

        router.on('/governance/proposals', async () => {
            const { renderProposalsList } = await import('./routes/governance/ProposalsList.js');
            return renderProposalsList();
        });

        router.on('/governance/proposals/:id', async (params) => {
            const { renderProposalDetail } = await import('./routes/governance/ProposalDetail.js');
            return renderProposalDetail(params);
        });

        router.on('/governance/apply', async () => {
            const { renderGovernanceApply } = await import('./routes/governance/GovernanceApply.js');
            return renderGovernanceApply();
        });

        router.on('/governance/apply/factory', async () => {
            const { renderFactoryApplicationForm } = await import('./routes/governance/FactoryApplicationForm.js');
            return renderFactoryApplicationForm();
        });

        router.on('/governance/apply/vault', async () => {
            const { renderVaultApplicationForm } = await import('./routes/governance/VaultApplicationForm.js');
            return renderVaultApplicationForm();
        });

        router.on('/governance/member', async () => {
            const { renderMemberDashboard } = await import('./routes/governance/MemberDashboard.js');
            return renderMemberDashboard();
        });

        router.on('/governance/treasury', async () => {
            const { renderTreasuryView } = await import('./routes/governance/TreasuryView.js');
            return renderTreasuryView();
        });

        router.on('/governance/shares', async () => {
            const { renderShareOffering } = await import('./routes/governance/ShareOffering.js');
            return renderShareOffering();
        });

        // Register 404 handler
        router.notFound((path) => {
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.innerHTML = `
                    <div class="error-page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem;">
                        <h1 style="font-size: 4rem; margin-bottom: 2rem;">404</h1>
                        <img src="/execs/0109_2.gif" alt="404" style="max-width: 100%; height: auto;" />
                    </div>
                `;
            }
        });
        
        // Start the router
        await router.start();

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
        // Initialize service factory (checks RPC availability, falls back to mock)
        await serviceFactory.initialize();

        // Check if wallet service is already initialized
        if (!walletService.isInitialized) {
            // Initialize wallet service
            await walletService.initialize();
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

        return true;
    } catch (error) {
        // Read-only mode is optional, so we don't throw
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