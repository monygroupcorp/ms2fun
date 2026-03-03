import stylesheetLoader from '../../utils/stylesheetLoader.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

/**
 * Application Gateway Page - /governance/apply
 * Selection page: Register a Factory or Register a Vault.
 */
export async function renderGovernanceApply() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/apply');

    appContainer.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Apply for Registration</h1>
                <p class="governance-subtitle">Submit a factory or vault for DAO approval via proposal</p>
            </header>

            <div class="action-cards-grid" style="max-width: 640px; margin: 0 auto;">
                <a href="/governance/apply/factory" class="action-card">
                    <h3>Register a Factory</h3>
                    <p>Factories are code templates that create project instances (ERC404 bonding, ERC1155 editions, ERC721 auctions). Registration requires a DAO proposal that, once passed, adds the factory to the MasterRegistry.</p>
                </a>
                <a href="/governance/apply/vault" class="action-card">
                    <h3>Register a Vault</h3>
                    <p>Vaults receive fees from project instances and deploy them into alignment targets. Registration binds a vault to an alignment target via DAO proposal.</p>
                </a>
            </div>
        </div>
    `;
}
