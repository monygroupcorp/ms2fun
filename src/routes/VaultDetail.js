import { VaultDetail } from '../components/VaultDetail/VaultDetail.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Vault Detail page
 * Shows individual vault info, benefactors, user position, and projects
 * @param {Object} params - Route params containing vault address
 */
export async function renderVaultDetail(params) {
    const appContainer = document.getElementById('app-container');
    if (!appContainer) {
        console.error('[VaultDetail] App container not found');
        return;
    }

    const vaultAddress = params.address;
    if (!vaultAddress) {
        console.error('[VaultDetail] No vault address provided');
        appContainer.innerHTML = `
            <div class="error-page" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; padding: 2rem;">
                <h2 style="color: rgba(255, 99, 71, 0.9);">Invalid Vault Address</h2>
                <p>No vault address was provided.</p>
            </div>
        `;
        return;
    }

    // Load stylesheet
    stylesheetLoader.load(
        'src/components/VaultDetail/VaultDetail.css',
        'vault-detail-styles'
    );

    // Create and mount the component
    const vaultDetail = new VaultDetail(vaultAddress);

    // Clear container and mount
    appContainer.innerHTML = '';
    vaultDetail.mount(appContainer);

    console.log('[VaultDetail] Page rendered for vault:', vaultAddress);
}
