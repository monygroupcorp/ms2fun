import stylesheetLoader from '../utils/stylesheetLoader.js';
import { Documentation } from '../components/Documentation/Documentation.js';

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
    
    // Load documentation stylesheet
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
    
    // Mount Documentation component
    const documentation = new Documentation();
    documentation.mount(container);
    
    return {
        cleanup: () => {
            if (documentation && typeof documentation.unmount === 'function') {
                documentation.unmount();
            }
            stylesheetLoader.unload('documentation-styles');
        }
    };
}

