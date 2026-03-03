# Governance Hub & Creation Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **IMPORTANT:** Do NOT create git commits during implementation. The user will commit when ready.

**Goal:** Build a full DAO governance hub (GrandCentral) as a distinct section of ms2.fun, update the project creation flow for alignment target + vault selection, and add GrandCentral contract adapter infrastructure.

**Architecture:** New `/governance` route section with sub-routes for proposals, voting, share management, applications, treasury, and share offerings. New `GrandCentralAdapter` extends the existing `ContractAdapter` base class. Project creation updated to require alignment target and vault selection. All DAO state indexed from events via RPC, only `FeaturedQueueManager` uses contract getters.

**Tech Stack:** microact components, ethers.js v5, ContractAdapter pattern, EventBus, existing Router, Temple of Capital design system.

---

## Phase 1: GrandCentral Adapter & Service Layer

### Task 1: Create GrandCentral ABI JSON

**Files:**
- Create: `src/abis/GrandCentral.json`

**Step 1: Generate ABI from IGrandCentral interface**

Create the ABI JSON file from the IGrandCentral Solidity interface at `contracts/src/dao/interfaces/IGrandCentral.sol`. Include all functions, events, and enums. The ABI must cover:

Functions (all from IGrandCentral):
- `safe()`, `shares(address)`, `totalShares()`, `getSharesAt(address,uint256)`, `getTotalSharesAt(uint256)`
- `loot(address)`, `totalLoot()`, `getLootAt(address,uint256)`, `getTotalLootAt(uint256)`, `mintLoot(address[],uint256[])`, `burnLoot(address[],uint256[])`
- `submitProposal(address[],uint256[],bytes[],uint32,string)`, `sponsorProposal(uint32)`, `submitVote(uint32,bool)`, `processProposal(uint32,address[],uint256[],bytes[])`, `cancelProposal(uint32)`
- `state(uint32)`, `getProposalStatus(uint32)`
- `ragequitPool()`, `claimsPoolBalance()`, `generalFunds()`, `fundRagequitPool(uint256)`, `fundClaimsPool(uint256)`, `ragequit(uint256,uint256)`, `claim()`, `pendingClaim(address)`
- `conductors(address)`, `isAdmin(address)`, `isManager(address)`, `isGovernor(address)`, `setConductors(address[],uint256[])`, `mintShares(address[],uint256[])`, `burnShares(address[],uint256[])`, `setGovernanceConfig(uint32,uint32,uint256,uint256,uint256)`
- `executeStipend(address,uint256)`, `lockAdmin()`, `lockManager()`, `lockGovernor()`
- `votingPeriod()`, `gracePeriod()`, `quorumPercent()`, `sponsorThreshold()`, `minRetentionPercent()`, `proposalCount()`
- `proposals(uint32)` — public mapping getter

Events (all from IGrandCentral):
- `ProposalSubmitted`, `ProposalSponsored`, `VoteCast`, `ProposalProcessed`, `ProposalCancelled`
- `SharesMinted`, `SharesBurned`, `LootMinted`, `LootBurned`
- `RagequitPoolFunded`, `Ragequit`, `ClaimsPoolFunded`, `ClaimWithdrawn`
- `ConductorSet`, `GovernanceConfigSet`
- `AdminLocked`, `ManagerLocked`, `GovernorLocked`
- `StipendExecuted`

**Step 2: Verify ABI compiles**

Run: `node -e "const abi = require('./src/abis/GrandCentral.json'); console.log('Functions:', abi.filter(x => x.type === 'function').length); console.log('Events:', abi.filter(x => x.type === 'event').length);"`
Expected: Functions: ~35+, Events: ~16

---

### Task 2: Create GrandCentralAdapter

**Files:**
- Create: `src/services/contracts/GrandCentralAdapter.js`
- Reference: `src/services/contracts/ContractAdapter.js` (base class)
- Reference: `src/services/contracts/GovernanceAdapter.js` (existing pattern)
- Reference: `contracts/src/dao/interfaces/IGrandCentral.sol` (interface)

**Step 1: Write the adapter**

Follow the exact pattern from `GovernanceAdapter.js` — extend `ContractAdapter`, use `loadABI('GrandCentral')`, use `getCachedOrFetch` for reads, `executeContractCall` for writes, emit EventBus events for transactions.

```javascript
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import ContractAdapter from './ContractAdapter.js';
import { loadABI } from '../../utils/abiLoader.js';
import { eventBus } from '../../core/EventBus.js';
import { contractCache } from '../ContractCache.js';

const CACHE_TTL = {
    STATIC: 60 * 60 * 1000,      // 1 hour (governance params)
    DYNAMIC: 30 * 1000,           // 30 seconds (proposals, votes)
    SHARES: 2 * 60 * 1000,        // 2 minutes (share balances)
};

// ProposalState enum matching Solidity
const ProposalState = {
    0: 'Unborn',
    1: 'Submitted',
    2: 'Voting',
    3: 'Cancelled',
    4: 'Grace',
    5: 'Ready',
    6: 'Processed',
    7: 'Defeated'
};

class GrandCentralAdapter extends ContractAdapter {
    constructor(contractAddress, ethersProvider, signer) {
        super(contractAddress, 'GrandCentral', ethersProvider, signer);
        this.ethers = ethers;
    }

    async initialize() { /* load ABI, create contract instance */ }

    // === Read Methods (Event-Indexed where possible) ===

    // Shares & Loot
    async getShares(address) { /* shares(address) */ }
    async getTotalShares() { /* totalShares() */ }
    async getLoot(address) { /* loot(address) */ }
    async getTotalLoot() { /* totalLoot() */ }
    async getSharesAt(address, timestamp) { /* getSharesAt(address, uint256) */ }
    async getMemberSummary(address) { /* batch: shares + loot + pendingClaim */ }

    // Proposals
    async getProposal(id) { /* proposals(uint32) - parse struct */ }
    async getProposalState(id) { /* state(uint32) - return ProposalState string */ }
    async getProposalCount() { /* proposalCount() */ }

    // Treasury
    async getRagequitPool() { /* ragequitPool() */ }
    async getClaimsPoolBalance() { /* claimsPoolBalance() */ }
    async getGeneralFunds() { /* generalFunds() */ }
    async getPendingClaim(address) { /* pendingClaim(address) */ }
    async getTreasurySummary() { /* batch all treasury reads */ }

    // Governance Params
    async getGovernanceConfig() { /* batch: votingPeriod, gracePeriod, quorumPercent, sponsorThreshold, minRetentionPercent */ }

    // Conductors
    async getConductorPermissions(address) { /* conductors(address) */ }
    async isConductorAdmin(address) { /* isAdmin(address) */ }

    // Safe
    async getSafe() { /* safe() */ }

    // === Write Methods ===

    async submitProposal(targets, values, calldatas, expiration, details) { /* submitProposal */ }
    async sponsorProposal(id) { /* sponsorProposal */ }
    async submitVote(id, approved) { /* submitVote */ }
    async processProposal(id, targets, values, calldatas) { /* processProposal */ }
    async cancelProposal(id) { /* cancelProposal */ }
    async ragequit(sharesToBurn, lootToBurn) { /* ragequit */ }
    async claim() { /* claim */ }

    // === Event Indexing ===

    async indexProposalEvents(fromBlock = 0) {
        /* Query ProposalSubmitted, ProposalSponsored, VoteCast, ProposalProcessed, ProposalCancelled events */
        /* Return array of parsed proposal data */
    }

    async indexShareEvents(fromBlock = 0) {
        /* Query SharesMinted, SharesBurned, LootMinted, LootBurned events */
    }

    async indexTreasuryEvents(fromBlock = 0) {
        /* Query RagequitPoolFunded, Ragequit, ClaimsPoolFunded, ClaimWithdrawn events */
    }

    // === Helpers ===
    _parseProposal(raw) { /* parse Proposal struct from contract response */ }
}

export default GrandCentralAdapter;
```

Each read method follows the pattern:
```javascript
async getShares(address) {
    return await this.getCachedOrFetch('shares', [address], async () => {
        const shares = await this.executeContractCall('shares', [address]);
        return ethers.utils.formatEther(shares);
    }, CACHE_TTL.SHARES);
}
```

Each write method follows the pattern:
```javascript
async submitVote(id, approved) {
    try {
        eventBus.emit('transaction:pending', { type: 'submitVote', proposalId: id });
        const receipt = await this.executeContractCall('submitVote', [id, approved], { requiresSigner: true });
        eventBus.emit('transaction:success', { type: 'submitVote', receipt, proposalId: id });
        contractCache.invalidateByPattern('proposal', 'vote');
        return receipt;
    } catch (error) {
        eventBus.emit('transaction:error', { type: 'submitVote', error: this.wrapError(error, 'Vote submission failed') });
        throw error;
    }
}
```

Event indexing methods use `contract.queryFilter`:
```javascript
async indexProposalEvents(fromBlock = 0) {
    const filter = this.contract.filters.ProposalSubmitted();
    const events = await this.contract.queryFilter(filter, fromBlock, 'latest');
    return events.map(e => ({
        proposalId: e.args.proposalId.toNumber(),
        proposalDataHash: e.args.proposalDataHash,
        targets: e.args.targets,
        values: e.args.values.map(v => ethers.utils.formatEther(v)),
        calldatas: e.args.calldatas,
        expiration: e.args.expiration,
        selfSponsor: e.args.selfSponsor,
        details: e.args.details,
        blockNumber: e.blockNumber,
        transactionHash: e.transactionHash
    }));
}
```

**Step 2: Verify adapter loads without errors**

Import in a test script or browser console:
```javascript
import GrandCentralAdapter from './src/services/contracts/GrandCentralAdapter.js';
console.log('GrandCentralAdapter loaded:', typeof GrandCentralAdapter);
```

---

### Task 3: Register GrandCentralAdapter in ServiceFactory

**Files:**
- Modify: `src/services/ServiceFactory.js`
- Modify: `src/config/contracts.local.json` (add GrandCentral address)

**Step 1: Add GrandCentral address to local config**

After deploying GrandCentral to the local Anvil fork, add its address to `contracts.local.json` under `contracts`:
```json
"GrandCentral": "<deployed-address>"
```

Also add to the config any new contracts:
```json
"ProtocolTreasuryV1": "<deployed-address>",
"PromotionBadges": "<deployed-address>"
```

**Step 2: Add getGrandCentralAdapter() to ServiceFactory**

In `src/services/ServiceFactory.js`, add:
- Import `GrandCentralAdapter`
- Add `grandCentralAdapter` field to constructor
- Add `getGrandCentralAdapter()` method following the exact pattern of `getFeaturedQueueManagerAdapter()`
- Add to `clearCache()` method

```javascript
import GrandCentralAdapter from './contracts/GrandCentralAdapter.js';

// In constructor:
this.grandCentralAdapter = null;

// New method:
async getGrandCentralAdapter() {
    if (!this.grandCentralAdapter) {
        const grandCentralAddress = await getContractAddress('GrandCentral');
        if (!grandCentralAddress || grandCentralAddress === '0x0000000000000000000000000000000000000000') {
            throw new Error('GrandCentral address not available');
        }

        let provider, signer;
        const walletProviderAndSigner = walletService.getProviderAndSigner();
        if (walletProviderAndSigner.provider) {
            provider = walletProviderAndSigner.provider;
            signer = walletProviderAndSigner.signer;
        } else {
            const network = (await import('../config/network.js')).detectNetwork();
            if (network.mode === 'local' && network.rpcUrl) {
                const { ethers } = await import('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js');
                provider = new ethers.providers.StaticJsonRpcProvider(
                    network.rpcUrl,
                    { name: 'anvil', chainId: network.chainId, ensAddress: null }
                );
                signer = null;
            } else {
                throw new Error('No provider available for GrandCentral');
            }
        }

        this.grandCentralAdapter = new GrandCentralAdapter(
            grandCentralAddress,
            provider,
            signer
        );
        await this.grandCentralAdapter.initialize();
    }
    return this.grandCentralAdapter;
}

// In clearCache():
if (this.grandCentralAdapter) {
    this.grandCentralAdapter = null;
}
```

**Step 3: Verify ServiceFactory can create the adapter**

In browser console after deploying contracts:
```javascript
const adapter = await serviceFactory.getGrandCentralAdapter();
console.log('Adapter initialized:', adapter.initialized);
```

---

## Phase 2: Governance Hub Routes & Navigation

### Task 4: Register Governance Routes

**Files:**
- Modify: `src/index.js`

**Step 1: Add governance routes**

Add these routes after the existing `/voting` route registration in `src/index.js`:

```javascript
// Governance Hub routes
router.on('/governance', async () => {
    const { renderGovernanceOverview } = await import('./routes/governance/GovernanceOverview.js');
    return renderGovernanceOverview();
});

router.on('/governance/proposals', async () => {
    const { renderProposalsList } = await import('./routes/governance/ProposalsList.js');
    return renderProposalsList();
});

router.on('/governance/proposals/:id', async (params) => {
    const { renderProposalDetail } = await import('./routes/governance/ProposalDetail.js');
    return renderProposalDetail(params);
});

router.on('/governance/apply', async () => {
    const { renderGovernanceApply } = await import('./routes/governance/GovernanceApply.js');
    return renderGovernanceApply();
});

router.on('/governance/apply/factory', async () => {
    const { renderFactoryApplicationForm } = await import('./routes/governance/FactoryApplicationForm.js');
    return renderFactoryApplicationForm();
});

router.on('/governance/apply/vault', async () => {
    const { renderVaultApplicationForm } = await import('./routes/governance/VaultApplicationForm.js');
    return renderVaultApplicationForm();
});

router.on('/governance/member', async () => {
    const { renderMemberDashboard } = await import('./routes/governance/MemberDashboard.js');
    return renderMemberDashboard();
});

router.on('/governance/treasury', async () => {
    const { renderTreasuryView } = await import('./routes/governance/TreasuryView.js');
    return renderTreasuryView();
});

router.on('/governance/shares', async () => {
    const { renderShareOffering } = await import('./routes/governance/ShareOffering.js');
    return renderShareOffering();
});
```

**Step 2: Verify routes register without error**

Run the dev server: `npm run dev`
Navigate to `/governance` — should show 404 (pages not yet created) but no JS errors in console.

---

### Task 5: Create Governance Overview Page (Shell)

**Files:**
- Create: `src/routes/governance/GovernanceOverview.js`
- Create: `src/routes/governance/governance.css`

**Step 1: Create the overview page**

This is the main landing page for `/governance`. Follow the pattern from existing routes like `src/routes/ProjectCreation.js`:
- Load stylesheet
- Get containers (`app-container`, `app-top-container`, `app-bottom-container`)
- Clear existing content
- Show loading state
- Fetch data from GrandCentralAdapter
- Render the page

```javascript
import stylesheetLoader from '../../utils/stylesheetLoader.js';
import serviceFactory from '../../services/ServiceFactory.js';

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

    // Governance navigation bar
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
                        <span class="stat-value">${treasurySummary.ragequitPool} ETH</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-label">Claims Pool</span>
                        <span class="stat-value">${treasurySummary.claimsPool} ETH</span>
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
                    <a href="/governance/proposals" class="view-all-link">View all proposals →</a>
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

        // Load active proposals asynchronously
        loadActiveProposals(adapter);

    } catch (error) {
        console.error('[GovernanceOverview] Error:', error);
        appContainer.innerHTML = `
            <div class="governance-overview">
                <div class="error-state">
                    <h2>Governance Unavailable</h2>
                    <p>${error.message}</p>
                </div>
            </div>
        `;
    }
}

function renderGovernanceNav(activePath) {
    const links = [
        { path: '/governance', label: 'Overview' },
        { path: '/governance/proposals', label: 'Proposals' },
        { path: '/governance/apply', label: 'Apply' },
        { path: '/governance/member', label: 'Member' },
        { path: '/governance/treasury', label: 'Treasury' },
        { path: '/governance/shares', label: 'Shares' },
    ];

    return `
        <nav class="governance-nav">
            <a href="/" class="governance-nav-home">← ms2.fun</a>
            <div class="governance-nav-links">
                ${links.map(l => `
                    <a href="${l.path}" class="governance-nav-link ${activePath === l.path ? 'active' : ''}">${l.label}</a>
                `).join('')}
            </div>
        </nav>
    `;
}

async function loadActiveProposals(adapter) {
    try {
        const proposalCount = await adapter.getProposalCount();
        const container = document.getElementById('active-proposals-list');
        if (!container) return;

        const activeProposals = [];
        // Check recent proposals for active ones (Voting or Grace state)
        const checkCount = Math.min(proposalCount, 20);
        for (let i = proposalCount; i > proposalCount - checkCount && i > 0; i--) {
            const state = await adapter.getProposalState(i);
            if (state === 'Voting' || state === 'Grace' || state === 'Ready' || state === 'Submitted') {
                const proposal = await adapter.getProposal(i);
                activeProposals.push({ ...proposal, state });
            }
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
                <div class="proposal-votes">
                    <span class="votes-yes">Yes: ${p.yesVotes}</span>
                    <span class="votes-no">No: ${p.noVotes}</span>
                </div>
            </a>
        `).join('');
    } catch (error) {
        console.error('[GovernanceOverview] Failed to load proposals:', error);
    }
}
```

**Step 2: Create governance.css**

Style the governance section using the Temple of Capital design system. Use CSS variables from `theme.css` and `components.css`. Key classes: `.governance-overview`, `.governance-nav`, `.governance-stats-grid`, `.stat-card`, `.proposal-card`, `.action-card`, `.governance-section`.

Use the marble/stone palette for backgrounds, gold accents for active states and CTAs, and the engraved plaque style for action cards.

**Step 3: Verify page renders**

Navigate to `/governance` in the browser. Should see the DAO overview with stats, navigation, and action cards. If GrandCentral isn't deployed yet, the error state should display gracefully.

---

### Task 6: Create Proposals List Page

**Files:**
- Create: `src/routes/governance/ProposalsList.js`

**Step 1: Write the proposals list page**

Route handler for `/governance/proposals`. Indexes all proposals from events, displays in a filterable list. Filters: All, Active (Voting/Grace), Ready, Passed, Defeated, Cancelled.

Follow the same route handler pattern as Task 5. Use `adapter.indexProposalEvents()` to get all proposals, then batch-query their current states.

Key features:
- Status filter pills (All, Active, Ready, Passed, Defeated)
- Proposal cards showing: ID, state badge, details text, vote counts, sponsor, timestamps
- Click navigates to `/governance/proposals/:id`
- Pagination if > 20 proposals (simple "Load More" button)

**Step 2: Verify page renders with proposal data**

---

### Task 7: Create Proposal Detail Page

**Files:**
- Create: `src/routes/governance/ProposalDetail.js`

**Step 1: Write the proposal detail page**

Route handler for `/governance/proposals/:id`. Shows full proposal details with voting interface.

Sections:
1. **Header**: Proposal ID, state badge, sponsor address
2. **Details**: Proposer's description text
3. **Timeline**: Visual timeline showing Submitted → Voting → Grace → Ready/Processed states with timestamps
4. **Decoded Actions**: Parse `targets`, `values`, `calldatas` from ProposalSubmitted event into human-readable descriptions. Common decodings:
   - MasterRegistry calls: `registerFactory`, `registerVaultFactory`, `addAlignmentTarget`, `addAlignmentAsset`, `setVaultForTarget`, `addAmbassador`
   - GrandCentral calls: `mintShares`, `burnShares`, `setConductors`, `setGovernanceConfig`
   - Show raw hex as expandable fallback for unknown selectors
5. **Voting**: If state is `Voting`, show Yes/No vote buttons (requires wallet connection + shares)
6. **Process**: If state is `Ready`, show "Process Proposal" button
7. **Vote Tally**: Current yes/no vote counts, quorum progress bar
8. **Vote History**: List VoteCast events for this proposal

Calldata decoding helper:
```javascript
function decodeProposalAction(target, value, calldata, knownContracts) {
    // Match target address to known contract
    // Use ethers.utils.Interface to decode function selector + params
    // Return { contractName, functionName, params, raw }
}
```

**Step 2: Verify page renders for a known proposal ID**

---

### Task 8: Create Member Dashboard Page

**Files:**
- Create: `src/routes/governance/MemberDashboard.js`

**Step 1: Write the member dashboard**

Route handler for `/governance/member`. Requires wallet connection. Shows the connected user's DAO membership status.

Sections:
1. **Share/Loot Summary**: Current shares, loot, total voting power, percentage of total
2. **Pending Claims**: Claimable ETH from claims pool, "Claim" button
3. **Voting History**: Recent votes from VoteCast events filtered by user address
4. **Ragequit**: Calculator showing ETH receivable for burning N shares/N loot, ragequit button with confirmation
5. **Delegation**: (future - stub with "Coming soon")

If wallet not connected, show connect prompt.
If user has 0 shares and 0 loot, show "Not a member" state with link to `/governance/shares`.

**Step 2: Verify page renders with wallet connected**

---

### Task 9: Create Treasury View Page

**Files:**
- Create: `src/routes/governance/TreasuryView.js`

**Step 1: Write the treasury view**

Route handler for `/governance/treasury`. Public page showing DAO treasury health.

Sections:
1. **Pool Balances**: Ragequit pool, claims pool, general funds (from GrandCentral)
2. **Protocol Treasury**: (from ProtocolTreasuryV1 if adapter exists) Revenue breakdown by source
3. **Recent Activity**: Indexed events - RagequitPoolFunded, ClaimsPoolFunded, ClaimWithdrawn, Ragequit events

This is a read-only page, no wallet required.

**Step 2: Verify page renders**

---

### Task 10: Create Application Gateway Pages

**Files:**
- Create: `src/routes/governance/GovernanceApply.js`
- Create: `src/routes/governance/FactoryApplicationForm.js`
- Create: `src/routes/governance/VaultApplicationForm.js`

**Step 1: Write the application gateway landing page**

Route handler for `/governance/apply`. Simple selection page with two cards:
- "Register a Factory" → links to `/governance/apply/factory`
- "Register a Vault" → links to `/governance/apply/vault`

Each card explains what factories and vaults are and what's required to apply.

**Step 2: Write the factory application form**

Route handler for `/governance/apply/factory`. Structured wizard form that generates a GrandCentral proposal.

Form fields:
- Factory contract address (text input, validates it implements IFactory)
- Factory type (dropdown: ERC404, ERC1155, ERC721, Other)
- Title (text input)
- Display title (text input)
- Description (textarea)
- Metadata URI (text input, optional)
- Proposal details/rationale (textarea - goes into the `details` string)
- Expiration (number input - days from now, converted to uint32 timestamp)

On submit:
1. Encode `MasterRegistry.registerFactory(address, type, title, displayTitle, metadataURI)` as calldata
2. Call `adapter.submitProposal([masterRegistryAddress], [0], [calldata], expiration, details)`
3. Show success with link to proposal

**Step 3: Write the vault application form**

Similar to factory form but for vault registration:
- Vault contract address
- Alignment target selection (dropdown populated from MasterRegistry alignment targets)
- Vault name
- Description
- Metadata URI

On submit: encode `MasterRegistry.registerVault(address, targetId, ...)` as calldata, submit as proposal.

**Step 4: Verify forms render and submit**

---

### Task 11: Create Share Offering Page

**Files:**
- Create: `src/routes/governance/ShareOffering.js`
- Create: `src/services/contracts/ShareOfferingAdapter.js`
- Create: `src/abis/ShareOffering.json`

**Step 1: Create ShareOffering ABI**

Generate from `contracts/src/dao/conductors/ShareOffering.sol`. Key functions: `contribute()`, `claim()`, `offering()` struct getter, `contributions(address)`.

**Step 2: Create ShareOfferingAdapter**

Follow ContractAdapter pattern. Methods:
- `getOffering()` - current offering details (goal, raised, start, end, sharePrice)
- `getContribution(address)` - user's contribution
- `contribute(amount)` - write method
- `claim()` - claim shares after offering ends

**Step 3: Write the share offering page**

Route handler for `/governance/shares`. Shows active share offerings.

If an active offering exists:
- Offering details (goal, progress bar, time remaining, share price)
- Contribute form (ETH amount input, contribute button)
- User's contribution and claimable shares

If no active offering:
- "No active offerings" state
- Historical offering results from events

---

## Phase 3: Project Creation Flow Update

### Task 12: Update Project Creation to Include Alignment Target & Vault Selection

**Files:**
- Modify: `src/routes/ProjectCreation.js`
- Modify: `src/services/contracts/MasterRegistryAdapter.js` (add alignment target methods)

**Step 1: Add alignment target methods to MasterRegistryAdapter**

The MasterRegistry now has alignment targets. Add methods:
- `getAlignmentTargets()` - index AlignmentTargetAdded events to get all targets
- `getAlignmentTargetAssets(targetId)` - get assets for a target
- `getVaultsForTarget(targetId)` - get registered vaults for a target

**Step 2: Update the creation form**

The current flow: select factory → fill project details → deploy.

New flow: select factory type (ERC404/ERC1155/ERC721) → select alignment target → select vault for that target → fill project details → deploy.

Update `renderProjectCreation` to:
1. Load alignment targets from MasterRegistryAdapter
2. Show factory type selector (ERC404 Bonding, ERC1155 Editions, ERC721 Auctions)
3. Show alignment target selector with target names and descriptions
4. Once target selected, show available vaults for that target
5. Once vault selected, show project-specific form (name, symbol, etc.)
6. On submit, deploy instance with immutable vault binding

The form should cascade: changing factory type resets later steps, changing alignment target resets vault selection.

**Step 3: Verify the new creation flow works end-to-end**

---

### Task 13: Add ERC721 Auction Factory Support

**Files:**
- Create: `src/services/contracts/ERC721AuctionFactoryAdapter.js`
- Create: `src/abis/ERC721AuctionFactory.json`
- Create: `src/abis/ERC721AuctionInstance.json`
- Modify: `src/services/contracts/ContractTypeRegistry.js` (register new type)

**Step 1: Create ERC721AuctionFactory ABI**

Generate from `contracts/src/factories/erc721/ERC721AuctionFactory.sol`. Key functions: `createInstance()`, deployment parameters.

**Step 2: Create ERC721AuctionInstance ABI**

Generate from `contracts/src/factories/erc721/ERC721AuctionInstance.sol`. Key functions: `bid()`, `settleAuction()`, `currentAuction()`, auction state getters.

**Step 3: Create ERC721AuctionFactoryAdapter**

Follow pattern from `ERC404FactoryAdapter.js`:
- `createInstance(params)` - deploy new auction instance
- `getInstanceCount()` - number of instances
- `getInstance(index)` - get instance address

**Step 4: Register in ContractTypeRegistry**

Add `ERC721Auction` type mapping in `src/services/contracts/ContractTypeRegistry.js`.

---

## Phase 4: Event-Indexed State Migration

### Task 14: Create GovernanceEventIndexer Service

**Files:**
- Create: `src/services/GovernanceEventIndexer.js`

**Step 1: Write the event indexer**

Service that indexes GrandCentral events and caches results. Follows the existing `ProjectIndex.js` pattern for localStorage caching with block number tracking.

```javascript
class GovernanceEventIndexer {
    constructor() {
        this.lastIndexedBlock = 0;
        this.proposals = new Map();     // id => proposal data
        this.votes = new Map();         // proposalId => [votes]
        this.shares = new Map();        // address => { shares, loot }
        this.treasuryEvents = [];
        this.cacheKey = 'ms2fun-governance-index';
    }

    async initialize(adapter) { /* load from localStorage, index new events */ }
    async indexFromBlock(adapter, fromBlock) { /* query all event types, merge into state */ }
    getProposals(filter) { /* return filtered proposals */ }
    getProposal(id) { /* return single proposal with votes */ }
    getMemberData(address) { /* return shares/loot/votes for address */ }
    save() { /* persist to localStorage */ }
    clear() { /* clear cache */ }
}
```

**Step 2: Integrate with ServiceFactory**

Add `getGovernanceEventIndexer()` to ServiceFactory.

---

### Task 15: Update Governance Pages to Use Event Indexer

**Files:**
- Modify: `src/routes/governance/GovernanceOverview.js`
- Modify: `src/routes/governance/ProposalsList.js`
- Modify: `src/routes/governance/ProposalDetail.js`
- Modify: `src/routes/governance/MemberDashboard.js`

**Step 1: Replace direct contract reads with event indexer**

Instead of querying each proposal individually, use the GovernanceEventIndexer to:
- Get all proposals in one batch
- Get vote history from events
- Get member share history from events
- Only use contract getters for `pendingClaim()` and current `state()` (needs real-time accuracy)

**Step 2: Add refresh/re-index capability**

Add a "Refresh" button on governance pages that triggers `indexer.indexFromBlock(adapter, lastBlock)` to catch new events.

---

## Phase 5: Deploy Script & Seed State

### Task 16: Create Local Development Seed Script

**Files:**
- Create: `scripts/seed-governance.js`

**Step 1: Write seed script**

Node.js script that deploys GrandCentral to local Anvil fork and seeds governance state:
- Deploy GrandCentral with test Safe address
- Mint shares to test accounts
- Create sample proposals (factory registration, vault registration, parameter change)
- Submit votes on proposals
- Fund treasury pools
- Update `contracts.local.json` with deployed addresses

Uses ethers.js + Anvil's `anvil_impersonateAccount` for testing.

**Step 2: Verify seed script runs**

Run: `node scripts/seed-governance.js`
Expected: GrandCentral deployed, proposals created, addresses written to config.

---

## Summary

| Phase | Tasks | What It Delivers |
|-------|-------|------------------|
| 1 | Tasks 1-3 | GrandCentral contract adapter + ServiceFactory integration |
| 2 | Tasks 4-11 | Full governance hub UI (overview, proposals, voting, member, treasury, applications, shares) |
| 3 | Tasks 12-13 | Updated project creation flow + ERC721 auction support |
| 4 | Tasks 14-15 | Event-indexed state for governance (no contract getters) |
| 5 | Task 16 | Local dev seed script for testing |

Dependencies:
- Phase 1 must complete before Phase 2 (adapter needed for pages)
- Task 4 (routes) can run in parallel with Tasks 1-3
- Phase 3 can run in parallel with Phase 2
- Phase 4 depends on Phase 2 (refactors the pages)
- Phase 5 can run in parallel with Phase 1
