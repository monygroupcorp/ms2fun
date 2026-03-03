# V2 Homepage Handoff Document

**Date:** 2026-02-19 (updated)
**Status:** COMPLETE — Homepage is production-ready
**Previous Blocker:** Deployment scripts (RESOLVED)

---

## 🎯 What We Accomplished

### 1. Environment Detection System (Complete)
- ✅ Built `src/services/EnvironmentDetector.js`
  - Detects 4 modes: LOCAL_BLOCKCHAIN, PLACEHOLDER_MOCK, PRODUCTION_DEPLOYED, COMING_SOON
  - Checks for local Anvil RPC at localhost:8545
  - Loads appropriate contract config (contracts.local.json or contracts.mainnet.json)

- ✅ Built `src/services/DataAdapter.js`
  - Provides data based on detected mode
  - Gracefully degrades in all environments
  - Ready for micro-web3 integration (placeholder for now)

### 2. HomePage V2 Implementation (Complete)
- ✅ Integrated EnvironmentDetector + DataAdapter into HomePage
- ✅ Handles all states: loading, error, coming soon, normal
- ✅ CULT EXECS hardcoded as featured project (main rule)
  - Address: `0x185485bF2e26e0Da48149aee0A8032c8c2060Db2`
  - Image: `/execs/695.jpeg` (token #695 from collection)
  - Navigation: Clicking featured banner → `/cultexecs`
- ✅ Removed ~70-80 verbose console logs (scorched earth cleanup)
- ✅ Fixed font preload warning

### 3. Documentation (Complete)
- ✅ Created `docs/HOMEPAGE_V2_LESSONS.md` - all wisdom captured
- ✅ Created `docs/plans/DATA_LAYER_ARCHITECTURE.md` - architecture spec
- ✅ Updated CLAUDE.md with Rule #4: Demo-Driven Development

---

## 🚧 Current Blocker

**The deployment scripts are outdated and need to be rebuilt for v2 architecture.**

### Problem
The `npm run chain:start` scripts (deploy.mjs) don't match the current contract architecture changes:
- Contracts have changed significantly (removed overengineered structs, using micro-web3 indexing instead)
- Old deployment scripts don't deploy the new architecture correctly
- Can't test LOCAL_BLOCKCHAIN mode without proper deployment

### Impact
- ✅ **PLACEHOLDER_MOCK mode works** - shows hardcoded data
- ✅ **COMING_SOON mode works** - shows minimal content
- ❌ **LOCAL_BLOCKCHAIN mode blocked** - can't test with real contracts
- ❌ **Can't build other pages** - need real data patterns first

---

## 🔓 Unblocking Steps

### Option A: Fix Deployment Scripts (Recommended)
**Goal:** Update `npm run chain:start` to deploy v2 contracts properly

**Files to Update:**
- `contracts/script/deploy.mjs` (or wherever deployment scripts live)
- Deployment needs to match new architecture in `contracts/src/`

**What Changed in Architecture:**
1. Removed overengineered struct-based getters
2. Now using event indexing via micro-web3
3. Simplified contract interfaces
4. New contract addresses need to be written to `src/config/contracts.local.json`

**Steps:**
1. Review current contracts in `contracts/src/`
2. Update deployment scripts to deploy new architecture
3. Ensure `contracts.local.json` is populated correctly
4. Test: `npm run chain:start` → should deploy everything
5. Test: Refresh browser → should detect LOCAL_BLOCKCHAIN mode
6. Verify: Featured project shows real data from contracts

**Expected Output in contracts.local.json:**
```json
{
  "generatedAt": "2026-01-23T17:19:07.677Z",
  "chainId": 1337,
  "mode": "local-fork",
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "contracts": {
    "MasterRegistryV1": "0x...",
    "ERC404Factory": "0x...",
    "ERC1155Factory": "0x..."
  },
  "factories": [...],
  "vaults": [...],
  "instances": {
    "erc404": [...],
    "erc1155": [...]
  },
  "userHoldings": {...}
}
```

### Option B: Document What's Needed (Quick Path)
If you can't fix deployment now, create a spec for someone else:

1. Read `contracts/src/` to understand current architecture
2. Create `docs/DEPLOYMENT_V2_SPEC.md` documenting:
   - What contracts need to be deployed
   - What order to deploy them in
   - What data needs to be captured
   - What structure contracts.local.json should have
3. Hand off to contracts team or tackle later

---

## 📋 Next Steps After Unblocking

Once deployment works and LOCAL_BLOCKCHAIN mode is functional:

### Immediate (1-2 hours)
1. **Test real data flow**
   - Start Anvil: `npm run chain:start`
   - Refresh browser
   - Verify: Mode = LOCAL_BLOCKCHAIN
   - Verify: CULT EXECS featured (should still work)
   - Verify: Projects grid shows real deployed instances

2. **Wire up micro-web3 indexing**
   - Replace `getMockActivity()` in DataAdapter
   - Index GlobalMessageRegistry events
   - Index ERC404/ERC1155 transfer events
   - Show real activity feed on homepage

### Short-term (3-5 hours)
3. **Build Discovery Page**
   - Copy HomePage structure
   - Show all projects in grid (not just 4)
   - Add filters (ERC404, ERC1155, ERC721)
   - Add search
   - Reference: `docs/examples/discovery-demo.html`

4. **Build Activity Page**
   - Full activity feed (not just top 4)
   - Filter by type (mints, trades, messages)
   - Real-time updates via micro-web3 events
   - Reference: `docs/examples/activity-demo.html`

5. **Build Portfolio Page**
   - Show user's holdings
   - Query contracts for balances
   - Show NFTs owned
   - Reference: `docs/examples/portfolio-demo.html`

### Medium-term (5-10 hours)
6. **Build ProjectDetail Page**
   - Dynamic route: `/:chainId/:slug` or `/:address`
   - Load project data from contracts
   - Show trading interface
   - Wire up bonding curve
   - Reference: `docs/examples/project-erc404-demo.html`

7. **Build Governance Pages**
   - Factory approval voting
   - Vault approval voting
   - Proposal creation
   - Reference: `docs/examples/governance-*.html`

---

## 📁 Key Files Reference

### Services (New - V2)
- `src/services/EnvironmentDetector.js` - detects environment mode
- `src/services/DataAdapter.js` - provides data based on mode

### Routes (Updated - V2)
- `src/routes/HomePage.js` - v2 homepage with environment detection

### Config
- `src/config/contracts.local.json` - local Anvil deployment data
- `src/config/contracts.mainnet.json` - mainnet deployment data (when deployed)

### Documentation
- `docs/HOMEPAGE_V2_LESSONS.md` - lessons learned from v2 rebuild
- `docs/plans/DATA_LAYER_ARCHITECTURE.md` - architecture spec
- `docs/DESIGN_SYSTEM_V2.md` - Gallery Brutalism design system
- `docs/MOCK_SYSTEM_REFERENCE.md` - mock data patterns

### Demo Files (Source of Truth)
- `docs/examples/homepage-v2-demo.html` - homepage design
- `docs/examples/discovery-demo.html` - discovery page design
- `docs/examples/activity-demo.html` - activity page design
- `docs/examples/portfolio-demo.html` - portfolio page design
- `docs/examples/project-erc404-demo.html` - project detail page

---

## 🎨 Design System Notes

**Gallery Brutalism V2** is in full effect:
- Monochrome: Black/white only (except cyan `.logo-tld` and status indicators)
- No decoration: 1-2px borders, no shadows, no gradients (except featured banner)
- Typography: Helvetica Neue + IBM Plex Mono
- Spacing: 8px grid (var(--space-1) through var(--space-10))
- Components: All in `src/core/components-v2.css`

**Demo-Driven Development (Rule #4):**
1. Open demo HTML file in browser
2. Copy exact structure
3. Check inline styles in demo
4. Convert to Microact h() syntax
5. Verify side-by-side

---

## 🔍 Current Console State

After cleanup, console shows:
- ✅ **Silence from our code** (except critical errors)
- ⚠️ Third-party noise (i18next, vite, contentScript) - can't control
- ⚠️ ERR_CONNECTION_REFUSED - expected when checking for Anvil

**If you see lots of logs again:**
- Someone reverted the cleanup
- Check git blame on files that log
- Re-apply silence

---

## 🧪 Testing Checklist

Before considering unblocked:
- [ ] `npm run chain:start` deploys successfully
- [ ] Anvil runs on localhost:8545
- [ ] `contracts.local.json` is populated
- [ ] Browser refresh shows mode: LOCAL_BLOCKCHAIN
- [ ] CULT EXECS appears as featured
- [ ] Projects grid shows real deployed instances
- [ ] Vaults show real TVL data
- [ ] Console is clean (no spam)

---

## 💡 Important Context

### Why CULT EXECS is Hardcoded
This is a **business rule**, not a technical limitation:
- CULT EXECS must always be the featured project
- It's the flagship ERC404 project
- Address: `0x185485bF2e26e0Da48149aee0A8032c8c2060Db2`
- Navigates to: `/cultexecs` (special route)
- Image: `/execs/695.jpeg` (token #695)

### The Trilemma (4 States)
The app must handle 4 different runtime environments:
1. **LOCAL_BLOCKCHAIN** - Dev + Anvil + deployed contracts
2. **PLACEHOLDER_MOCK** - Dev + no Anvil (current state)
3. **PRODUCTION_DEPLOYED** - Production + contracts deployed
4. **COMING_SOON** - Production + no contracts yet

EnvironmentDetector handles this automatically.

### Microact Patterns (Not React!)
- Children as **explicit props**, not h() arguments
- SVG works natively via `h('svg', ...)` as of **microact 0.2.4** (namespace + attribute casing fixed)
- Components **own their containers**
- Skeleton components are **functions, not classes** — call as `Skeleton()` not `h(Skeleton)`
- **No rounded corners** in Gallery Brutalism

### New Services (Session 2-3)
- **ProviderManager** (`src/services/ProviderManager.js`) — wallet detection, network switching, public RPC fallback with rotation
- **ActivityIndexer** (`src/services/ActivityIndexer.js`) — indexes on-chain events for activity feed
- **Debug utility** (`src/utils/debug.js`) — single DEBUG_MODE toggle for all timing/debug logs
- **DataAdapter updated** — queries FeaturedQueueManager on-chain, checks queue length before index queries, falls back to hardcoded CULT EXECS

---

## 🚀 How to Resume

1. **If you're fixing deployment:**
   - Read "Unblocking Steps > Option A"
   - Update deploy scripts
   - Test with checklist
   - Then proceed to "Next Steps"

2. **If you're building pages:**
   - Wait for deployment fix
   - Use PLACEHOLDER_MOCK mode for now
   - Build with demo files as reference
   - Follow Demo-Driven Development workflow

3. **If you're wiring micro-web3:**
   - Need LOCAL_BLOCKCHAIN mode working first
   - Replace getMockActivity() in DataAdapter
   - Index events from GlobalMessageRegistry
   - Show real-time activity

---

## 📞 Questions?

**Where is X?**
- Contracts: `contracts/src/`
- Frontend: `src/`
- Demos: `docs/examples/`
- Lessons: `docs/HOMEPAGE_V2_LESSONS.md`

**Why isn't X working?**
- Check current mode: Look for `[EnvironmentDetector] Detected mode:` in console
- If mode is wrong: Check Anvil status, check contracts.local.json
- If data is wrong: Check DataAdapter for that mode

**How do I X?**
- See `docs/HOMEPAGE_V2_LESSONS.md` for patterns
- See demo files for exact HTML structure
- Follow Demo-Driven Development (CLAUDE.md Rule #4)

---

**Last Updated:** 2026-02-19
**Status:** Homepage COMPLETE ✅
**Microact Version:** 0.2.4 (SVG support fully working)
**Next Work:** Build remaining pages (Discovery, Activity, Portfolio, ProjectDetail, Governance) using Demo-Driven Development
