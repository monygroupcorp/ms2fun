import stylesheetLoader from '../utils/stylesheetLoader.js';
import { ProjectDiscovery } from '../components/ProjectDiscovery/ProjectDiscovery.js';
import { TopVaultsWidget } from '../components/TopVaultsWidget/TopVaultsWidget.js';
import { RecentActivityWidget } from '../components/RecentActivityWidget/RecentActivityWidget.js';
import { HeroSection } from '../components/HeroSection/HeroSection.js';
import { HomePageDataProvider } from '../components/HomePageDataProvider/HomePageDataProvider.js';

/**
 * Home page route handler
 * This is the new landing page for the launchpad
 * Updated to remove blocking WalletSplash - FloatingWalletButton is now global
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
    // Load widget stylesheets
    stylesheetLoader.load('src/components/TopVaultsWidget/TopVaultsWidget.css', 'top-vaults-widget-styles');
    stylesheetLoader.load('src/components/RecentActivityWidget/RecentActivityWidget.css', 'recent-activity-widget-styles');
    stylesheetLoader.load('src/components/HeroSection/HeroSection.css', 'hero-section-styles');

    // Unload CULT EXEC styles if they were loaded
    stylesheetLoader.unload('cultexecs-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Create scroll container wrapper with scroll-snap
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'home-scroll-container';
    scrollContainer.style.height = '100vh';
    scrollContainer.style.overflowY = 'scroll';
    scrollContainer.style.scrollSnapType = 'y mandatory';
    scrollContainer.style.scrollBehavior = 'smooth';
    scrollContainer.style.WebkitOverflowScrolling = 'touch'; // Smooth scrolling on iOS
    appContainer.appendChild(scrollContainer);

    // Mount HeroSection (full-screen, first snap point)
    const heroContainer = document.createElement('div');
    heroContainer.id = 'hero-section-container';
    scrollContainer.appendChild(heroContainer);

    const heroSection = new HeroSection();
    heroSection.mount(heroContainer);

    // Create content section (second snap point)
    const contentSection = document.createElement('div');
    contentSection.className = 'home-content-section';
    contentSection.style.scrollSnapAlign = 'start';
    contentSection.style.scrollSnapStop = 'always';
    contentSection.style.minHeight = '100vh';
    contentSection.style.padding = 'var(--spacing-8) var(--spacing-5)';
    contentSection.style.boxSizing = 'border-box';
    scrollContainer.appendChild(contentSection);

    // Create HomePageDataProvider for batched data fetching
    // This fetches all home page data in ONE call instead of 80+ individual calls
    const dataProvider = new HomePageDataProvider();

    // Create container for TopVaultsWidget
    const vaultsWidgetContainer = document.createElement('div');
    vaultsWidgetContainer.id = 'top-vaults-widget-container';
    contentSection.appendChild(vaultsWidgetContainer);

    // Mount TopVaultsWidget (using data provider)
    const topVaultsWidget = new TopVaultsWidget({ useDataProvider: true });
    topVaultsWidget.mount(vaultsWidgetContainer);
    dataProvider.registerChild('topVaultsWidget', topVaultsWidget);

    // Create container for RecentActivityWidget
    const activityWidgetContainer = document.createElement('div');
    activityWidgetContainer.id = 'recent-activity-widget-container';
    contentSection.appendChild(activityWidgetContainer);

    // Mount RecentActivityWidget (using data provider)
    const recentActivityWidget = new RecentActivityWidget({ useDataProvider: true });
    recentActivityWidget.mount(activityWidgetContainer);
    dataProvider.registerChild('recentActivityWidget', recentActivityWidget);

    // Create container for ProjectDiscovery (always visible, no blocking)
    const discoveryContainer = document.createElement('div');
    discoveryContainer.id = 'project-discovery-container';
    contentSection.appendChild(discoveryContainer);

    // Mount ProjectDiscovery component (using data provider)
    const projectDiscovery = new ProjectDiscovery({ useDataProvider: true });
    projectDiscovery.mount(discoveryContainer);
    dataProvider.registerChild('projectDiscovery', projectDiscovery);

    // Mount the data provider (this triggers the single batched fetch)
    // It doesn't render anything, just fetches and distributes data
    const providerContainer = document.createElement('div');
    providerContainer.style.display = 'none';
    contentSection.appendChild(providerContainer);
    dataProvider.mount(providerContainer);

    // Note: FloatingWalletButton is mounted globally in index.js
    // No need to mount it here

    // Return cleanup function
    return {
        cleanup: () => {
            // Unmount data provider first
            if (dataProvider && typeof dataProvider.unmount === 'function') {
                dataProvider.unmount();
            }
            // Unmount components
            if (heroSection && typeof heroSection.unmount === 'function') {
                heroSection.unmount();
            }
            if (topVaultsWidget && typeof topVaultsWidget.unmount === 'function') {
                topVaultsWidget.unmount();
            }
            if (recentActivityWidget && typeof recentActivityWidget.unmount === 'function') {
                recentActivityWidget.unmount();
            }
            if (projectDiscovery && typeof projectDiscovery.unmount === 'function') {
                projectDiscovery.unmount();
            }

            // Unload stylesheets
            stylesheetLoader.unload('hero-section-styles');
            stylesheetLoader.unload('top-vaults-widget-styles');
            stylesheetLoader.unload('recent-activity-widget-styles');
            // stylesheetLoader.unload('home-styles');
        }
    };
}

