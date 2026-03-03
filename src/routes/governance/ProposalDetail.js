import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';
import walletService from '../../services/WalletService.js';
import { renderGovernanceNav } from './shared/governanceNav.js';
import { ProposalState } from '../../services/contracts/GrandCentralAdapter.js';

// Known function selectors for calldata decoding
const KNOWN_SELECTORS = {
    // MasterRegistry
    '0x3659cfe6': { name: 'upgradeTo', params: ['address'] },
    // registerFactory(address,string,string,string,string,uint256)
    // registerVault(address,string,string,uint256)
    // registerAlignmentTarget(string,string,string,(address,uint256,bool)[])
    // addAmbassador(uint256,address)
    // GrandCentral
    // mintShares(address[],uint256[])
    // burnShares(address[],uint256[])
    // setConductors(address[],uint256[])
    // setGovernanceConfig(uint32,uint32,uint256,uint256,uint256)
};

// Full ABI fragments for decoding
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
];

const decoderIface = new ethers.utils.Interface(DECODER_FRAGMENTS);

/**
 * Proposal Detail Page - /governance/proposals/:id
 */
export async function renderProposalDetail(params) {
    const appContainer = document.getElementById('app-container');
    const appTopContainer = document.getElementById('app-top-container');
    const appBottomContainer = document.getElementById('app-bottom-container');

    if (!appContainer || !appTopContainer || !appBottomContainer) return;

    const proposalId = parseInt(params.id);
    if (isNaN(proposalId) || proposalId < 1) {
        appContainer.innerHTML = '<div class="governance-page"><div class="error-state"><h2>Invalid Proposal ID</h2></div></div>';
        return;
    }

    stylesheetLoader.load('src/routes/governance/governance.css', 'governance-styles');
    appTopContainer.innerHTML = '';
    appContainer.innerHTML = '';
    appBottomContainer.innerHTML = '';

    appTopContainer.innerHTML = renderGovernanceNav('/governance/proposals');

    appContainer.innerHTML = `
        <div class="governance-page">
            <div class="loading-state"><div class="spinner"></div><p>Loading proposal #${proposalId}...</p></div>
        </div>
    `;

    try {
        const adapter = await serviceFactory.getGrandCentralAdapter();
        const indexer = await serviceFactory.getGovernanceEventIndexer();

        // Real-time state from contract, event data from indexer
        const [proposal, state] = await Promise.all([
            adapter.getProposal(proposalId),
            adapter.getProposalState(proposalId),
        ]);

        if (state === 'Unborn') {
            appContainer.innerHTML = `
                <div class="governance-page">
                    <div class="error-state"><h2>Proposal #${proposalId} does not exist</h2>
                    <a href="/governance/proposals" class="btn btn-secondary">&larr; Back to Proposals</a></div>
                </div>
            `;
            return;
        }

        // Get submission event from indexer (contains targets/calldatas)
        let submissionEvent = null;
        try {
            const proposalEvents = await adapter.indexProposalEvents(0);
            submissionEvent = proposalEvents.find(e => e.proposalId === proposalId);
        } catch (e) {
            console.warn('[ProposalDetail] Failed to load proposal events:', e);
        }

        // Get votes from indexer
        const voteEvents = indexer.getVotes(proposalId);

        // Check if connected user can vote
        const connectedAddress = walletService.getAddress();
        let userShares = '0';
        if (connectedAddress) {
            try {
                userShares = await adapter.getShares(connectedAddress);
            } catch (e) { /* ignore */ }
        }

        const totalYes = parseFloat(proposal.yesVotes);
        const totalNo = parseFloat(proposal.noVotes);
        const totalVotes = totalYes + totalNo;
        const yesPercent = totalVotes > 0 ? (totalYes / totalVotes) * 100 : 0;
        const noPercent = totalVotes > 0 ? (totalNo / totalVotes) * 100 : 0;

        const sponsorDisplay = proposal.sponsor !== '0x0000000000000000000000000000000000000000'
            ? `${proposal.sponsor.slice(0, 6)}...${proposal.sponsor.slice(-4)}`
            : 'None';

        appContainer.innerHTML = `
            <div class="governance-page">
                <a href="/governance/proposals" class="view-all-link" style="margin-bottom: var(--spacing-4); display: inline-block;">&larr; All Proposals</a>

                <div class="proposal-card" style="cursor: default;">
                    <div class="proposal-card-header">
                        <span class="proposal-id" style="font-size: var(--font-size-xl);">#${proposal.id}</span>
                        <span class="proposal-state proposal-state--${state.toLowerCase()}">${state}</span>
                    </div>
                </div>

                <section class="governance-section">
                    <h2>Details</h2>
                    <p style="color: var(--text-primary); white-space: pre-wrap;">${proposal.details || 'No description provided'}</p>
                    <p style="color: var(--text-tertiary); font-size: var(--font-size-sm); margin-top: var(--spacing-2);">Sponsor: ${sponsorDisplay}</p>
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
                            <span class="votes-yes">Yes: ${totalYes.toFixed(2)} (${yesPercent.toFixed(1)}%)</span>
                            <span class="votes-no">No: ${totalNo.toFixed(2)} (${noPercent.toFixed(1)}%)</span>
                        </div>
                    </div>

                    ${state === 'Voting' && connectedAddress && parseFloat(userShares) > 0 ? `
                        <div class="vote-buttons">
                            <button class="btn btn-primary" id="vote-yes-btn">Vote Yes</button>
                            <button class="btn btn-secondary" id="vote-no-btn">Vote No</button>
                        </div>
                    ` : ''}

                    ${state === 'Voting' && !connectedAddress ? `
                        <p class="empty-state">Connect wallet to vote</p>
                    ` : ''}

                    ${state === 'Voting' && connectedAddress && parseFloat(userShares) === 0 ? `
                        <p class="empty-state">You need shares to vote</p>
                    ` : ''}

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

        // Attach vote/process button listeners
        attachVoteListeners(adapter, proposalId, submissionEvent);

    } catch (error) {
        console.error('[ProposalDetail] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-page">
                <div class="error-state">
                    <h2>Failed to Load Proposal</h2>
                    <p>${error.message}</p>
                    <a href="/governance/proposals" class="btn btn-secondary">&larr; Back</a>
                </div>
            </div>
        `;
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
        ${currentState === 'Cancelled' ? '<p style="color: #c44; font-size: var(--font-size-sm);">This proposal was cancelled.</p>' : ''}
        ${currentState === 'Defeated' ? '<p style="color: #c44; font-size: var(--font-size-sm);">This proposal was defeated.</p>' : ''}
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
                // Format if looks like ETH/token amount (> 1e15)
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
        // Couldn't decode — show raw selector
        const selector = calldata.slice(0, 10);
        return { functionName: `Unknown (${selector})`, params: null };
    }
}

function formatTimestamp(ts) {
    if (!ts || ts === 0) return '';
    const date = new Date(ts * 1000);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function attachVoteListeners(adapter, proposalId, submissionEvent) {
    const yesBtn = document.getElementById('vote-yes-btn');
    const noBtn = document.getElementById('vote-no-btn');
    const processBtn = document.getElementById('process-btn');

    if (yesBtn) {
        yesBtn.addEventListener('click', async () => {
            yesBtn.disabled = true;
            yesBtn.textContent = 'Submitting...';
            try {
                await adapter.submitVote(proposalId, true);
                window.router.navigate(`/governance/proposals/${proposalId}`);
            } catch (e) {
                yesBtn.disabled = false;
                yesBtn.textContent = 'Vote Yes';
                console.error('[ProposalDetail] Vote failed:', e);
            }
        });
    }

    if (noBtn) {
        noBtn.addEventListener('click', async () => {
            noBtn.disabled = true;
            noBtn.textContent = 'Submitting...';
            try {
                await adapter.submitVote(proposalId, false);
                window.router.navigate(`/governance/proposals/${proposalId}`);
            } catch (e) {
                noBtn.disabled = false;
                noBtn.textContent = 'Vote No';
                console.error('[ProposalDetail] Vote failed:', e);
            }
        });
    }

    if (processBtn && submissionEvent) {
        processBtn.addEventListener('click', async () => {
            processBtn.disabled = true;
            processBtn.textContent = 'Processing...';
            try {
                // processProposal needs the original targets/values/calldatas
                const rawValues = submissionEvent.values.map(v => ethers.utils.parseEther(v));
                await adapter.processProposal(proposalId, submissionEvent.targets, rawValues, submissionEvent.calldatas);
                window.router.navigate(`/governance/proposals/${proposalId}`);
            } catch (e) {
                processBtn.disabled = false;
                processBtn.textContent = 'Process Proposal';
                console.error('[ProposalDetail] Process failed:', e);
            }
        });
    }
}
