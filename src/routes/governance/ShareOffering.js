import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

const TrancheStatusLabel = {
    0: 'Inactive',
    1: 'Active',
    2: 'Finalized',
    3: 'Cancelled'
};

/**
 * Share Offering Page - /governance/shares
 * Shows active share offerings (tranches) with commit/refund UI.
 */
export async function renderShareOffering() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/shares');

    appContainer.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading share offerings...</p></div>
        </div>
    `;

    try {
        // Try to get ShareOffering adapter - may not be deployed
        let adapter;
        try {
            adapter = await getShareOfferingAdapter();
        } catch (e) {
            appContainer.innerHTML = `
                <div class="governance-page">
                    <header class="governance-header">
                        <h1>Share Offerings</h1>
                        <p class="governance-subtitle">Acquire DAO shares through offerings</p>
                    </header>
                    <p class="empty-state">Share offering contract is not deployed yet.</p>
                </div>
            `;
            return;
        }

        const offering = await adapter.getCurrentOffering();
        const connectedAddress = walletService.getAddress();

        if (!offering || offering.status === 0) {
            appContainer.innerHTML = `
                <div class="governance-page">
                    <header class="governance-header">
                        <h1>Share Offerings</h1>
                        <p class="governance-subtitle">Acquire DAO shares through offerings</p>
                    </header>
                    <p class="empty-state">No active share offerings at this time.</p>
                </div>
            `;
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const isActive = offering.status === 1 && now >= offering.startTime && now <= offering.endTime;
        const isEnded = now > offering.endTime;
        const totalShares = parseFloat(offering.totalShares);
        const committedShares = parseFloat(offering.committedShares);
        const progress = totalShares > 0 ? (committedShares / totalShares) * 100 : 0;
        const timeRemaining = isActive ? formatDuration(offering.endTime - now) : 'Ended';

        // Load user's commitment if connected
        let userCommitment = null;
        if (connectedAddress) {
            try {
                userCommitment = await adapter.getCommitment(offering.trancheId, connectedAddress);
            } catch (e) { /* ignore */ }
        }

        const statusLabel = TrancheStatusLabel[offering.status] || 'Unknown';

        appContainer.innerHTML = `
            <div class="governance-page">
                <header class="governance-header">
                    <h1>Share Offerings</h1>
                    <p class="governance-subtitle">Tranche #${offering.trancheId}</p>
                </header>

                <div class="governance-stats-grid">
                    <div class="stat-card">
                        <span class="stat-label">Status</span>
                        <span class="stat-value">${statusLabel}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Price per Share</span>
                        <span class="stat-value">${parseFloat(offering.pricePerShare).toFixed(6)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Time Remaining</span>
                        <span class="stat-value">${timeRemaining}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Total ETH Committed</span>
                        <span class="stat-value">${parseFloat(offering.totalETHCommitted).toFixed(4)} ETH</span>
                    </div>
                </div>

                <section class="governance-section">
                    <h2>Progress</h2>
                    <div class="treasury-bar">
                        <div class="treasury-bar-label">
                            <span>${committedShares.toFixed(2)} / ${totalShares.toFixed(2)} shares</span>
                            <span>${progress.toFixed(1)}%</span>
                        </div>
                        <div class="treasury-bar-track">
                            <div class="treasury-bar-fill" style="width: ${progress}%;"></div>
                        </div>
                    </div>
                    ${parseFloat(offering.minShares) > 0 ? `<p style="font-size: var(--font-size-sm); color: var(--text-tertiary);">Min: ${parseFloat(offering.minShares).toFixed(2)} shares per commitment</p>` : ''}
                    ${parseFloat(offering.maxSharesPerAddress) > 0 ? `<p style="font-size: var(--font-size-sm); color: var(--text-tertiary);">Max per address: ${parseFloat(offering.maxSharesPerAddress).toFixed(2)} shares</p>` : ''}
                </section>

                ${isActive && connectedAddress ? `
                    <section class="governance-section">
                        <h2>Commit to Offering</h2>
                        <div class="governance-form">
                            <div class="form-group">
                                <label>Shares to buy</label>
                                <input type="number" id="commit-shares" min="1" step="1" placeholder="Number of shares" />
                                <p class="form-hint" id="commit-cost">Cost: 0 ETH</p>
                            </div>
                            <button class="btn btn-primary" id="commit-btn" style="width: 100%;">Commit</button>
                        </div>
                    </section>
                ` : ''}

                ${isActive && !connectedAddress ? `
                    <section class="governance-section">
                        <p class="empty-state">Connect wallet to participate in the offering</p>
                    </section>
                ` : ''}

                ${userCommitment && parseFloat(userCommitment.shares) > 0 ? `
                    <section class="governance-section">
                        <h2>Your Commitment</h2>
                        <div class="member-grid">
                            <div class="member-section">
                                <div class="stat-card" style="border: none; padding: 0; background: none;">
                                    <span class="stat-label">Shares Committed</span>
                                    <span class="stat-value">${parseFloat(userCommitment.shares).toFixed(2)}</span>
                                </div>
                                <div class="stat-card" style="border: none; padding: var(--spacing-2) 0 0; background: none;">
                                    <span class="stat-label">ETH Committed</span>
                                    <span class="stat-value">${parseFloat(userCommitment.ethValue).toFixed(6)} ETH</span>
                                </div>
                                ${offering.status === 3 || (isEnded && now > offering.finalizeDeadline) ? `
                                    <button class="btn btn-secondary" id="refund-btn" style="margin-top: var(--spacing-3); width: 100%;">Refund</button>
                                ` : ''}
                            </div>
                        </div>
                    </section>
                ` : ''}
            </div>
        `;

        // Attach listeners
        const sharesInput = document.getElementById('commit-shares');
        const costHint = document.getElementById('commit-cost');
        if (sharesInput && costHint) {
            sharesInput.addEventListener('input', () => {
                const shares = parseInt(sharesInput.value) || 0;
                const cost = shares * parseFloat(offering.pricePerShare);
                costHint.textContent = `Cost: ${cost.toFixed(6)} ETH`;
            });
        }

        const commitBtn = document.getElementById('commit-btn');
        if (commitBtn) {
            commitBtn.addEventListener('click', async () => {
                const shares = parseInt(sharesInput?.value) || 0;
                if (shares <= 0) return;

                commitBtn.disabled = true;
                commitBtn.textContent = 'Committing...';
                try {
                    await adapter.commit(offering.trancheId, shares, []);
                    renderShareOffering();
                } catch (e) {
                    commitBtn.disabled = false;
                    commitBtn.textContent = 'Commit';
                    console.error('[ShareOffering] Commit failed:', e);
                }
            });
        }

        const refundBtn = document.getElementById('refund-btn');
        if (refundBtn) {
            refundBtn.addEventListener('click', async () => {
                refundBtn.disabled = true;
                refundBtn.textContent = 'Refunding...';
                try {
                    await adapter.refund(offering.trancheId);
                    renderShareOffering();
                } catch (e) {
                    refundBtn.disabled = false;
                    refundBtn.textContent = 'Refund';
                    console.error('[ShareOffering] Refund failed:', e);
                }
            });
        }

    } catch (error) {
        console.error('[ShareOffering] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Share Offerings Unavailable</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

async function getShareOfferingAdapter() {
    // ShareOffering isn't in ServiceFactory yet — create on the fly
    const { default: ShareOfferingAdapter } = await import('../../services/contracts/ShareOfferingAdapter.js');
    const { getContractAddress } = await import('../../config/contractConfig.js');

    const address = await getContractAddress('ShareOffering');
    if (!address || address === '0x0000000000000000000000000000000000000000') {
        throw new Error('ShareOffering not deployed');
    }

    let provider, signer;
    const walletProviderAndSigner = walletService.getProviderAndSigner();
    if (walletProviderAndSigner.provider) {
        provider = walletProviderAndSigner.provider;
        signer = walletProviderAndSigner.signer;
    } else {
        const { detectNetwork } = await import('../../config/network.js');
        const network = detectNetwork();
        if (network.mode === 'local' && network.rpcUrl) {
            provider = new ethers.providers.StaticJsonRpcProvider(
                network.rpcUrl,
                { name: 'anvil', chainId: network.chainId, ensAddress: null }
            );
        } else {
            throw new Error('No provider available');
        }
    }

    const adapter = new ShareOfferingAdapter(address, provider, signer);
    await adapter.initialize();
    return adapter;
}

function formatDuration(seconds) {
    if (seconds <= 0) return 'Ended';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
