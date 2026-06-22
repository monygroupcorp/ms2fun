import { h, render, unmountRoot } from '../core/microact-setup.js';
import { VaultExplorer } from '../components/VaultExplorer/VaultExplorer.microact.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Vault Explorer page
 */
export async function renderVaultExplorer() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[VaultExplorer] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load('src/components/VaultExplorer/VaultExplorer.css', 'vault-explorer-styles');

    // Clear and render
    appContainer.innerHTML = '';
    render(h(VaultExplorer), appContainer);

    console.log('[VaultExplorer] Page rendered');

    return {
        cleanup: () => {
            unmountRoot(appContainer);
            stylesheetLoader.unload('vault-explorer-styles');
        }
    };
}
