import { h, render, unmountRoot } from '../core/microact-setup.js';
import { VaultDetail } from '../components/VaultDetail/VaultDetail.microact.js';
import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Render the Vault Detail page
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
    stylesheetLoader.load('src/components/VaultDetail/VaultDetail.css', 'vault-detail-styles');

    // Clear and render
    appContainer.innerHTML = '';
    render(h(VaultDetail, { vaultAddress }), appContainer);

    console.log('[VaultDetail] Page rendered for vault:', vaultAddress);

    return {
        cleanup: () => {
            unmountRoot(appContainer);
            stylesheetLoader.unload('vault-detail-styles');
        }
    };
}
