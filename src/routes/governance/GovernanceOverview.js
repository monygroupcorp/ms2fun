import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

/**
 * Governance Overview Page - /governance
 * Main landing page for the GrandCentral DAO hub.
 */
export async function renderGovernanceOverview() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) {
        console.error('App containers not found');
        return;
    }

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance');

    // Loading state
    appContainer.innerHTML = `
        <div class="governance-overview">
            <div class="loading-state"><div class="spinner"></div><p>Loading governance data...</p></div>
        </div>
    `;

    try {
        const adapter = await serviceFactory.getGrandCentralAdapter();
        const [config, treasurySummary, proposalCount] = await Promise.all([
            adapter.getGovernanceConfig(),
            adapter.getTreasurySummary(),
            adapter.getProposalCount()
        ]);

        appContainer.innerHTML = `
            <div class="governance-overview">
                <header class="governance-header">
                    <h1>GrandCentral DAO</h1>
                    <p class="governance-subtitle">Governing the ms2.fun protocol</p>
                </header>

                <div class="governance-stats-grid">
                    <div class="stat-card">
                        <span class="stat-label">Total Proposals</span>
                        <span class="stat-value">${proposalCount}</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Ragequit Pool</span>
                        <span class="stat-value">${parseFloat(treasurySummary.ragequitPool).toFixed(4)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Claims Pool</span>
                        <span class="stat-value">${parseFloat(treasurySummary.claimsPool).toFixed(4)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Voting Period</span>
                        <span class="stat-value">${config.votingPeriod / 3600}h</span>
                    </div>
                </div>

                <section class="governance-section">
                    <h2>Active Proposals</h2>
                    <div id="active-proposals-list" class="proposals-list">
                        <p class="empty-state">Loading proposals...</p>
                    </div>
                    <a href="/governance/proposals" class="view-all-link">View all proposals &rarr;</a>
                </section>

                <section class="governance-section">
                    <h2>Get Involved</h2>
                    <div class="action-cards-grid">
                        <a href="/governance/apply" class="action-card">
                            <h3>Apply</h3>
                            <p>Submit a factory or vault for registration</p>
                        </a>
                        <a href="/governance/shares" class="action-card">
                            <h3>Acquire Shares</h3>
                            <p>Participate in share offerings</p>
                        </a>
                        <a href="/governance/member" class="action-card">
                            <h3>My Governance</h3>
                            <p>View your shares, votes, and claims</p>
                        </a>
                        <a href="/governance/treasury" class="action-card">
                            <h3>Treasury</h3>
                            <p>Protocol revenue and fund allocation</p>
                        </a>
                    </div>
                </section>
            </div>
        `;

        loadActiveProposals(adapter, serviceFactory);

    } catch (error) {
        console.error('[GovernanceOverview] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-overview">
                <div class="error-state">
                    <h2>Governance Unavailable</h2>
                    <p>${error.message}</p>
                    <a href="/" class="btn btn-secondary">&larr; Back to Home</a>
                </div>
            </div>
        `;
    }
}

async function loadActiveProposals(adapter, sf) {
    const container = document.getElementById('active-proposals-list');
    if (!container) return;

    try {
        // Use event indexer for batch access to proposals
        const indexer = await sf.getGovernanceEventIndexer();
        const indexedProposals = indexer.getProposals({ status: 'active' });

        // For active proposals, also check real-time state from contract
        const activeProposals = [];
        for (const p of indexedProposals.slice(0, 10)) {
            try {
                const state = await adapter.getProposalState(p.id);
                if (state === 'Voting' || state === 'Grace' || state === 'Ready' || state === 'Submitted') {
                    activeProposals.push({ ...p, state });
                }
            } catch (e) { /* skip */ }
        }

        if (activeProposals.length === 0) {
            container.innerHTML = '<p class="empty-state">No active proposals</p>';
            return;
        }

        container.innerHTML = activeProposals.map(p => `
            <a href="/governance/proposals/${p.id}" class="proposal-card">
                <div class="proposal-card-header">
                    <span class="proposal-id">#${p.id}</span>
                    <span class="proposal-state proposal-state--${p.state.toLowerCase()}">${p.state}</span>
                </div>
                <p class="proposal-details">${p.details || 'No description'}</p>
            </a>
        `).join('');
    } catch (error) {
        console.error('[GovernanceOverview] Failed to load proposals:', error);
    }
}
