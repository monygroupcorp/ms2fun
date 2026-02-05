import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import { FactoryExploration } from '../components/FactoryExploration/FactoryExploration.microact.js';

/**
 * Factory exploration page route handler
 */
export async function renderFactoryExploration() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/routes/factory-exploration.css', 'factory-exploration-styles');

    // Unload other page styles
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('factory-detail-styles');
    stylesheetLoader.unload('project-creation-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Create container
    const container = document.createElement('div');
    container.id = 'factory-exploration-container';
    appContainer.appendChild(container);

    // Render FactoryExploration
    render(h(FactoryExploration), container);

    return {
        cleanup: () => {
            unmountRoot(container);
            stylesheetLoader.unload('factory-exploration-styles');
        }
    };
}
