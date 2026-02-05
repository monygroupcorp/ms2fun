import { h, render, unmountRoot } from '../core/microact-setup.js';
import { UserPortfolio } from '../components/UserPortfolio/UserPortfolio.microact.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Portfolio page
 */
export async function renderPortfolio() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[Portfolio] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/components/UserPortfolio/UserPortfolio.css', 'user-portfolio-styles');

    // Clear and render
    appContainer.innerHTML = '';
    render(h(UserPortfolio), appContainer);

    console.log('[Portfolio] Page rendered');

    return {
        cleanup: () => {
            unmountRoot(appContainer);
            stylesheetLoader.unload('user-portfolio-styles');
        }
    };
}
