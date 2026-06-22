import { h, render, unmountRoot } from '../core/microact-setup.js';
import { GlobalActivityFeed } from '../components/GlobalActivityFeed/GlobalActivityFeed.microact.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Global Activity Feed page
 */
export async function renderGlobalActivityFeed() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[GlobalActivityFeed] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/components/GlobalActivityFeed/GlobalActivityFeed.css', 'global-activity-feed-styles');

    // Clear and render
    appContainer.innerHTML = '';
    render(h(GlobalActivityFeed), appContainer);

    console.log('[GlobalActivityFeed] Page rendered');

    return {
        cleanup: () => {
            unmountRoot(appContainer);
            stylesheetLoader.unload('global-activity-feed-styles');
        }
    };
}
