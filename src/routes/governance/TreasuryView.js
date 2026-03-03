import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

/**
 * Treasury View Page - /governance/treasury
 * Public read-only page showing DAO treasury health and recent activity.
 */
export async function renderTreasuryView() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/treasury');

    appContainer.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading treasury data...</p></div>
        </div>
    `;

    try {
        const adapter = await serviceFactory.getGrandCentralAdapter();
        const treasury = await adapter.getTreasurySummary();

        const ragequitPool = parseFloat(treasury.ragequitPool);
        const claimsPool = parseFloat(treasury.claimsPool);
        const generalFunds = parseFloat(treasury.generalFunds);
        const totalTreasury = ragequitPool + claimsPool + generalFunds;
        const maxPool = Math.max(ragequitPool, claimsPool, generalFunds, 0.001); // avoid div by 0

        // Load recent treasury events
        let recentActivity = [];
        try {
            recentActivity = await adapter.indexTreasuryEvents(0);
            recentActivity = recentActivity.reverse().slice(0, 30);
        } catch (e) {
            console.warn('[TreasuryView] Failed to load treasury events:', e);
        }

        appContainer.innerHTML = `
            <div class="governance-page">
                <header class="governance-header">
                    <h1>Treasury</h1>
                    <p class="governance-subtitle">DAO fund allocation and activity</p>
                </header>

                <div class="governance-stats-grid">
                    <div class="stat-card">
                        <span class="stat-label">Total Treasury</span>
                        <span class="stat-value">${totalTreasury.toFixed(4)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Ragequit Pool</span>
                        <span class="stat-value">${ragequitPool.toFixed(4)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Claims Pool</span>
                        <span class="stat-value">${claimsPool.toFixed(4)} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">General Funds</span>
                        <span class="stat-value">${generalFunds.toFixed(4)} ETH</span>
                    </div>
                </div>

                <section class="governance-section">
                    <h2>Pool Breakdown</h2>
                    <div class="treasury-bar">
                        <div class="treasury-bar-label">
                            <span>Ragequit Pool</span>
                            <span>${ragequitPool.toFixed(4)} ETH</span>
                        </div>
                        <div class="treasury-bar-track">
                            <div class="treasury-bar-fill" style="width: ${(ragequitPool / maxPool) * 100}%;"></div>
                        </div>
                    </div>
                    <div class="treasury-bar">
                        <div class="treasury-bar-label">
                            <span>Claims Pool</span>
                            <span>${claimsPool.toFixed(4)} ETH</span>
                        </div>
                        <div class="treasury-bar-track">
                            <div class="treasury-bar-fill" style="width: ${(claimsPool / maxPool) * 100}%; background: var(--deco-emerald);"></div>
                        </div>
                    </div>
                    <div class="treasury-bar">
                        <div class="treasury-bar-label">
                            <span>General Funds</span>
                            <span>${generalFunds.toFixed(4)} ETH</span>
                        </div>
                        <div class="treasury-bar-track">
                            <div class="treasury-bar-fill" style="width: ${(generalFunds / maxPool) * 100}%; background: var(--deco-navy);"></div>
                        </div>
                    </div>
                </section>

                <section class="governance-section">
                    <h2>Recent Activity</h2>
                    ${recentActivity.length === 0
                        ? '<p class="empty-state">No treasury activity yet</p>'
                        : `<div class="activity-list">${recentActivity.map(renderActivityItem).join('')}</div>`
                    }
                </section>
            </div>
        `;

    } catch (error) {
        console.error('[TreasuryView] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Treasury Unavailable</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

function renderActivityItem(event) {
    const labels = {
        ragequitPoolFunded: 'Pool Funded',
        ragequit: 'Ragequit',
        claimsPoolFunded: 'Claims Funded',
        claimWithdrawn: 'Claim Withdrawn',
    };

    const label = labels[event.type] || event.type;
    let detail = '';

    switch (event.type) {
        case 'ragequitPoolFunded':
            detail = `+${parseFloat(event.amount).toFixed(4)} ETH (total: ${parseFloat(event.newTotal).toFixed(4)})`;
            break;
        case 'ragequit':
            detail = `${event.member.slice(0, 6)}...${event.member.slice(-4)} burned ${parseFloat(event.sharesBurned).toFixed(2)} shares, ${parseFloat(event.lootBurned).toFixed(2)} loot &rarr; ${parseFloat(event.ethReceived).toFixed(4)} ETH`;
            break;
        case 'claimsPoolFunded':
            detail = `+${parseFloat(event.amount).toFixed(4)} ETH`;
            break;
        case 'claimWithdrawn':
            detail = `${event.member.slice(0, 6)}...${event.member.slice(-4)} claimed ${parseFloat(event.amount).toFixed(4)} ETH`;
            break;
    }

    return `
        <div class="activity-item">
            <span class="activity-type">${label}</span>
            <span class="activity-detail">${detail}</span>
        </div>
    `;
}
