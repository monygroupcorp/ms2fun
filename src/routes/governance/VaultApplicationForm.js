import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { getContractAddress } from '../../config/contractConfig.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

const REGISTRY_IFACE = new ethers.utils.Interface([
    'function registerVault(address vault, string name, string metadataURI, uint256 targetId)',
]);

/**
 * Vault Application Form - /governance/apply/vault
 * Creates a DAO proposal to register a vault bound to an alignment target.
 */
export async function renderVaultApplicationForm() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/apply');

    const connectedAddress = walletService.getAddress();
    if (!connectedAddress) {
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="connect-prompt">
                    <h2>Connect Your Wallet</h2>
                    <p>You need a connected wallet to submit a proposal.</p>
                </div>
            </div>
        `;
        return;
    }

    // Loading state while fetching alignment targets
    appContainer.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading alignment targets...</p></div>
        </div>
    `;

    // Load alignment targets from MasterRegistry
    let targets = [];
    try {
        const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
        if (masterAdapter && typeof masterAdapter.getAlignmentTargets === 'function') {
            targets = await masterAdapter.getAlignmentTargets();
        }
    } catch (e) {
        console.warn('[VaultApplicationForm] Failed to load alignment targets:', e);
    }

    appContainer.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Register a Vault</h1>
                <p class="governance-subtitle">This creates a DAO proposal to register a vault bound to an alignment target</p>
            </header>

            <form id="vault-application-form" class="governance-form" style="margin: 0 auto;">
                <div class="form-group">
                    <label>Vault Contract Address *</label>
                    <input type="text" id="vault-address" placeholder="0x..." required />
                    <p class="form-hint">Deployed vault contract implementing IAlignmentVault</p>
                </div>

                <div class="form-group">
                    <label>Alignment Target *</label>
                    <select id="vault-target" required>
                        <option value="">Select alignment target...</option>
                        ${targets.map(t => `<option value="${t.id}">${t.title} (ID: ${t.id})</option>`).join('')}
                        ${targets.length === 0 ? '<option value="" disabled>No targets available — enter ID manually below</option>' : ''}
                    </select>
                    ${targets.length === 0 ? `
                        <input type="number" id="vault-target-manual" placeholder="Target ID" min="1" style="margin-top: var(--spacing-1);" />
                    ` : ''}
                    <p class="form-hint">The community this vault aligns to</p>
                </div>

                <div class="form-group">
                    <label>Vault Name *</label>
                    <input type="text" id="vault-name" placeholder="UltraAlignmentVault-Remilia" required />
                </div>

                <div class="form-group">
                    <label>Metadata URI</label>
                    <input type="text" id="vault-metadata-uri" placeholder="ipfs://... or https://..." />
                    <p class="form-hint">Optional link to additional metadata</p>
                </div>

                <div class="form-group">
                    <label>Proposal Details / Rationale *</label>
                    <textarea id="vault-details" placeholder="Describe why this vault should be registered..." required></textarea>
                </div>

                <div class="form-group">
                    <label>Proposal Expiration (days from now) *</label>
                    <input type="number" id="vault-expiration" value="30" min="1" max="365" required />
                </div>

                <div id="form-error" style="color: #c44; margin-bottom: var(--spacing-3); display: none;"></div>

                <button type="submit" class="btn btn-primary" style="width: 100%;">Submit Proposal</button>
            </form>
        </div>
    `;

    document.getElementById('vault-application-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleVaultSubmit();
    });
}

async function handleVaultSubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.querySelector('#vault-application-form button[type="submit"]');
    errorEl.style.display = 'none';

    const vaultAddress = document.getElementById('vault-address').value.trim();
    const targetSelect = document.getElementById('vault-target').value;
    const targetManual = document.getElementById('vault-target-manual')?.value;
    const targetId = parseInt(targetSelect || targetManual || '0');
    const vaultName = document.getElementById('vault-name').value.trim();
    const metadataURI = document.getElementById('vault-metadata-uri').value.trim();
    const details = document.getElementById('vault-details').value.trim();
    const expirationDays = parseInt(document.getElementById('vault-expiration').value);

    if (!ethers.utils.isAddress(vaultAddress)) {
        errorEl.textContent = 'Invalid vault contract address';
        errorEl.style.display = 'block';
        return;
    }

    if (!targetId || targetId < 1) {
        errorEl.textContent = 'Please select an alignment target';
        errorEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Proposal...';

    try {
        const masterRegistryAddress = await getContractAddress('MasterRegistryV1');

        const calldata = REGISTRY_IFACE.encodeFunctionData('registerVault', [
            vaultAddress,
            vaultName,
            metadataURI,
            targetId
        ]);

        const expiration = Math.floor(Date.now() / 1000) + (expirationDays * 86400);

        const adapter = await serviceFactory.getGrandCentralAdapter();
        const receipt = await adapter.submitProposal(
            [masterRegistryAddress],
            [0],
            [calldata],
            expiration,
            details
        );

        let proposalId = null;
        if (receipt.events) {
            const submitEvent = receipt.events.find(e => e.event === 'ProposalSubmitted');
            if (submitEvent) {
                proposalId = submitEvent.args.proposalId.toNumber();
            }
        }

        const appContainer = document.getElementById('app-container');
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="governance-header" style="margin-top: var(--section-spacing-md);">
                    <h1>Proposal Submitted!</h1>
                    <p class="governance-subtitle">Your vault registration proposal has been created.</p>
                    ${proposalId ? `<a href="/governance/proposals/${proposalId}" class="btn btn-primary" style="margin-top: var(--spacing-4);">View Proposal #${proposalId}</a>` : ''}
                    <a href="/governance/proposals" class="view-all-link" style="display: block; margin-top: var(--spacing-3);">View all proposals &rarr;</a>
                </div>
            </div>
        `;

    } catch (error) {
        console.error('[VaultApplicationForm] Submit failed:', error);
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Proposal';
    }
}
