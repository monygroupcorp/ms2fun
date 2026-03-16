import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { getContractAddress } from '../../config/contractConfig.js';
import { eventBus } from '../../core/EventBus.js';

// ============================================================================
// ABI FRAGMENTS FOR PROPOSAL ENCODING / DECODING
// ============================================================================

const REGISTRY_IFACE = new ethers.utils.Interface([
    'function registerFactory(address factoryAddress, string contractType, string title, string displayTitle, string metadataURI, bytes32[] features)',
    'function registerVault(address vault, address creator, string name, string metadataURI, uint256 targetId)',
]);

const COMPONENT_REGISTRY_IFACE = new ethers.utils.Interface([
    'function approveComponent(address component, bytes32 tag, string name)',
]);

const DECODER_FRAGMENTS = [
    'function registerVault(address vault, string name, string metadataURI, uint256 targetId)',
    'function registerAlignmentTarget(string title, string description, string metadataURI, tuple(address token, uint256 weight, bool isLP)[] assets)',
    'function addAmbassador(uint256 targetId, address ambassador)',
    'function removeAmbassador(uint256 targetId, address ambassador)',
    'function deactivateVault(address vault)',
    'function deactivateAlignmentTarget(uint256 targetId)',
    'function mintShares(address[] to, uint256[] amount)',
    'function burnShares(address[] from, uint256[] amount)',
    'function mintLoot(address[] to, uint256[] amount)',
    'function burnLoot(address[] from, uint256[] amount)',
    'function setConductors(address[] _conductors, uint256[] _permissions)',
    'function setGovernanceConfig(uint32 voting, uint32 grace, uint256 quorum, uint256 sponsor, uint256 minRetention)',
    'function executeStipend(address beneficiary, uint256 amount)',
    'function lockAdmin()',
    'function lockManager()',
    'function lockGovernor()',
    'function fundRagequitPool(uint256 amount)',
    'function fundClaimsPool(uint256 amount)',
    'function approveComponent(address component, bytes32 tag, string name)',
    'function revokeComponent(address component)',
];

const decoderIface = new ethers.utils.Interface(DECODER_FRAGMENTS);

// ============================================================================
// CONSTANTS
// ============================================================================

const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'proposals', label: 'Proposals' },
    { key: 'member', label: 'Member' },
    { key: 'treasury', label: 'Treasury' },
    { key: 'shares', label: 'Shares' },
    { key: 'apply', label: 'Apply' },
];

const PROPOSAL_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'ready', label: 'Ready' },
    { key: 'passed', label: 'Passed' },
    { key: 'defeated', label: 'Defeated' },
    { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

const TAG_OPTIONS = [
    { value: 'gating', label: 'Gating Module', description: 'Access control for minting (password, allowlist, etc.)' },
    { value: 'liquidity', label: 'Liquidity Deployer', description: 'Deploys liquidity to a DEX after bonding graduation' },
    { value: 'dynamic_pricing', label: 'Dynamic Pricing', description: 'Custom pricing logic for ERC1155 editions' },
];

const TrancheStatusLabel = { 0: 'Inactive', 1: 'Active', 2: 'Finalized', 3: 'Cancelled' };

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Render the consolidated governance page.
 * @param {string} tab - Tab to show: overview|proposals|member|treasury|shares|apply
 * @param {object} params - Route params (e.g. { id } for proposal detail)
 */
export async function renderGovernancePage(tab = 'overview', params = {}) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    stylesheetLoader.load('/src/core/route-governance-v2.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    // Render nav tabs
    appTopContainer.innerHTML = renderNav(tab);

    // Attach tab click handlers (event delegation)
    appTopContainer.addEventListener('click', (e) => {
        // Hamburger toggle
        const toggle = e.target.closest('.mobile-menu-toggle');
        if (toggle) {
            const panel = toggle.closest('.governance-nav').querySelector('.mobile-nav-panel');
            const isOpen = panel.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', isOpen);
            return;
        }

        // Handle both desktop tabs and mobile nav links
        const link = e.target.closest('.governance-nav-link') || e.target.closest('.mobile-nav-link');
        if (!link) return;
        e.preventDefault();
        const targetTab = link.dataset.tab;
        if (targetTab && targetTab !== getCurrentTab()) {
            // Close mobile menu
            const panel = appTopContainer.querySelector('.mobile-nav-panel');
            if (panel) panel.classList.remove('is-open');
            const btn = appTopContainer.querySelector('.mobile-menu-toggle');
            if (btn) btn.setAttribute('aria-expanded', 'false');

            // Sync active state on both desktop and mobile links
            appTopContainer.querySelectorAll('[data-tab]').forEach(el => {
                el.classList.toggle('active', el.dataset.tab === targetTab);
            });

            // Update URL without full re-render for deep-link support
            const url = targetTab === 'overview' ? '/governance' : `/governance/${targetTab}`;
            window.history.pushState({ path: url }, '', url);
            switchTab(targetTab, appContainer, appTopContainer);
        }
    });

    // Render initial tab content
    await renderTabContent(tab, params, appContainer);
}

function getCurrentTab() {
    const active = document.querySelector('.governance-nav-link.active');
    return active ? active.dataset.tab : 'overview';
}

async function switchTab(tab, appContainer, appTopContainer) {
    // Update nav active state
    appTopContainer.querySelectorAll('.governance-nav-link').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    // Render new tab content
    await renderTabContent(tab, {}, appContainer);
}

async function renderTabContent(tab, params, container) {
    container.innerHTML = '<div class="governance-page"><div class="loading-state"><div class="spinner"></div><p>Loading...</p></div></div>';

    try {
        switch (tab) {
            case 'overview': await renderOverviewTab(container); break;
            case 'proposals':
                if (params.id) {
                    await renderProposalDetail(container, parseInt(params.id));
                } else {
                    await renderProposalsTab(container);
                }
                break;
            case 'member': await renderMemberTab(container); break;
            case 'treasury': await renderTreasuryTab(container); break;
            case 'shares': await renderSharesTab(container); break;
            case 'apply':
                if (params.formType === 'factory') await renderFactoryForm(container);
                else if (params.formType === 'vault') await renderVaultForm(container);
                else if (params.formType === 'component') await renderComponentForm(container);
                else await renderApplyTab(container);
                break;
            default: await renderOverviewTab(container); break;
        }
    } catch (error) {
        console.error(`[GovernancePage] Error rendering ${tab}:`, error);
        container.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Error</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

// ============================================================================
// NAV
// ============================================================================

function renderNav(activeTab) {
    return `
        <nav class="governance-nav">
            <div class="breadcrumb">
                <a href="/" class="breadcrumb-wordmark">MS2<span class="logo-tld">.fun</span></a>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-current">Governance</span>
            </div>
            <div class="governance-nav-links">
                ${TABS.map(t => `
                    <a href="/governance${t.key === 'overview' ? '' : '/' + t.key}"
                       class="governance-nav-link ${activeTab === t.key ? 'active' : ''}"
                       data-tab="${t.key}">${t.label}</a>
                `).join('')}
            </div>
            <button class="mobile-menu-toggle" aria-label="Menu" aria-expanded="false">
                <span class="hamburger-bar"></span>
            </button>
            <div class="mobile-nav-panel">
                ${TABS.map(t => `
                    <a href="/governance${t.key === 'overview' ? '' : '/' + t.key}"
                       class="mobile-nav-link${t.key === 'apply' ? ' mobile-nav-link-primary' : ''} ${activeTab === t.key ? 'active' : ''}"
                       data-tab="${t.key}">${t.label}</a>
                `).join('')}
            </div>
        </nav>
    `;
}

// ============================================================================
// OVERVIEW TAB
// ============================================================================

async function renderOverviewTab(container) {
    const adapter = await serviceFactory.getGrandCentralAdapter();
    const [config, treasurySummary, proposalCount] = await Promise.all([
        adapter.getGovernanceConfig(),
        adapter.getTreasurySummary(),
        adapter.getProposalCount()
    ]);

    container.innerHTML = `
        <div class="governance-page">
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
            </section>

            <section class="governance-section">
                <h2>Get Involved</h2>
                <div class="action-cards-grid">
                    <a href="/governance/apply" data-tab-link="apply" class="action-card">
                        <h3>Apply</h3>
                        <p>Submit a factory or vault for registration</p>
                    </a>
                    <a href="/governance/shares" data-tab-link="shares" class="action-card">
                        <h3>Acquire Shares</h3>
                        <p>Participate in share offerings</p>
                    </a>
                    <a href="/governance/member" data-tab-link="member" class="action-card">
                        <h3>My Governance</h3>
                        <p>View your shares, votes, and claims</p>
                    </a>
                    <a href="/governance/treasury" data-tab-link="treasury" class="action-card">
                        <h3>Treasury</h3>
                        <p>Protocol revenue and fund allocation</p>
                    </a>
                </div>
            </section>
        </div>
    `;

    // Wire up action card links to tab switching
    container.querySelectorAll('[data-tab-link]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = el.dataset.tabLink;
            const url = `/governance/${targetTab}`;
            window.history.pushState({ path: url }, '', url);
            const appTopContainer = document.getElementById('app-top-container');
            switchTab(targetTab, container, appTopContainer);
        });
    });

    // Load active proposals
    loadActiveProposals(adapter, container);
}

async function loadActiveProposals(adapter, pageContainer) {
    const listContainer = document.getElementById('active-proposals-list');
    if (!listContainer) return;

    try {
        const indexer = await serviceFactory.getGovernanceEventIndexer();
        const indexedProposals = indexer.getProposals({ status: 'active' });

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
            listContainer.innerHTML = '<p class="empty-state">No active proposals</p>';
            return;
        }

        listContainer.innerHTML = activeProposals.map(p => `
            <a href="/governance/proposals/${p.id}" class="proposal-card" data-proposal-id="${p.id}">
                <div class="proposal-card-header">
                    <span class="proposal-id">#${p.id}</span>
                    <span class="proposal-state proposal-state--${p.state.toLowerCase()}">${p.state}</span>
                </div>
                <p class="proposal-details">${p.details || 'No description'}</p>
            </a>
        `).join('');

        // Wire proposal clicks to inline detail
        listContainer.querySelectorAll('[data-proposal-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const id = parseInt(el.dataset.proposalId);
                const url = `/governance/proposals/${id}`;
                window.history.pushState({ path: url }, '', url);
                const appTopContainer = document.getElementById('app-top-container');
                appTopContainer.querySelectorAll('.governance-nav-link').forEach(n => {
                    n.classList.toggle('active', n.dataset.tab === 'proposals');
                });
                renderProposalDetail(pageContainer, id);
            });
        });
    } catch (error) {
        console.error('[GovernancePage] Failed to load active proposals:', error);
    }
}

// ============================================================================
// PROPOSALS TAB
// ============================================================================

async function renderProposalsTab(container) {
    const adapter = await serviceFactory.getGrandCentralAdapter();
    const indexer = await serviceFactory.getGovernanceEventIndexer();

    const totalCount = indexer.getProposalCount();

    if (totalCount === 0) {
        container.innerHTML = `
            <div class="governance-page">
                <header class="governance-header"><h1>Proposals</h1></header>
                <p class="empty-state">No proposals have been submitted yet.</p>
            </div>
        `;
        return;
    }

    const allIndexed = indexer.getProposals();
    const proposals = [];
    for (const p of allIndexed.slice(0, PAGE_SIZE)) {
        try {
            const [proposal, state] = await Promise.all([
                adapter.getProposal(p.id),
                adapter.getProposalState(p.id),
            ]);
            proposals.push({ ...p, ...proposal, state });
        } catch (e) {
            proposals.push({ ...p, state: p.cancelled ? 'Cancelled' : p.processed ? (p.didPass ? 'Processed' : 'Defeated') : 'Unknown' });
        }
    }

    let activeFilter = 'all';
    let allLoaded = allIndexed.length <= PAGE_SIZE;

    renderProposalsList(container, proposals, totalCount, activeFilter, allLoaded);

    container.addEventListener('click', async (e) => {
        // Filter pills
        const pill = e.target.closest('.filter-pill');
        if (pill) {
            activeFilter = pill.dataset.filter;
            renderProposalsList(container, proposals, totalCount, activeFilter, allLoaded);
            reattachProposalClicks(container);
            return;
        }

        // Load more
        const loadMore = e.target.closest('.load-more-btn');
        if (loadMore) {
            loadMore.disabled = true;
            loadMore.textContent = 'Loading...';
            const remaining = allIndexed.slice(proposals.length, proposals.length + PAGE_SIZE);
            for (const p of remaining) {
                try {
                    const [proposal, state] = await Promise.all([
                        adapter.getProposal(p.id),
                        adapter.getProposalState(p.id),
                    ]);
                    proposals.push({ ...p, ...proposal, state });
                } catch (e) {
                    proposals.push({ ...p, state: 'Unknown' });
                }
            }
            allLoaded = proposals.length >= allIndexed.length;
            renderProposalsList(container, proposals, totalCount, activeFilter, allLoaded);
            reattachProposalClicks(container);
            return;
        }

        // Refresh
        const refreshBtn = e.target.closest('.refresh-btn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
            await indexer.indexNewEvents();
            await renderProposalsTab(container);
            return;
        }

        // Proposal card click
        const card = e.target.closest('[data-proposal-id]');
        if (card) {
            e.preventDefault();
            const id = parseInt(card.dataset.proposalId);
            const url = `/governance/proposals/${id}`;
            window.history.pushState({ path: url }, '', url);
            await renderProposalDetail(container, id);
        }
    });
}

function renderProposalsList(container, proposals, totalCount, activeFilter, allLoaded) {
    const filtered = filterProposals(proposals, activeFilter);

    container.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Proposals</h1>
                <p class="governance-subtitle">${totalCount} total proposals</p>
                <button class="btn btn-secondary refresh-btn" style="margin-top: var(--space-2);">Refresh</button>
            </header>

            <div class="filter-pills">
                ${PROPOSAL_FILTERS.map(f => `
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
        <a href="/governance/proposals/${p.id}" class="proposal-card" data-proposal-id="${p.id}">
            <div class="proposal-card-header">
                <span class="proposal-id">#${p.id}</span>
                <span class="proposal-state proposal-state--${p.state.toLowerCase()}">${p.state}</span>
            </div>
            <p class="proposal-details">${p.details || 'No description'}</p>
            <div class="proposal-votes">
                <span class="votes-yes">Yes: ${parseFloat(p.yesVotes).toFixed(4)}</span>
                <span class="votes-no">No: ${parseFloat(p.noVotes).toFixed(4)}</span>
                <span style="margin-left: auto; color: var(--text-tertiary);">Sponsor: ${sponsorDisplay}</span>
            </div>
        </a>
    `;
}

function reattachProposalClicks(container) {
    // Already handled by event delegation on container
}

// ============================================================================
// PROPOSAL DETAIL (inline sub-view of Proposals tab)
// ============================================================================

async function renderProposalDetail(container, proposalId) {
    if (isNaN(proposalId) || proposalId < 1) {
        container.innerHTML = '<div class="governance-page"><div class="error-state"><h2>Invalid Proposal ID</h2></div></div>';
        return;
    }

    container.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading proposal #${proposalId}...</p></div>
        </div>
    `;

    const adapter = await serviceFactory.getGrandCentralAdapter();
    const indexer = await serviceFactory.getGovernanceEventIndexer();

    const [proposal, state] = await Promise.all([
        adapter.getProposal(proposalId),
        adapter.getProposalState(proposalId),
    ]);

    if (state === 'Unborn') {
        container.innerHTML = `
            <div class="governance-page">
                <div class="error-state"><h2>Proposal #${proposalId} does not exist</h2>
                <button class="btn btn-secondary back-to-proposals">&larr; Back to Proposals</button></div>
            </div>
        `;
        attachBackToProposals(container);
        return;
    }

    let submissionEvent = null;
    try {
        const proposalEvents = await adapter.indexProposalEvents(0);
        submissionEvent = proposalEvents.find(e => e.proposalId === proposalId);
    } catch (e) {
        console.warn('[GovernancePage] Failed to load proposal events:', e);
    }

    const voteEvents = indexer.getVotes(proposalId);
    const connectedAddress = walletService.getAddress();
    let userShares = '0';
    if (connectedAddress) {
        try { userShares = await adapter.getShares(connectedAddress); } catch (e) { /* ignore */ }
    }

    const totalYes = parseFloat(proposal.yesVotes);
    const totalNo = parseFloat(proposal.noVotes);
    const totalVotes = totalYes + totalNo;
    const yesPercent = totalVotes > 0 ? (totalYes / totalVotes) * 100 : 0;
    const noPercent = totalVotes > 0 ? (totalNo / totalVotes) * 100 : 0;

    const sponsorDisplay = proposal.sponsor !== '0x0000000000000000000000000000000000000000'
        ? `${proposal.sponsor.slice(0, 6)}...${proposal.sponsor.slice(-4)}`
        : 'None';

    container.innerHTML = `
        <div class="governance-page">
            <button class="back-to-proposals view-all-link" style="margin-bottom: var(--space-3); display: inline-block; cursor: pointer; background: none; border: none; font: inherit; color: inherit;">&larr; All Proposals</button>

            <div class="proposal-card" style="cursor: default;">
                <div class="proposal-card-header">
                    <span class="proposal-id" style="font-size: var(--font-size-h3);">#${proposal.id}</span>
                    <span class="proposal-state proposal-state--${state.toLowerCase()}">${state}</span>
                </div>
            </div>

            <section class="governance-section">
                <h2>Details</h2>
                <p style="color: var(--text-primary); white-space: pre-wrap;">${proposal.details || 'No description provided'}</p>
                <p style="color: var(--text-tertiary); font-size: var(--font-size-body-sm); margin-top: var(--space-2);">Sponsor: ${sponsorDisplay}</p>
            </section>

            <section class="governance-section">
                <h2>Timeline</h2>
                ${renderTimeline(proposal, state)}
            </section>

            ${submissionEvent ? `
                <section class="governance-section">
                    <h2>Proposed Actions</h2>
                    <div class="decoded-actions">
                        ${decodeActions(submissionEvent.targets, submissionEvent.values, submissionEvent.calldatas)}
                    </div>
                </section>
            ` : ''}

            <section class="governance-section">
                <h2>Vote Tally</h2>
                <div class="vote-tally">
                    <div class="vote-bar">
                        <div class="vote-bar-yes" style="width: ${yesPercent}%;"></div>
                        <div class="vote-bar-no" style="width: ${noPercent}%;"></div>
                    </div>
                    <div class="vote-counts">
                        <span class="votes-yes">Yes: ${totalYes.toFixed(4)} (${yesPercent.toFixed(4)}%)</span>
                        <span class="votes-no">No: ${totalNo.toFixed(4)} (${noPercent.toFixed(4)}%)</span>
                    </div>
                </div>

                ${state === 'Voting' && connectedAddress && parseFloat(userShares) > 0 ? `
                    <div class="vote-buttons">
                        <button class="btn btn-primary" id="vote-yes-btn">Vote Yes</button>
                        <button class="btn btn-secondary" id="vote-no-btn">Vote No</button>
                    </div>
                ` : ''}

                ${state === 'Voting' && !connectedAddress ? '<p class="empty-state">Connect wallet to vote</p>' : ''}
                ${state === 'Voting' && connectedAddress && parseFloat(userShares) === 0 ? '<p class="empty-state">You need shares to vote</p>' : ''}

                ${state === 'Ready' && connectedAddress ? `
                    <div class="vote-buttons">
                        <button class="btn btn-primary" id="process-btn">Process Proposal</button>
                    </div>
                ` : ''}
            </section>

            ${voteEvents.length > 0 ? `
                <section class="governance-section">
                    <h2>Vote History</h2>
                    <div class="activity-list">
                        ${voteEvents.map(v => `
                            <div class="activity-item">
                                <span class="activity-type">${v.approved ? 'Yes' : 'No'}</span>
                                <span class="activity-detail">${v.voter.slice(0, 6)}...${v.voter.slice(-4)} &middot; ${v.balance} shares</span>
                            </div>
                        `).join('')}
                    </div>
                </section>
            ` : ''}
        </div>
    `;

    attachBackToProposals(container);
    attachVoteListeners(container, adapter, proposalId, submissionEvent);
}

function attachBackToProposals(container) {
    container.querySelectorAll('.back-to-proposals').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const url = '/governance/proposals';
            window.history.pushState({ path: url }, '', url);
            renderProposalsTab(container);
        });
    });
}

function attachVoteListeners(container, adapter, proposalId, submissionEvent) {
    const yesBtn = document.getElementById('vote-yes-btn');
    const noBtn = document.getElementById('vote-no-btn');
    const processBtn = document.getElementById('process-btn');

    if (yesBtn) {
        yesBtn.addEventListener('click', async () => {
            yesBtn.disabled = true;
            yesBtn.textContent = 'Submitting...';
            try {
                await adapter.submitVote(proposalId, true);
                await renderProposalDetail(container, proposalId);
            } catch (e) {
                yesBtn.disabled = false;
                yesBtn.textContent = 'Vote Yes';
                console.error('[GovernancePage] Vote failed:', e);
            }
        });
    }

    if (noBtn) {
        noBtn.addEventListener('click', async () => {
            noBtn.disabled = true;
            noBtn.textContent = 'Submitting...';
            try {
                await adapter.submitVote(proposalId, false);
                await renderProposalDetail(container, proposalId);
            } catch (e) {
                noBtn.disabled = false;
                noBtn.textContent = 'Vote No';
                console.error('[GovernancePage] Vote failed:', e);
            }
        });
    }

    if (processBtn && submissionEvent) {
        processBtn.addEventListener('click', async () => {
            processBtn.disabled = true;
            processBtn.textContent = 'Processing...';
            try {
                const rawValues = submissionEvent.values.map(v => ethers.utils.parseEther(v));
                await adapter.processProposal(proposalId, submissionEvent.targets, rawValues, submissionEvent.calldatas);
                await renderProposalDetail(container, proposalId);
            } catch (e) {
                processBtn.disabled = false;
                processBtn.textContent = 'Process Proposal';
                console.error('[GovernancePage] Process failed:', e);
            }
        });
    }
}

function renderTimeline(proposal, currentState) {
    const steps = [
        { label: 'Submitted', key: 'Submitted' },
        { label: 'Voting', key: 'Voting' },
        { label: 'Grace', key: 'Grace' },
        { label: 'Ready', key: 'Ready' },
        { label: 'Processed', key: 'Processed' },
    ];

    const stateOrder = { Unborn: -1, Submitted: 0, Voting: 1, Cancelled: 1, Grace: 2, Ready: 3, Processed: 4, Defeated: 2 };
    const currentIdx = stateOrder[currentState] ?? -1;

    return `
        <div class="proposal-timeline">
            ${steps.map((step, i) => `
                ${i > 0 ? '<div class="timeline-line"></div>' : ''}
                <div class="timeline-step">
                    <div class="timeline-dot ${i < currentIdx ? 'completed' : ''} ${i === currentIdx ? 'active' : ''}"></div>
                    <span class="timeline-label">${step.label}</span>
                    ${step.key === 'Voting' && proposal.votingStarts > 0 ? `<span class="timeline-label">${formatTimestamp(proposal.votingStarts)}</span>` : ''}
                    ${step.key === 'Grace' && proposal.graceEnds > 0 ? `<span class="timeline-label">${formatTimestamp(proposal.graceEnds)}</span>` : ''}
                </div>
            `).join('')}
        </div>
        ${currentState === 'Cancelled' ? '<p style="color: #c44; font-size: var(--font-size-body-sm);">This proposal was cancelled.</p>' : ''}
        ${currentState === 'Defeated' ? '<p style="color: #c44; font-size: var(--font-size-body-sm);">This proposal was defeated.</p>' : ''}
    `;
}

function decodeActions(targets, values, calldatas) {
    if (!targets || targets.length === 0) return '<p class="empty-state">No actions</p>';

    return targets.map((target, i) => {
        const value = values[i] || '0';
        const calldata = calldatas[i] || '0x';
        const decoded = decodeCalldata(calldata);
        const targetShort = `${target.slice(0, 6)}...${target.slice(-4)}`;
        const valueDisplay = value !== '0' && value !== '0.0' ? ` (${value} ETH)` : '';

        return `
            <div class="decoded-action">
                <div class="decoded-action-label">${decoded.functionName || 'Unknown Function'}${valueDisplay}</div>
                <div class="decoded-action-params">
                    Target: ${targetShort}<br>
                    ${decoded.params ? decoded.params : `Raw: ${calldata.slice(0, 66)}${calldata.length > 66 ? '...' : ''}`}
                </div>
            </div>
        `;
    }).join('');
}

function decodeCalldata(calldata) {
    if (!calldata || calldata === '0x' || calldata.length < 10) {
        return { functionName: 'ETH Transfer', params: '' };
    }

    try {
        const decoded = decoderIface.parseTransaction({ data: calldata });
        const params = decoded.args.map((arg, i) => {
            const input = decoded.functionFragment.inputs[i];
            const name = input.name;
            let val = arg;

            if (ethers.BigNumber.isBigNumber(arg)) {
                val = arg.toString();
                if (arg.gt(ethers.BigNumber.from('1000000000000000'))) {
                    val = ethers.utils.formatEther(arg) + ' (wei: ' + arg.toString() + ')';
                }
            } else if (Array.isArray(arg)) {
                val = arg.map(a => ethers.BigNumber.isBigNumber(a) ? a.toString() : a).join(', ');
            }

            return `${name}: ${val}`;
        }).join('<br>');

        return { functionName: decoded.name, params };
    } catch (e) {
        const selector = calldata.slice(0, 10);
        return { functionName: `Unknown (${selector})`, params: null };
    }
}

// ============================================================================
// MEMBER TAB
// ============================================================================

async function renderMemberTab(container) {
    const connectedAddress = walletService.getAddress();

    if (!connectedAddress) {
        container.innerHTML = `
            <div class="governance-page">
                <div class="connect-prompt">
                    <h2>Connect Your Wallet</h2>
                    <p>Connect a wallet to view your DAO membership status.</p>
                </div>
            </div>
        `;

        const unsub = eventBus.on('wallet:connected', () => {
            unsub();
            renderMemberTab(container);
        });
        return;
    }

    const adapter = await serviceFactory.getGrandCentralAdapter();
    const summary = await adapter.getMemberSummary(connectedAddress);
    const isMember = parseFloat(summary.shares) > 0 || parseFloat(summary.loot) > 0;

    if (!isMember) {
        container.innerHTML = `
            <div class="governance-page">
                <header class="governance-header">
                    <h1>My Governance</h1>
                    <p class="governance-subtitle">${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}</p>
                </header>
                <div class="connect-prompt">
                    <h2>Not a Member</h2>
                    <p>You don't hold any shares or loot in the DAO.</p>
                    <button class="btn btn-primary go-to-shares">Acquire Shares</button>
                </div>
            </div>
        `;
        container.querySelector('.go-to-shares')?.addEventListener('click', () => {
            const url = '/governance/shares';
            window.history.pushState({ path: url }, '', url);
            const appTopContainer = document.getElementById('app-top-container');
            switchTab('shares', container, appTopContainer);
        });
        return;
    }

    let votingHistory = [];
    try {
        const indexer = await serviceFactory.getGovernanceEventIndexer();
        const memberData = indexer.getMemberData(connectedAddress);
        votingHistory = memberData.votes.reverse().slice(0, 20);
    } catch (e) {
        console.warn('[GovernancePage] Failed to load vote history:', e);
    }

    const pendingClaimEth = parseFloat(summary.pendingClaim);

    container.innerHTML = `
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
                    <div class="stat-card" style="border: none; padding: var(--space-2) 0 0; background: none;">
                        <span class="stat-label">Loot (economic only)</span>
                        <span class="stat-value">${parseFloat(summary.loot).toFixed(4)}</span>
                    </div>
                    <div class="stat-card" style="border: none; padding: var(--space-2) 0 0; background: none;">
                        <span class="stat-label">% of DAO</span>
                        <span class="stat-value">${summary.percentage.toFixed(4)}%</span>
                    </div>
                </div>

                <div class="member-section">
                    <h3>Pending Claims</h3>
                    <div class="stat-card" style="border: none; padding: 0; background: none;">
                        <span class="stat-label">Claimable ETH</span>
                        <span class="stat-value">${pendingClaimEth.toFixed(4)} ETH</span>
                    </div>
                    ${pendingClaimEth > 0 ? `
                        <button class="btn btn-primary" id="claim-btn" style="margin-top: var(--space-3); width: 100%;">Claim</button>
                    ` : `
                        <p class="empty-state">No pending claims</p>
                    `}
                </div>

                <div class="member-section">
                    <h3>Ragequit</h3>
                    <p style="font-size: var(--font-size-body-sm); color: var(--text-secondary); margin-bottom: var(--space-3);">
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
                            <a href="/governance/proposals/${v.proposalId}" class="activity-item" data-proposal-id="${v.proposalId}" style="text-decoration: none;">
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

    // Claim button
    const claimBtn = document.getElementById('claim-btn');
    if (claimBtn) {
        claimBtn.addEventListener('click', async () => {
            claimBtn.disabled = true;
            claimBtn.textContent = 'Claiming...';
            try {
                await adapter.claim();
                await renderMemberTab(container);
            } catch (e) {
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim';
                console.error('[GovernancePage] Claim failed:', e);
            }
        });
    }

    // Ragequit button
    const ragequitBtn = document.getElementById('ragequit-btn');
    if (ragequitBtn) {
        ragequitBtn.addEventListener('click', async () => {
            const sharesToBurn = document.getElementById('ragequit-shares')?.value || '0';
            const lootToBurn = document.getElementById('ragequit-loot')?.value || '0';

            if (parseFloat(sharesToBurn) === 0 && parseFloat(lootToBurn) === 0) return;
            if (!confirm(`Ragequit: burn ${sharesToBurn} shares and ${lootToBurn} loot? This is irreversible.`)) return;

            ragequitBtn.disabled = true;
            ragequitBtn.textContent = 'Processing...';
            try {
                await adapter.ragequit(sharesToBurn, lootToBurn);
                await renderMemberTab(container);
            } catch (e) {
                ragequitBtn.disabled = false;
                ragequitBtn.textContent = 'Ragequit';
                console.error('[GovernancePage] Ragequit failed:', e);
            }
        });
    }

    // Voting history proposal links
    container.querySelectorAll('[data-proposal-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const id = parseInt(el.dataset.proposalId);
            const url = `/governance/proposals/${id}`;
            window.history.pushState({ path: url }, '', url);
            const appTopContainer = document.getElementById('app-top-container');
            appTopContainer.querySelectorAll('.governance-nav-link').forEach(n => {
                n.classList.toggle('active', n.dataset.tab === 'proposals');
            });
            renderProposalDetail(container, id);
        });
    });
}

// ============================================================================
// TREASURY TAB
// ============================================================================

async function renderTreasuryTab(container) {
    const adapter = await serviceFactory.getGrandCentralAdapter();
    const treasury = await adapter.getTreasurySummary();

    const ragequitPool = parseFloat(treasury.ragequitPool);
    const claimsPool = parseFloat(treasury.claimsPool);
    const generalFunds = parseFloat(treasury.generalFunds);
    const totalTreasury = ragequitPool + claimsPool + generalFunds;
    const maxPool = Math.max(ragequitPool, claimsPool, generalFunds, 0.001);

    let recentActivity = [];
    try {
        recentActivity = await adapter.indexTreasuryEvents(0);
        recentActivity = recentActivity.reverse().slice(0, 30);
    } catch (e) {
        console.warn('[GovernancePage] Failed to load treasury events:', e);
    }

    container.innerHTML = `
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
                    <div class="treasury-bar-label"><span>Ragequit Pool</span><span>${ragequitPool.toFixed(4)} ETH</span></div>
                    <div class="treasury-bar-track"><div class="treasury-bar-fill" style="width: ${(ragequitPool / maxPool) * 100}%;"></div></div>
                </div>
                <div class="treasury-bar">
                    <div class="treasury-bar-label"><span>Claims Pool</span><span>${claimsPool.toFixed(4)} ETH</span></div>
                    <div class="treasury-bar-track"><div class="treasury-bar-fill" style="width: ${(claimsPool / maxPool) * 100}%; background: var(--deco-emerald);"></div></div>
                </div>
                <div class="treasury-bar">
                    <div class="treasury-bar-label"><span>General Funds</span><span>${generalFunds.toFixed(4)} ETH</span></div>
                    <div class="treasury-bar-track"><div class="treasury-bar-fill" style="width: ${(generalFunds / maxPool) * 100}%; background: var(--deco-navy);"></div></div>
                </div>
            </section>

            <section class="governance-section">
                <h2>Recent Activity</h2>
                ${recentActivity.length === 0
                    ? '<p class="empty-state">No treasury activity yet</p>'
                    : `<div class="activity-list">${recentActivity.map(renderTreasuryActivityItem).join('')}</div>`
                }
            </section>
        </div>
    `;
}

function renderTreasuryActivityItem(event) {
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
            detail = `${event.member.slice(0, 6)}...${event.member.slice(-4)} burned ${parseFloat(event.sharesBurned).toFixed(4)} shares, ${parseFloat(event.lootBurned).toFixed(4)} loot &rarr; ${parseFloat(event.ethReceived).toFixed(4)} ETH`;
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

// ============================================================================
// SHARES TAB
// ============================================================================

async function renderSharesTab(container) {
    let adapter;
    try {
        adapter = await serviceFactory.getShareOfferingAdapter();
    } catch (e) {
        container.innerHTML = `
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
        container.innerHTML = `
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
    const totalShares = offering.totalShares;
    const committedShares = offering.committedShares;
    const progress = totalShares > 0 ? (committedShares / totalShares) * 100 : 0;
    const timeRemaining = isActive ? formatDuration(offering.endTime - now) : 'Ended';

    let userCommitment = null;
    if (connectedAddress) {
        try { userCommitment = await adapter.getCommitment(offering.trancheId, connectedAddress); } catch (e) { /* ignore */ }
    }

    const statusLabel = TrancheStatusLabel[offering.status] || 'Unknown';

    container.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Share Offerings</h1>
                <p class="governance-subtitle">Tranche #${offering.trancheId}</p>
            </header>

            <div class="governance-stats-grid">
                <div class="stat-card"><span class="stat-label">Status</span><span class="stat-value">${statusLabel}</span></div>
                <div class="stat-card"><span class="stat-label">Price per Share</span><span class="stat-value">${parseFloat(offering.pricePerShare).toFixed(4)} ETH</span></div>
                <div class="stat-card"><span class="stat-label">Time Remaining</span><span class="stat-value">${timeRemaining}</span></div>
                <div class="stat-card"><span class="stat-label">Total ETH Committed</span><span class="stat-value">${parseFloat(offering.totalETHCommitted).toFixed(4)} ETH</span></div>
            </div>

            <section class="governance-section">
                <h2>Progress</h2>
                <div class="treasury-bar">
                    <div class="treasury-bar-label"><span>${committedShares} / ${totalShares} shares</span><span>${progress.toFixed(1)}%</span></div>
                    <div class="treasury-bar-track"><div class="treasury-bar-fill" style="width: ${progress}%;"></div></div>
                </div>
                ${offering.minShares > 0 ? `<p style="font-size: var(--font-size-body-sm); color: var(--text-tertiary);">Min: ${offering.minShares} shares per commitment</p>` : ''}
                ${offering.maxSharesPerAddress > 0 ? `<p style="font-size: var(--font-size-body-sm); color: var(--text-tertiary);">Max per address: ${offering.maxSharesPerAddress} shares</p>` : ''}
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

            ${isActive && !connectedAddress ? '<section class="governance-section"><p class="empty-state">Connect wallet to participate in the offering</p></section>' : ''}

            ${userCommitment && userCommitment.shares > 0 ? `
                <section class="governance-section">
                    <h2>Your Commitment</h2>
                    <div class="member-grid">
                        <div class="member-section">
                            <div class="stat-card" style="border: none; padding: 0; background: none;">
                                <span class="stat-label">Shares Committed</span>
                                <span class="stat-value">${userCommitment.shares}</span>
                            </div>
                            <div class="stat-card" style="border: none; padding: var(--space-2) 0 0; background: none;">
                                <span class="stat-label">ETH Committed</span>
                                <span class="stat-value">${parseFloat(userCommitment.ethValue).toFixed(4)} ETH</span>
                            </div>
                            ${offering.status === 3 || (isEnded && now > offering.finalizeDeadline) ? `
                                <button class="btn btn-secondary" id="refund-btn" style="margin-top: var(--space-3); width: 100%;">Refund</button>
                            ` : ''}
                        </div>
                    </div>
                </section>
            ` : ''}
        </div>
    `;

    // Commit cost preview
    const sharesInput = document.getElementById('commit-shares');
    const costHint = document.getElementById('commit-cost');
    if (sharesInput && costHint) {
        sharesInput.addEventListener('input', () => {
            const shares = parseInt(sharesInput.value) || 0;
            const cost = shares * parseFloat(offering.pricePerShare);
            costHint.textContent = `Cost: ${cost.toFixed(4)} ETH`;
        });
    }

    // Commit button
    const commitBtn = document.getElementById('commit-btn');
    if (commitBtn) {
        commitBtn.addEventListener('click', async () => {
            const shares = parseInt(sharesInput?.value) || 0;
            if (shares <= 0) return;
            commitBtn.disabled = true;
            commitBtn.textContent = 'Committing...';
            try {
                await adapter.commit(offering.trancheId, shares, []);
                await renderSharesTab(container);
            } catch (e) {
                commitBtn.disabled = false;
                commitBtn.textContent = 'Commit';
                console.error('[GovernancePage] Commit failed:', e);
            }
        });
    }

    // Refund button
    const refundBtn = document.getElementById('refund-btn');
    if (refundBtn) {
        refundBtn.addEventListener('click', async () => {
            refundBtn.disabled = true;
            refundBtn.textContent = 'Refunding...';
            try {
                await adapter.refund(offering.trancheId);
                await renderSharesTab(container);
            } catch (e) {
                refundBtn.disabled = false;
                refundBtn.textContent = 'Refund';
                console.error('[GovernancePage] Refund failed:', e);
            }
        });
    }
}

// ============================================================================
// APPLY TAB (gateway + inline forms)
// ============================================================================

async function renderApplyTab(container) {
    container.innerHTML = `
        <div class="governance-page">
            <header class="governance-header">
                <h1>Apply for Registration</h1>
                <p class="governance-subtitle">Submit a factory, vault, or component for DAO approval via proposal</p>
            </header>

            <div class="action-cards-grid" style="max-width: 640px; margin: 0 auto;">
                <a href="/governance/apply/factory" class="action-card" data-form="factory">
                    <h3>Register a Factory</h3>
                    <p>Factories are code templates that create project instances (ERC404 bonding, ERC1155 editions, ERC721 auctions). Registration requires a DAO proposal that, once passed, adds the factory to the MasterRegistry.</p>
                </a>
                <a href="/governance/apply/vault" class="action-card" data-form="vault">
                    <h3>Register a Vault</h3>
                    <p>Vaults receive fees from project instances and deploy them into alignment targets. Registration binds a vault to an alignment target via DAO proposal.</p>
                </a>
                <a href="/governance/apply/component" class="action-card" data-form="component">
                    <h3>Register a Component</h3>
                    <p>Components are pluggable modules used during project creation — gating modules, liquidity deployers, and pricing logic. Approval adds the component to the ComponentRegistry.</p>
                </a>
            </div>
        </div>
    `;

    container.querySelectorAll('[data-form]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const formType = el.dataset.form;
            const url = `/governance/apply/${formType}`;
            window.history.pushState({ path: url }, '', url);
            if (formType === 'factory') renderFactoryForm(container);
            else if (formType === 'vault') renderVaultForm(container);
            else if (formType === 'component') renderComponentForm(container);
        });
    });
}

// ============================================================================
// FACTORY APPLICATION FORM
// ============================================================================

async function renderFactoryForm(container) {
    const connectedAddress = walletService.getAddress();
    if (!connectedAddress) {
        renderConnectPrompt(container, 'You need a connected wallet to submit a proposal.', () => renderFactoryForm(container));
        return;
    }

    container.innerHTML = `
        <div class="governance-page">
            <button class="back-to-apply view-all-link" style="margin-bottom: var(--space-3); display: inline-block; cursor: pointer; background: none; border: none; font: inherit; color: inherit;">&larr; Back to Apply</button>

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
                    <label>Proposal Details / Rationale *</label>
                    <textarea id="factory-details" placeholder="Describe why this factory should be registered..." required></textarea>
                    <p class="form-hint">This text is stored on-chain as the proposal description</p>
                </div>
                <div class="form-group">
                    <label>Proposal Expiration (days from now) *</label>
                    <input type="number" id="factory-expiration" value="30" min="1" max="365" required />
                </div>
                <div id="form-error" style="color: #c44; margin-bottom: var(--space-3); display: none;"></div>
                <button type="submit" class="btn btn-primary" style="width: 100%;">Submit Proposal</button>
            </form>
        </div>
    `;

    attachBackToApply(container);

    document.getElementById('factory-application-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('form-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        errorEl.style.display = 'none';

        const factoryAddress = document.getElementById('factory-address').value.trim();
        const factoryType = document.getElementById('factory-type').value;
        const title = document.getElementById('factory-title').value.trim();
        const displayTitle = document.getElementById('factory-display-title').value.trim();
        const metadataURI = document.getElementById('factory-metadata-uri').value.trim();
        const details = document.getElementById('factory-details').value.trim();
        const expirationDays = parseInt(document.getElementById('factory-expiration').value);

        if (!ethers.utils.isAddress(factoryAddress)) {
            errorEl.textContent = 'Invalid factory contract address';
            errorEl.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Proposal...';

        try {
            const masterRegistryAddress = await getContractAddress('MasterRegistryV1');
            const calldata = REGISTRY_IFACE.encodeFunctionData('registerFactory', [factoryAddress, factoryType, title, displayTitle, metadataURI, []]);
            const expiration = Math.floor(Date.now() / 1000) + (expirationDays * 86400);
            const adapter = await serviceFactory.getGrandCentralAdapter();
            const receipt = await adapter.submitProposal([masterRegistryAddress], [0], [calldata], expiration, details);
            showProposalSuccess(container, receipt, 'factory registration');
        } catch (error) {
            console.error('[GovernancePage] Factory submit failed:', error);
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Proposal';
        }
    });
}

// ============================================================================
// VAULT APPLICATION FORM
// ============================================================================

async function renderVaultForm(container) {
    const connectedAddress = walletService.getAddress();
    if (!connectedAddress) {
        renderConnectPrompt(container, 'You need a connected wallet to submit a proposal.', () => renderVaultForm(container));
        return;
    }

    // Load alignment targets
    let targets = [];
    try {
        const masterAdapter = await serviceFactory.getMasterRegistryAdapter();
        if (masterAdapter && typeof masterAdapter.getAlignmentTargets === 'function') {
            targets = await masterAdapter.getAlignmentTargets();
        }
    } catch (e) {
        console.warn('[GovernancePage] Failed to load alignment targets:', e);
    }

    container.innerHTML = `
        <div class="governance-page">
            <button class="back-to-apply view-all-link" style="margin-bottom: var(--space-3); display: inline-block; cursor: pointer; background: none; border: none; font: inherit; color: inherit;">&larr; Back to Apply</button>

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
                    ${targets.length === 0 ? '<input type="number" id="vault-target-manual" placeholder="Target ID" min="1" style="margin-top: var(--space-1);" />' : ''}
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
                <div id="form-error" style="color: #c44; margin-bottom: var(--space-3); display: none;"></div>
                <button type="submit" class="btn btn-primary" style="width: 100%;">Submit Proposal</button>
            </form>
        </div>
    `;

    attachBackToApply(container);

    document.getElementById('vault-application-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('form-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        errorEl.style.display = 'none';

        const vaultAddress = document.getElementById('vault-address').value.trim();
        const targetSelect = document.getElementById('vault-target').value;
        const targetManual = document.getElementById('vault-target-manual')?.value;
        const targetId = parseInt(targetSelect || targetManual || '0');
        const vaultName = document.getElementById('vault-name').value.trim();
        const metadataURI = document.getElementById('vault-metadata-uri').value.trim();
        const details = document.getElementById('vault-details').value.trim();
        const expirationDays = parseInt(document.getElementById('vault-expiration').value);

        if (!ethers.utils.isAddress(vaultAddress)) { errorEl.textContent = 'Invalid vault contract address'; errorEl.style.display = 'block'; return; }
        if (!targetId || targetId < 1) { errorEl.textContent = 'Please select an alignment target'; errorEl.style.display = 'block'; return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Proposal...';

        try {
            const masterRegistryAddress = await getContractAddress('MasterRegistryV1');
            const calldata = REGISTRY_IFACE.encodeFunctionData('registerVault', [vaultAddress, walletService.getAddress(), vaultName, metadataURI, targetId]);
            const expiration = Math.floor(Date.now() / 1000) + (expirationDays * 86400);
            const adapter = await serviceFactory.getGrandCentralAdapter();
            const receipt = await adapter.submitProposal([masterRegistryAddress], [0], [calldata], expiration, details);
            showProposalSuccess(container, receipt, 'vault registration');
        } catch (error) {
            console.error('[GovernancePage] Vault submit failed:', error);
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Proposal';
        }
    });
}

// ============================================================================
// COMPONENT APPLICATION FORM
// ============================================================================

async function renderComponentForm(container) {
    const connectedAddress = walletService.getAddress();
    if (!connectedAddress) {
        renderConnectPrompt(container, 'You need a connected wallet to submit a proposal.', () => renderComponentForm(container));
        return;
    }

    container.innerHTML = `
        <div class="governance-page">
            <button class="back-to-apply view-all-link" style="margin-bottom: var(--space-3); display: inline-block; cursor: pointer; background: none; border: none; font: inherit; color: inherit;">&larr; Back to Apply</button>

            <header class="governance-header">
                <h1>Register a Component</h1>
                <p class="governance-subtitle">This creates a DAO proposal to approve a component module in the ComponentRegistry</p>
            </header>

            <form id="component-application-form" class="governance-form" style="margin: 0 auto;">
                <div class="form-group">
                    <label>Component Contract Address *</label>
                    <input type="text" id="component-address" placeholder="0x..." required />
                    <p class="form-hint">Must implement the relevant module interface (IGatingModule, ILiquidityDeployer, etc.)</p>
                </div>
                <div class="form-group">
                    <label>Component Type *</label>
                    <select id="component-tag" required>
                        <option value="">Select type...</option>
                        ${TAG_OPTIONS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                    </select>
                    <p class="form-hint" id="tag-description"></p>
                </div>
                <div class="form-group">
                    <label>Component Name *</label>
                    <input type="text" id="component-name" placeholder="Password Tier Gating" required />
                    <p class="form-hint">Human-readable name shown in the creation wizard</p>
                </div>
                <div class="form-group">
                    <label>Proposal Details / Rationale *</label>
                    <textarea id="component-details" placeholder="Describe what this component does and why it should be approved..." required></textarea>
                </div>
                <div class="form-group">
                    <label>Proposal Expiration (days from now) *</label>
                    <input type="number" id="component-expiration" value="30" min="1" max="365" required />
                </div>
                <div id="form-error" style="color: #c44; margin-bottom: var(--space-3); display: none;"></div>
                <button type="submit" class="btn btn-primary" style="width: 100%;">Submit Proposal</button>
            </form>
        </div>
    `;

    attachBackToApply(container);

    // Tag description update
    const tagSelect = document.getElementById('component-tag');
    const tagDesc = document.getElementById('tag-description');
    tagSelect.addEventListener('change', () => {
        const opt = TAG_OPTIONS.find(t => t.value === tagSelect.value);
        tagDesc.textContent = opt ? opt.description : '';
    });

    document.getElementById('component-application-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('form-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        errorEl.style.display = 'none';

        const componentAddress = document.getElementById('component-address').value.trim();
        const tagValue = document.getElementById('component-tag').value;
        const componentName = document.getElementById('component-name').value.trim();
        const details = document.getElementById('component-details').value.trim();
        const expirationDays = parseInt(document.getElementById('component-expiration').value);

        if (!ethers.utils.isAddress(componentAddress)) { errorEl.textContent = 'Invalid component contract address'; errorEl.style.display = 'block'; return; }
        if (!tagValue) { errorEl.textContent = 'Please select a component type'; errorEl.style.display = 'block'; return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Proposal...';

        try {
            const componentRegistryAddress = await getContractAddress('ComponentRegistry');
            const tagHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(tagValue));
            const calldata = COMPONENT_REGISTRY_IFACE.encodeFunctionData('approveComponent', [componentAddress, tagHash, componentName]);
            const expiration = Math.floor(Date.now() / 1000) + (expirationDays * 86400);
            const adapter = await serviceFactory.getGrandCentralAdapter();
            const receipt = await adapter.submitProposal([componentRegistryAddress], [0], [calldata], expiration, details);
            showProposalSuccess(container, receipt, 'component registration');
        } catch (error) {
            console.error('[GovernancePage] Component submit failed:', error);
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Proposal';
        }
    });
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

function attachBackToApply(container) {
    container.querySelectorAll('.back-to-apply').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const url = '/governance/apply';
            window.history.pushState({ path: url }, '', url);
            renderApplyTab(container);
        });
    });
}

function renderConnectPrompt(container, message, onConnect) {
    container.innerHTML = `
        <div class="governance-page">
            <div class="connect-prompt">
                <h2>Connect Your Wallet</h2>
                <p>${message}</p>
            </div>
        </div>
    `;

    const unsub = eventBus.on('wallet:connected', () => {
        unsub();
        onConnect();
    });
}

function showProposalSuccess(container, receipt, type) {
    let proposalId = null;
    if (receipt.events) {
        const submitEvent = receipt.events.find(e => e.event === 'ProposalSubmitted');
        if (submitEvent) proposalId = submitEvent.args.proposalId.toNumber();
    }

    container.innerHTML = `
        <div class="governance-page">
            <div class="governance-header" style="margin-top: var(--section-spacing-md);">
                <h1>Proposal Submitted!</h1>
                <p class="governance-subtitle">Your ${type} proposal has been created.</p>
                ${proposalId ? `<button class="btn btn-primary view-proposal-btn" data-id="${proposalId}" style="margin-top: var(--space-4);">View Proposal #${proposalId}</button>` : ''}
                <button class="btn btn-secondary back-to-proposals" style="display: block; margin-top: var(--space-3);">View all proposals</button>
            </div>
        </div>
    `;

    container.querySelector('.view-proposal-btn')?.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const url = `/governance/proposals/${id}`;
        window.history.pushState({ path: url }, '', url);
        const appTopContainer = document.getElementById('app-top-container');
        appTopContainer.querySelectorAll('.governance-nav-link').forEach(n => {
            n.classList.toggle('active', n.dataset.tab === 'proposals');
        });
        renderProposalDetail(container, id);
    });

    attachBackToProposals(container);
}

function formatTimestamp(ts) {
    if (!ts || ts === 0) return '';
    const date = new Date(ts * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
