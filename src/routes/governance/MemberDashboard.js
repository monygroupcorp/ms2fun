import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { eventBus } from '../../core/EventBus.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

/**
 * Member Dashboard Page - /governance/member
 * Shows connected user's DAO membership: shares, loot, claims, voting history, ragequit.
 */
export async function renderMemberDashboard() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/member');

    const connectedAddress = walletService.getAddress();

    if (!connectedAddress) {
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="connect-prompt">
                    <h2>Connect Your Wallet</h2>
                    <p>Connect a wallet to view your DAO membership status.</p>
                </div>
            </div>
        `;

        // Re-render when wallet connects
        const unsub = eventBus.on('wallet:connected', () => {
            unsub();
            renderMemberDashboard();
        });
        return;
    }

    appContainer.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading membership data...</p></div>
        </div>
    `;

    try {
        const adapter = await serviceFactory.getGrandCentralAdapter();
        const summary = await adapter.getMemberSummary(connectedAddress);

        const isMember = parseFloat(summary.shares) > 0 || parseFloat(summary.loot) > 0;

        if (!isMember) {
            appContainer.innerHTML = `
                <div class="governance-page">
                    <header class="governance-header">
                        <h1>My Governance</h1>
                        <p class="governance-subtitle">${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}</p>
                    </header>
                    <div class="connect-prompt">
                        <h2>Not a Member</h2>
                        <p>You don't hold any shares or loot in the DAO.</p>
                        <a href="/governance/shares" class="btn btn-primary">Acquire Shares</a>
                    </div>
                </div>
            `;
            return;
        }

        // Load voting history from event indexer
        let votingHistory = [];
        try {
            const indexer = await serviceFactory.getGovernanceEventIndexer();
            const memberData = indexer.getMemberData(connectedAddress);
            votingHistory = memberData.votes.reverse().slice(0, 20);
        } catch (e) {
            console.warn('[MemberDashboard] Failed to load vote history:', e);
        }

        const pendingClaimEth = parseFloat(summary.pendingClaim);

        appContainer.innerHTML = `
            <div class="governance-page">
                <header class="governance-header">
                    <h1>My Governance</h1>
                    <p class="governance-subtitle">${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}</p>
                </header>

                <div class="member-grid">
                    <div class="member-section">
                        <h3>Voting Power</h3>
                        <div class="stat-card" style="border: none; padding: 0; background: none;">
                            <span class="stat-label">Shares</span>
                            <span class="stat-value">${parseFloat(summary.shares).toFixed(4)}</span>
                        </div>
                        <div class="stat-card" style="border: none; padding: var(--spacing-2) 0 0; background: none;">
                            <span class="stat-label">Loot (economic only)</span>
                            <span class="stat-value">${parseFloat(summary.loot).toFixed(4)}</span>
                        </div>
                        <div class="stat-card" style="border: none; padding: var(--spacing-2) 0 0; background: none;">
                            <span class="stat-label">% of DAO</span>
                            <span class="stat-value">${summary.percentage.toFixed(2)}%</span>
                        </div>
                    </div>

                    <div class="member-section">
                        <h3>Pending Claims</h3>
                        <div class="stat-card" style="border: none; padding: 0; background: none;">
                            <span class="stat-label">Claimable ETH</span>
                            <span class="stat-value">${pendingClaimEth.toFixed(6)} ETH</span>
                        </div>
                        ${pendingClaimEth > 0 ? `
                            <button class="btn btn-primary" id="claim-btn" style="margin-top: var(--spacing-3); width: 100%;">Claim</button>
                        ` : `
                            <p class="empty-state">No pending claims</p>
                        `}
                    </div>

                    <div class="member-section">
                        <h3>Ragequit</h3>
                        <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-3);">
                            Burn shares/loot to withdraw proportional ETH from the ragequit pool.
                        </p>
                        <div class="form-group">
                            <label>Shares to burn</label>
                            <input type="number" id="ragequit-shares" min="0" max="${summary.shares}" step="any" value="0" />
                        </div>
                        <div class="form-group">
                            <label>Loot to burn</label>
                            <input type="number" id="ragequit-loot" min="0" max="${summary.loot}" step="any" value="0" />
                        </div>
                        <button class="btn btn-secondary" id="ragequit-btn" style="width: 100%;">Ragequit</button>
                    </div>
                </div>

                ${votingHistory.length > 0 ? `
                    <section class="governance-section" style="margin-top: var(--section-spacing-md);">
                        <h2>Voting History</h2>
                        <div class="activity-list">
                            ${votingHistory.map(v => `
                                <a href="/governance/proposals/${v.proposalId}" class="activity-item" style="text-decoration: none;">
                                    <span class="activity-type">${v.approved ? 'Yes' : 'No'}</span>
                                    <span class="activity-detail">Proposal #${v.proposalId} &middot; ${v.balance} shares</span>
                                </a>
                            `).join('')}
                        </div>
                    </section>
                ` : ''}

                <section class="governance-section" style="margin-top: var(--section-spacing-md);">
                    <h2>Delegation</h2>
                    <p class="empty-state">Coming soon</p>
                </section>
            </div>
        `;

        attachMemberListeners(adapter, connectedAddress);

    } catch (error) {
        console.error('[MemberDashboard] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Failed to Load Membership</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

function attachMemberListeners(adapter, address) {
    const claimBtn = document.getElementById('claim-btn');
    if (claimBtn) {
        claimBtn.addEventListener('click', async () => {
            claimBtn.disabled = true;
            claimBtn.textContent = 'Claiming...';
            try {
                await adapter.claim();
                renderMemberDashboard();
            } catch (e) {
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim';
                console.error('[MemberDashboard] Claim failed:', e);
            }
        });
    }

    const ragequitBtn = document.getElementById('ragequit-btn');
    if (ragequitBtn) {
        ragequitBtn.addEventListener('click', async () => {
            const sharesToBurn = document.getElementById('ragequit-shares')?.value || '0';
            const lootToBurn = document.getElementById('ragequit-loot')?.value || '0';

            if (parseFloat(sharesToBurn) === 0 && parseFloat(lootToBurn) === 0) {
                return;
            }

            if (!confirm(`Ragequit: burn ${sharesToBurn} shares and ${lootToBurn} loot? This is irreversible.`)) {
                return;
            }

            ragequitBtn.disabled = true;
            ragequitBtn.textContent = 'Processing...';
            try {
                await adapter.ragequit(sharesToBurn, lootToBurn);
                renderMemberDashboard();
            } catch (e) {
                ragequitBtn.disabled = false;
                ragequitBtn.textContent = 'Ragequit';
                console.error('[MemberDashboard] Ragequit failed:', e);
            }
        });
    }
}
