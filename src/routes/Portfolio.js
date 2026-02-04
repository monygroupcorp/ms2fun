import { UserPortfolio } from '../components/UserPortfolio/UserPortfolio.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Portfolio page
 * Shows user's holdings across all instances, vault positions, and settings
 */
export async function renderPortfolio() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[Portfolio] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load(
        'src/components/UserPortfolio/UserPortfolio.css',
        'user-portfolio-styles'
    );

    // Create and mount the component
    const portfolio = new UserPortfolio();

    // Clear container and mount
    appContainer.innerHTML = '';
    portfolio.mount(appContainer);

    console.log('[Portfolio] Page rendered');
}
