import stylesheetLoader from '../utils/stylesheetLoader.js';
import { h, render, unmountRoot } from '../core/microact-setup.js';
import { Documentation } from '../components/Documentation/Documentation.microact.js';

/**
 * Documentation/About page route handler
 */
export function renderDocumentation() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/components/Documentation/Documentation.css', 'documentation-styles');

    // Unload other styles
    stylesheetLoader.unload('home-styles');
    stylesheetLoader.unload('cultexecs-styles');
    stylesheetLoader.unload('factory-exploration-styles');
    stylesheetLoader.unload('factory-detail-styles');
    stylesheetLoader.unload('project-detail-styles');
    stylesheetLoader.unload('project-creation-styles');

    // Clear existing content
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Create container
    const container = document.createElement('div');
    container.id = 'documentation-container';
    appContainer.appendChild(container);

    // Render Documentation
    render(h(Documentation), container);

    return {
        cleanup: () => {
            unmountRoot(container);
            stylesheetLoader.unload('documentation-styles');
        }
    };
}
