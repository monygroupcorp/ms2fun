import { VaultExplorer } from '../components/VaultExplorer/VaultExplorer.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Vault Explorer page
 * Shows all registered vaults with TVL/popularity ranking and pagination
 */
export async function renderVaultExplorer() {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[VaultExplorer] App container not found');
        return;
    }

    // Load stylesheet
    stylesheetLoader.load(
        'src/components/VaultExplorer/VaultExplorer.css',
        'vault-explorer-styles'
    );

    // Create and mount the component
    const vaultExplorer = new VaultExplorer();

    // Clear container and mount
    appContainer.innerHTML = '';
    vaultExplorer.mount(appContainer);

    console.log('[VaultExplorer] Page rendered');
}
