import { eventBus } from './core/EventBus.js';
import walletService from './services/WalletService.js';
import MessagePopup from './components/MessagePopup/MessagePopup.js';
import Router from './core/Router.js';
import { HomePage } from './routes/HomePage.js';
import { ProjectDiscovery } from './routes/ProjectDiscovery.js';
import { Activity } from './routes/Activity.js';
import { Portfolio } from './routes/Portfolio.js';
import { CultExecsPage } from './routes/CultExecsPage.microact.js';
import serviceFactory from './services/ServiceFactory.js';
import { testMockSystem } from './services/mock/test-mock-system.js';
import { SimpleWalletButton } from './components/Web3/SimpleWalletButton.js';
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
        
        // Initialize wallet service (non-fatal — app renders in degraded mode on failure)
        try {
            await initializeServices();
        } catch (error) {
            console.warn('[initializeApp] Service initialization failed, continuing in degraded mode:', error);
        }
        
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

        // Clear cached context on chain restart so next navigation re-initializes cleanly
        eventBus.on('chain:reset', () => {
            console.log('[ensureWeb3Ready] chain:reset received, clearing web3 context');
            web3Context = null;
        });

        async function ensureWeb3Ready() {
            if (web3Context) return web3Context;

            try {
                const EnvironmentDetector = (await import('./services/EnvironmentDetector.js')).EnvironmentDetector;
                const providerManager = (await import('./services/ProviderManager.js')).default;

                const { provider, type: providerType } = await providerManager.initialize();
                const detector = new EnvironmentDetector();
                const { mode, config } = await detector.detect();

                web3Context = { provider, providerType, mode, config, web3Ready: true };
            } catch (error) {
                console.error('[ensureWeb3Ready] Web3 initialization failed, will retry on next navigation:', error);
                // Do not assign web3Context — next navigation retries from scratch
                return {
                    provider: null,
                    providerType: null,
                    mode: 'PLACEHOLDER_MOCK',
                    config: null,
                    web3Ready: false,
                    web3InitError: error.message
                };
            }

            return web3Context;
        }

        // Shared setup for v2 routes — clears containers and resets all v1 styling classes
        function prepareV2Route() {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');

            if (!appContainer) {
                console.error('App container not found');
                return null;
            }

            // Clear ALL containers
            appContainer.innerHTML = '';
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';

            // Remove all v1 styling classes that could hide containers or conflict
            document.body.classList.remove(
                'marble-bg', 'marble-smooth-render',
                'marble-pos-a', 'marble-pos-b', 'marble-pos-c', 'marble-pos-d',
                'cultexecs-active', 'hide-wallet',
                'has-project-style', 'project-style-loaded',
                'project-style-resolved', 'project-style-pending'
            );
            document.documentElement.classList.remove(
                'has-project-style', 'project-style-loaded',
                'project-style-resolved', 'project-style-pending',
                'project-style-speculative'
            );
            document.body.removeAttribute('data-project-style');

            // Add v2 class for styling
            document.body.classList.add('v2-route');

            return appContainer;
        }

        // Register routes
        router.on('/', async () => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();
            render(h(HomePage, web3), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:home');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Discovery page - browse all projects (no wallet actions needed)
        router.on('/discover', async () => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            document.body.classList.add('hide-wallet');

            const web3 = await ensureWeb3Ready();
            render(h(ProjectDiscovery, web3), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route', 'hide-wallet');
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
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();
            render(h(Activity, web3), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:activity');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        router.on('/cultexecs', async () => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            document.body.classList.add('cultexecs-active', 'hide-wallet');

            const web3 = await ensureWeb3Ready();
            render(h(CultExecsPage, web3), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route', 'cultexecs-active', 'hide-wallet');
                    stylesheetLoader.unload('cultexecs-v2-styles');
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });
        async function aboutRoute() {
            const appContainer = prepareV2Route();
            if (!appContainer) return;
            document.body.classList.add('hide-wallet');

            // Static top bar (no microact — avoids re-render wiping docs content)
            const topBar = document.createElement('div');
            topBar.className = 'home-top-bar';
            topBar.innerHTML = `
                <a href="/" class="home-logo">MS2<span class="logo-tld">.fun</span></a>
                <div class="nav-links"><a href="/create" class="btn btn-primary">Create</a></div>
            `;
            topBar.querySelector('.home-logo').addEventListener('click', (e) => {
                e.preventDefault();
                window.router.navigate('/');
            });
            topBar.querySelector('a[href="/create"]').addEventListener('click', (e) => {
                e.preventDefault();
                window.router.navigate('/create');
            });
            appContainer.appendChild(topBar);

            // Docs content container
            const docsRoot = document.createElement('div');
            appContainer.appendChild(docsRoot);

            const { renderDocumentation } = await import('./routes/Documentation.js');
            const docResult = await renderDocumentation(docsRoot);

            return {
                cleanup: async () => {
                    if (docResult?.cleanup) docResult.cleanup();
                    document.body.classList.remove('v2-route', 'hide-wallet');
                    document.body.classList.add('marble-bg');
                    appContainer.innerHTML = '';
                }
            };
        }

        router.on('/about', aboutRoute);
        router.on('/docs', aboutRoute);
        
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
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            // Mount on a child element so Component.unmount() removes the child,
            // not #app-container itself (v1 Component.unmount() calls this.element.remove())
            const pageRoot = document.createElement('div');
            appContainer.appendChild(pageRoot);

            const { default: ProjectCreationPage } = await import('./routes/ProjectCreationPage.js');
            const page = new ProjectCreationPage(pageRoot);
            page.mount(pageRoot);

            return {
                cleanup: async () => {
                    page.unmount();
                    document.body.classList.remove('v2-route');
                    document.body.classList.add('marble-bg');
                    stylesheetLoader.unload('route:create');
                }
            };
        });
        
        router.on('/factories', async () => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();
            const { Layout } = await import('./components/Layout/Layout.js');
            const { FactoryExploration } = await import('./components/FactoryExploration/FactoryExploration.microact.js');
            render(h(Layout, { currentPath: '/factories', mode: web3.mode,
                children: h(FactoryExploration, web3)
            }), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
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
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();
            const { Layout } = await import('./components/Layout/Layout.js');
            const { VaultExplorer } = await import('./components/VaultExplorer/VaultExplorer.microact.js');
            render(h(Layout, { currentPath: '/vaults', mode: web3.mode,
                children: h(VaultExplorer, web3)
            }), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    stylesheetLoader.unload('route:vaults');
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        router.on('/vaults/:address', async (params) => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();
            const { VaultDetail } = await import('./components/VaultDetail/VaultDetail.microact.js');
            render(h(VaultDetail, { ...web3, vaultAddress: params.address }), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Global activity feed route
        router.on('/messages', async () => {
            const { renderGlobalActivityFeed } = await import('./routes/GlobalActivityFeed.js');
            return renderGlobalActivityFeed();
        });

        // Portfolio page - user's personal portfolio
        router.on('/portfolio', async () => {
            const appContainer = prepareV2Route();
            if (!appContainer) return;

            const web3 = await ensureWeb3Ready();

            // Render v2 Portfolio component with web3 context
            render(h(Portfolio, web3), appContainer);

            return {
                cleanup: async () => {
                    document.body.classList.remove('v2-route');
                    // Unload route-specific CSS
                    stylesheetLoader.unload('route:portfolio');
                    // Restore marble classes for other routes
                    document.body.classList.add('marble-bg');
                    unmountRoot(appContainer);
                }
            };
        });

        // Register 404 handler
        router.notFound((path) => {
            const appContainer = document.getElementById('app-container');
            const appTopContainer = document.getElementById('app-top-container');
            const appBottomContainer = document.getElementById('app-bottom-container');
            document.body.classList.add('v2-route', 'hide-wallet');
            document.body.classList.remove('has-project-style');
            document.documentElement.classList.remove('has-project-style');
            document.documentElement.classList.add('project-style-resolved');
            if (appTopContainer) appTopContainer.innerHTML = '';
            if (appBottomContainer) appBottomContainer.innerHTML = '';
            if (appContainer) {
                appContainer.innerHTML = `
                    <div style="max-width: 600px; margin: 120px auto; padding: 0 var(--space-4); text-align: center;">
                        <h1 style="font-size: var(--font-size-h1); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); margin-bottom: var(--space-4);">404</h1>
                        <p style="color: var(--text-secondary); margin-bottom: var(--space-6);">Page not found.</p>
                        <a href="/" style="color: var(--text-primary); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); font-weight: bold; text-decoration: none; border: 1px solid var(--border-primary); padding: var(--space-2) var(--space-4);">Go Home</a>
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
    // Initialize service factory (checks RPC availability, falls back to mock)
    try {
        await serviceFactory.initialize();
    } catch (error) {
        console.warn('[initializeServices] ServiceFactory initialization failed (non-fatal):', error);
    }

    // Wallet initialization is non-fatal — a crashed/missing extension must not block the page
    if (!walletService.isInitialized) {
        try {
            await walletService.initialize();
        } catch (error) {
            console.warn('[initializeServices] Wallet initialization failed (non-fatal):', error);
        }
    }

    // Start contract reload service (local dev only - skip in mock mode)
    try {
        if (!serviceFactory.isUsingMock()) {
            contractReloadService.start();
        }
    } catch (error) {
        console.warn('[initializeServices] ContractReloadService start failed (non-fatal):', error);
    }

    return true;
}

/**
 * Initialize wallet button globally
 * Uses SimpleWalletButton (brutalist style) on all pages with web3 interactions.
 * Routes without web3 hide it via body.hide-wallet CSS class.
 */
function initializeFloatingWalletButton() {
    try {
        // Create container for wallet button
        const walletContainer = document.createElement('div');
        walletContainer.id = 'floating-wallet-container-global';
        document.body.appendChild(walletContainer);

        // Mount SimpleWalletButton (brutalist style) using microact render
        render(h(SimpleWalletButton), walletContainer);

        // Store container for potential cleanup
        window.floatingWalletContainer = walletContainer;
    } catch (error) {
        console.error('Failed to initialize wallet button:', error);
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