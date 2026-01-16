import { GlobalActivityFeed } from '../components/GlobalActivityFeed/GlobalActivityFeed.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Global Activity Feed page
 * Shows all protocol-wide messages with pagination and filtering
 */
export async function renderGlobalActivityFeed() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[GlobalActivityFeed] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load(
        'src/components/GlobalActivityFeed/GlobalActivityFeed.css',
        'global-activity-feed-styles'
    );

    // Create and mount the component
    const globalActivityFeed = new GlobalActivityFeed();

    // Clear container and mount
    appContainer.innerHTML = '';
    globalActivityFeed.mount(appContainer);

    console.log('[GlobalActivityFeed] Page rendered');
}
