import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { getContractAddress } from '../../config/contractConfig.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

// MasterRegistry registerFactoryWithFeaturesAndCreator ABI fragment for encoding
const REGISTRY_IFACE = new ethers.utils.Interface([
    'function registerFactoryWithFeaturesAndCreator(address factoryAddress, string contractType, string title, string displayTitle, string metadataURI, string[] features, address creator)',
]);

/**
 * Factory Application Form - /governance/apply/factory
 * Wizard form that generates a GrandCentral proposal to register a factory.
 */
export async function renderFactoryApplicationForm() {
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

    appContainer.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Register a Factory</h1>
                <p class="governance-subtitle">This creates a DAO proposal to add a factory to the MasterRegistry</p>
            </header>

            <form id="factory-application-form" class="governance-form" style="margin: 0 auto;">
                <div class="form-group">
                    <label>Factory Contract Address *</label>
                    <input type="text" id="factory-address" placeholder="0x..." required />
                    <p class="form-hint">Must implement IFactory interface</p>
                </div>

                <div class="form-group">
                    <label>Factory Type *</label>
                    <select id="factory-type" required>
                        <option value="">Select type...</option>
                        <option value="ERC404">ERC404 Bonding</option>
                        <option value="ERC1155">ERC1155 Editions</option>
                        <option value="ERC721">ERC721 Auctions</option>
                        <option value="Other">Other</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Title *</label>
                    <input type="text" id="factory-title" placeholder="ERC404-Bonding-Curve-Factory" required />
                    <p class="form-hint">Slug-style identifier (no spaces)</p>
                </div>

                <div class="form-group">
                    <label>Display Title *</label>
                    <input type="text" id="factory-display-title" placeholder="ERC404 Bonding Curve" required />
                    <p class="form-hint">Human-readable name shown in UI</p>
                </div>

                <div class="form-group">
                    <label>Metadata URI</label>
                    <input type="text" id="factory-metadata-uri" placeholder="ipfs://... or https://..." />
                    <p class="form-hint">Optional link to additional metadata</p>
                </div>

                <div class="form-group">
                    <label>Creator Address</label>
                    <input type="text" id="factory-creator" placeholder="0x..." value="${connectedAddress}" />
                    <p class="form-hint">Address that receives factory creator fee split</p>
                </div>

                <div class="form-group">
                    <label>Proposal Details / Rationale *</label>
                    <textarea id="factory-details" placeholder="Describe why this factory should be registered..." required></textarea>
                    <p class="form-hint">This text is stored on-chain as the proposal description</p>
                </div>

                <div class="form-group">
                    <label>Proposal Expiration (days from now) *</label>
                    <input type="number" id="factory-expiration" value="30" min="1" max="365" required />
                </div>

                <div id="form-error" style="color: #c44; margin-bottom: var(--spacing-3); display: none;"></div>

                <button type="submit" class="btn btn-primary" style="width: 100%;">Submit Proposal</button>
            </form>
        </div>
    `;

    document.getElementById('factory-application-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleFactorySubmit();
    });
}

async function handleFactorySubmit() {
    const errorEl = document.getElementById('form-error');
    const submitBtn = document.querySelector('#factory-application-form button[type="submit"]');
    errorEl.style.display = 'none';

    const factoryAddress = document.getElementById('factory-address').value.trim();
    const factoryType = document.getElementById('factory-type').value;
    const title = document.getElementById('factory-title').value.trim();
    const displayTitle = document.getElementById('factory-display-title').value.trim();
    const metadataURI = document.getElementById('factory-metadata-uri').value.trim();
    const creator = document.getElementById('factory-creator').value.trim();
    const details = document.getElementById('factory-details').value.trim();
    const expirationDays = parseInt(document.getElementById('factory-expiration').value);

    if (!ethers.utils.isAddress(factoryAddress)) {
        errorEl.textContent = 'Invalid factory contract address';
        errorEl.style.display = 'block';
        return;
    }

    if (creator && !ethers.utils.isAddress(creator)) {
        errorEl.textContent = 'Invalid creator address';
        errorEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Proposal...';

    try {
        const masterRegistryAddress = await getContractAddress('MasterRegistryV1');

        // Encode the registerFactoryWithFeaturesAndCreator calldata
        const calldata = REGISTRY_IFACE.encodeFunctionData('registerFactoryWithFeaturesAndCreator', [
            factoryAddress,
            factoryType,
            title,
            displayTitle,
            metadataURI,
            [], // features array (empty for now)
            creator || walletService.getAddress()
        ]);

        // Calculate expiration as uint32 timestamp
        const expiration = Math.floor(Date.now() / 1000) + (expirationDays * 86400);

        const adapter = await serviceFactory.getGrandCentralAdapter();
        const receipt = await adapter.submitProposal(
            [masterRegistryAddress],
            [0],
            [calldata],
            expiration,
            details
        );

        // Get proposalId from receipt events
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
                    <p class="governance-subtitle">Your factory registration proposal has been created.</p>
                    ${proposalId ? `<a href="/governance/proposals/${proposalId}" class="btn btn-primary" style="margin-top: var(--spacing-4);">View Proposal #${proposalId}</a>` : ''}
                    <a href="/governance/proposals" class="view-all-link" style="display: block; margin-top: var(--spacing-3);">View all proposals &rarr;</a>
                </div>
            </div>
        `;

    } catch (error) {
        console.error('[FactoryApplicationForm] Submit failed:', error);
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Proposal';
    }
}
