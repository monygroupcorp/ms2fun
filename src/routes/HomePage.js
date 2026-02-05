import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import { ProjectDiscovery } from '../components/ProjectDiscovery/ProjectDiscovery.microact.js';
import { HeroSection } from '../components/HeroSection/HeroSection.microact.js';

/**
 * Home page route handler
 * Uses microact render() for component mounting
 */
export function renderHomePage() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Load stylesheets
    stylesheetLoader.load('src/routes/home.css', 'home-styles');
    stylesheetLoader.load('src/components/TopVaultsWidget/TopVaultsWidget.css', 'top-vaults-widget-styles');
    stylesheetLoader.load('src/components/RecentActivityWidget/RecentActivityWidget.css', 'recent-activity-widget-styles');
    stylesheetLoader.load('src/components/HeroSection/HeroSection.css', 'hero-section-styles');

    // Unload other styles
    stylesheetLoader.unload('cultexecs-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Create scroll container
    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'home-scroll-container';
    scrollContainer.style.cssText = 'height: 100vh; overflow-y: scroll; scroll-snap-type: y mandatory; scroll-behavior: smooth; -webkit-overflow-scrolling: touch;';
    appContainer.appendChild(scrollContainer);

    // Hero section
    const heroContainer = document.createElement('div');
    heroContainer.id = 'hero-section-container';
    scrollContainer.appendChild(heroContainer);
    render(h(HeroSection), heroContainer);

    // Content section
    const contentSection = document.createElement('div');
    contentSection.className = 'home-content-section';
    contentSection.style.cssText = 'scroll-snap-align: start; scroll-snap-stop: always; min-height: 100vh; padding: var(--spacing-8) var(--spacing-5); box-sizing: border-box;';
    scrollContainer.appendChild(contentSection);

    // Project discovery - shows CultExecs immediately
    const discoveryContainer = document.createElement('div');
    discoveryContainer.id = 'project-discovery-container';
    contentSection.appendChild(discoveryContainer);
    render(h(ProjectDiscovery), discoveryContainer);

    return {
        cleanup: () => {
            unmountRoot(discoveryContainer);
            unmountRoot(heroContainer);
            stylesheetLoader.unload('hero-section-styles');
        }
    };
}
