import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import { renderGovernanceNav } from './shared/governanceNav.js';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'ready', label: 'Ready' },
    { key: 'passed', label: 'Passed' },
    { key: 'defeated', label: 'Defeated' },
    { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

/**
 * Proposals List Page - /governance/proposals
 * Filterable list of all DAO proposals.
 */
export async function renderProposalsList() {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/proposals');

    appContainer.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Proposals</h1>
                <p class="governance-subtitle">All GrandCentral DAO proposals</p>
            </header>
            <div class="loading-state"><div class="spinner"></div><p>Loading proposals...</p></div>
        </div>
    `;

    try {
        const adapter = await serviceFactory.getGrandCentralAdapter();
        const indexer = await serviceFactory.getGovernanceEventIndexer();

        const totalCount = indexer.getProposalCount();

        if (totalCount === 0) {
            appContainer.innerHTML = `
                <div class="governance-page">
                    <header class="governance-header">
                        <h1>Proposals</h1>
                    </header>
                    <p class="empty-state">No proposals have been submitted yet.</p>
                </div>
            `;
            return;
        }

        // Get proposals from index (already sorted newest-first)
        const allIndexed = indexer.getProposals();

        // Fetch real-time state for visible proposals (first page)
        const proposals = [];
        for (const p of allIndexed.slice(0, PAGE_SIZE)) {
            try {
                const state = await adapter.getProposalState(p.id);
                proposals.push({ ...p, state });
            } catch (e) {
                proposals.push({ ...p, state: p.cancelled ? 'Cancelled' : p.processed ? (p.didPass ? 'Processed' : 'Defeated') : 'Unknown' });
            }
        }

        let activeFilter = 'all';
        let allLoaded = allIndexed.length <= PAGE_SIZE;

        renderProposalsPage(appContainer, proposals, totalCount, activeFilter, allLoaded);

        // Attach event listeners
        appContainer.addEventListener('click', async (e) => {
            const pill = e.target.closest('.filter-pill');
            if (pill) {
                activeFilter = pill.dataset.filter;
                renderProposalsPage(appContainer, proposals, totalCount, activeFilter, allLoaded);
                return;
            }

            const loadMore = e.target.closest('.load-more-btn');
            if (loadMore) {
                loadMore.disabled = true;
                loadMore.textContent = 'Loading...';
                const remaining = allIndexed.slice(proposals.length, proposals.length + PAGE_SIZE);
                for (const p of remaining) {
                    try {
                        const state = await adapter.getProposalState(p.id);
                        proposals.push({ ...p, state });
                    } catch (e) {
                        proposals.push({ ...p, state: 'Unknown' });
                    }
                }
                allLoaded = proposals.length >= allIndexed.length;
                renderProposalsPage(appContainer, proposals, totalCount, activeFilter, allLoaded);
            }

            const refreshBtn = e.target.closest('.refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Refreshing...';
                await indexer.indexNewEvents();
                renderProposalsList();
            }
        });

    } catch (error) {
        console.error('[ProposalsList] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Failed to Load Proposals</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

function renderProposalsPage(container, proposals, totalCount, activeFilter, allLoaded) {
    const filtered = filterProposals(proposals, activeFilter);

    container.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Proposals</h1>
                <p class="governance-subtitle">${totalCount} total proposals</p>
                <button class="btn btn-secondary refresh-btn" style="margin-top: var(--spacing-2);">Refresh</button>
            </header>

            <div class="filter-pills">
                ${FILTERS.map(f => `
                    <button class="filter-pill ${activeFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>
                `).join('')}
            </div>

            <div class="proposals-list">
                ${filtered.length === 0
                    ? '<p class="empty-state">No proposals match this filter</p>'
                    : filtered.map(p => renderProposalCard(p)).join('')
                }
            </div>

            ${!allLoaded ? `
                <div class="load-more-container">
                    <button class="btn btn-secondary load-more-btn">Load More</button>
                </div>
            ` : ''}
        </div>
    `;
}

function filterProposals(proposals, filter) {
    if (filter === 'all') return proposals;
    if (filter === 'active') return proposals.filter(p => p.state === 'Voting' || p.state === 'Grace');
    if (filter === 'ready') return proposals.filter(p => p.state === 'Ready');
    if (filter === 'passed') return proposals.filter(p => p.state === 'Processed');
    if (filter === 'defeated') return proposals.filter(p => p.state === 'Defeated');
    if (filter === 'cancelled') return proposals.filter(p => p.state === 'Cancelled');
    return proposals;
}

function renderProposalCard(p) {
    const sponsorDisplay = p.sponsor && p.sponsor !== '0x0000000000000000000000000000000000000000'
        ? `${p.sponsor.slice(0, 6)}...${p.sponsor.slice(-4)}`
        : 'Unsponsored';

    return `
        <a href="/governance/proposals/${p.id}" class="proposal-card">
            <div class="proposal-card-header">
                <span class="proposal-id">#${p.id}</span>
                <span class="proposal-state proposal-state--${p.state.toLowerCase()}">${p.state}</span>
            </div>
            <p class="proposal-details">${p.details || 'No description'}</p>
            <div class="proposal-votes">
                <span class="votes-yes">Yes: ${parseFloat(p.yesVotes).toFixed(2)}</span>
                <span class="votes-no">No: ${parseFloat(p.noVotes).toFixed(2)}</span>
                <span style="margin-left: auto; color: var(--text-tertiary);">Sponsor: ${sponsorDisplay}</span>
            </div>
        </a>
    `;
}
