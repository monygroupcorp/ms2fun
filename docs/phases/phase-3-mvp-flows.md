# Phase 3 — Full Feature Parity

**Status:** 🟠 Rebuilt 2026-06-23. The original "MVP happy-path" scope (below the fold in git
history) under-scoped this phase to a single vertical and led to ~⅔ of the legacy surface being
skipped. Decision (2026-06-23, Mony): **testnet ships at full legacy parity, including full admin.**
This doc is the corrected source of truth — scope cannot silently shrink to "the happy path" again.
**Depends on:** Phase 2 (typed domain model + Aave vault on fork)
**Exit gate owner:** Mony

> Parity bar: a creator can discover, launch, **trade/mint/bid across all three types**, manage
> their portfolio, claim yield, and the operator can run the platform from an in-app admin — all on
> the new typed architecture, beautiful, zero stubs, zero configured-but-unclaimable actions.

---

## Baseline & method
Parity is measured against **`legacy/`** (the quarantined microact ms2fun frontend — 24 routes, 22
contract adapters), established by two audits on 2026-06-23 (old-app inventory + current-wiring
audit). The gap list those audits produced is the task backlog below.

- **Keep + match:** the full legacy feature set wired to the live contracts.
- **Add (new direction):** Aave endowment vault model, ProfileRegistry, event-indexed discovery,
  typed wagmi/viem bindings, client-side media (`data:` URI).
- **Do NOT resurrect (dead/mock in legacy + memory):** EXEC voting, governance, DAO, safe,
  share-offering. EXEC404 stays a grandfathered read-only fossil.

## Honest status of what's already built
Genuinely contract-backed (no mocks), but only one vertical deep:
- ✅ ERC1155 end-to-end (create → editions → mint → vault harvest)
- ✅ Launch wizard (schema-driven `createInstance`, all 3 factories) — **create only**
- ✅ Profiles (ProfileRegistry get/set), messaging + `/board`, vault panel (read + harvest)
- ✅ Discovery **list-only** (featured set via `getHomePageData`), 4 UX fixes (wallet modal,
  profile setup, board, landing), local-chain tooling
- ❌ Everything in the workstreams below

---

## Workstreams

Each task notes its **legacy source** and the **contract surface** it must wire. Status:
`[ ]` todo · `[~]` partial · `[x]` done.

### W-A — Foundation (data + platform layer) — *do first; everything depends on it*
- [x] **A1** Generate the missing instance ABIs into the bindings: `ERC721AuctionInstance`,
  `ERC404BondingInstance`, `CurveParamsComputer` (wagmi.config + regen). *Blocks B3/B4.*
- [x] **A2** Event-indexed discovery layer — index `CreatorInstanceAdded` (+ factory/vault events)
  into an all-collections store; featured queue stays the fast-path. *Legacy: `ProjectIndex.js`,
  `ActivityIndexer.js`; `docs/plans/DATA_LAYER_ARCHITECTURE.md`. Contracts: MasterRegistry events,
  QueryAggregator `getProjectCardsBatch`.*
- [x] **A3** Persistence service (localStorage) — wizard drafts, favorites, last-wallet, read-only
  prefs, contract cache (TTL), index-mode. *Legacy: `FavoritesService`, `ProjectIndex`,
  `ContractCache`, `StorageSettings`.*
- [x] **A4** IPFS multi-gateway resolver — rotation (w3s/cloudflare/ipfs.io/pinata/dweb) + custom
  gateway override. *Legacy: `IpfsService.js`. Current `lib/metadata/resolveUri` is single-gateway.*

### W-B — Per-type collection experiences (the trading surface)
**Status: built + gate-green (TS 298 tests; `forge build` clean). NOT yet fork-verified (human gate).**
Branch `phase-3/wb-trading`. Lead-review caught + fixed a real gating-encoding bug (claimFreeMint)
and the B6 agent caught 5 runtime-revert traps in the seed brief by reading source.
- [x] **B1** `CollectionPage` per-type routing — branches by `card.contractType` into
  Erc1155/Erc721/Erc404 type components; ships the pure tested state machines `deriveAuctionState`
  + `derivePhase`/`canDeployLiquidity`.
- [x] **B2** ERC1155 completion — free-mint **claim**, `withdraw`, `claimVaultFees`, gating wired
  into `mint` + `claimFreeMint` (real `gatingData`, not 0), `updateEditionMetadata`, message mint.
- [x] **B3** ERC721 auctions — `createBid` / `settleAuction` / `reclaimUnsold` + multi-line active
  state UI + bid history (`BidPlaced` events) + countdown + config display.
- [x] **B4** ERC404 bonding — `buyBonding` / `sellBonding` + curve quote (`CurveParamsComputer.
  calculateCost/calculateRefund`) + phase detection (`bondingActive`/`bondingOpenTime`/`graduated`/
  `liquidityDeployer`) + tier/password gating (`gatingActive`/`gatingModule`/`gatingScope`) +
  free-mint (`claimFreeMint`) + reroll (first-class on the new contract: `rerollSelectedNfTs` +
  `getSkipNft`/`setSkipNft` + `RerollInitiated/Completed` events — drop legacy's
  `transferTokensToSelf` hack). *Legacy: `SwapInterface/` (gut the 1,137-LOC manual-setState/EventBus
  machinery — W-A already replaced it).*
- [x] **B5** ERC404 bonding chart — curve canvas + you-are-here dot **and candles** (fresh
  `BondingSale`-event → OHLC indexer); candles also serve the graduated/pool view.
- [x] **B7** ERC404 staking surface — `activateStaking`/`stake`/`unstake`/`claimStakingRewards`,
  position+rewards via the new `ERC404StakingModule` bindings; self-hides when inactive. Required
  adding the staking module to DeployCore (was never deployed). Staking position → W-D portfolio.
- [x] **B6** Full-state seed + staking deploy infra. ERC1155 editions + free-mint; ERC721 two
  auctions (settled/no-bid past + active-with/without-bid live); ERC404 preopen / mid-curve (3 buys
  + active staking) / ready-to-graduate (matured, graduate live). `deployLiquidity` left for live
  human graduation (hits an external AMM). `forge build` clean; **runtime-verify on the fork**.

### W-C — Discovery + home
- [ ] **C1** Discovery filters/sort/search over the A2 indexed layer — by type/ERC-standard/state/
  vault; sort recent/TVL/volume; pagination. *Legacy: `ProjectDiscovery.js`. (`CollectionsPage`
  today filters the featured set only.)*
- [ ] **C2** Home — featured banner + top-vaults stats bar + recent-activity feed + grid (EXEC404
  pinned). *Legacy: `HomePage.js`.*

### W-D — Portfolio + vault explorer + yield *(folds in the integrity fixes)*
- [ ] **D1** Portfolio page — `QueryAggregator.getPortfolioData`: ERC404 token+NFT holdings, ERC1155
  balances, vault/staking positions, total value + P&L, **claim yield / unstake**. *Legacy:
  `Portfolio.js`.*
- [ ] **D2** Vault explorer + detail — list vaults, benefactor contribution/shares, claimable,
  `claimFees`; **`withdrawPrincipal`** for the endowment (the VaultPanel labels principal
  "refundable" with no button — fix). *Legacy: `VaultExplorer.js`/`VaultDetail.js`.*

### W-E — Featured-queue management (monetization)
- [ ] **E1** Featured rental UI — view queue + per-position pricing, `rentFeatured` / `renew` /
  `cleanupExpired`. *Legacy: `FeaturedRental/`. (Today FeaturedQueueManager is read only indirectly,
  never written.)*

### W-F — Admin (full parity)
- [ ] **F1** Admin shell + factory mgmt (`registerFactory`/`deactivateFactory`/`getFactoryInfo`).
- [ ] **F2** Vault mgmt (`registerVault`/`deactivateVault`/`migrateVault`).
- [ ] **F3** Alignment targets + ambassadors (AlignmentRegistry CRUD — *zero UI today*).
- [ ] **F4** Component registry (`approveComponent`/`revokeComponent`).
- [ ] **F5** Treasury (balance/revenue/POL) + parameters panel + abdication status.
- [ ] **F6** Agent delegation (`MasterRegistry.isAgent/setAgent`; instance `setAgentDelegation`) —
  core to the "agents act for users" design; *absent today*.
  *Legacy: `AdminPage.js` (80 KB), `AdminDashboard/`, `AdminFunctionDiscovery.js`.*

### W-G — Platform affordances
- [ ] **G1** Wallet read-only mode + mode banner + multi-RPC. *Legacy: `ReadOnlyService`,
  `ModeBanner`.*
- [ ] **G2** Share / Send / Approval modals + tx options. *Legacy: `ShareModal/`, `SendModal/`.*
- [ ] **G3** Gating configuration UI in the wizard (password tiers / merkle allowlist) wired to
  create **and** mint — completes the config-apply seam stubbed in `useCreateSubmit`.
- [ ] **G4** Wizard draft persistence (A3) + media upload (`data:` URI + client-side downscale/
  compress with URL escape hatch).
- [ ] **G5** First-chain-sync heads-up (a "syncing to chain…" indicator on the initial
  all-collections event scan) + user storage levers (view / minimize / clear localStorage if it's
  throttling them). *Deferred (Mony 2026-06-23). Leaner, user-facing replacement for legacy
  `StorageSettings/` — NOT the FULL/MINIMAL/OFF index-mode (dropped).*

### W-H — Polish & parity sign-off
- [ ] **H1** Brutalist styling pass across all new surfaces.
- [ ] **H2** Parity checklist sign-off vs `legacy/` (this doc's task list all `[x]`).

---

## Sequence
1. **W-A** foundation (ABIs + indexer + storage + IPFS) — unblocks everything.
2. **W-B** + **W-C** in parallel once A1/A2 land (trading surface + discovery are the heart).
3. **W-D**, **W-E** (portfolio/vault/featured).
4. **W-F** admin.
5. **W-G** affordances (several parallelizable throughout).
6. **W-H** polish + parity sign-off → Phase 3 exit.

Each task ships as a fork-verified slice (the established agent-fanout + lead-integration +
fork-verify rhythm), branched and merged on Mony's call. Status tracked **here**, updated per slice.

## Exit criteria
1. Every task above is `[x]`, verified on the fork.
2. All three project types are end-to-end (discover → launch → trade/mint/bid → portfolio → yield).
3. Operator can run the platform from the in-app admin (no cast required for routine ops).
4. Zero configured-but-unclaimable actions; zero mocks.
5. Definition-of-Done gates green; full happy-path `/run` per type recorded.
6. Every surface matches the Gallery Brutalism intent.

## Decision log
- **2026-06-23** — Rebuilt this phase to full legacy parity + full admin (Mony), after the gap
  audits. Original happy-path scope retired as the cause of the skip.
- **2026-06-23** — W-A design reviewed vs legacy + approved (Mony). DROP: `ContractCache` (React
  Query is the cache), FULL/MINIMAL/OFF index-mode, IndexedDB two-phase index→hydrate, ~9 stale
  localStorage keys. BUILD: lean `useAllCollections` (event scan − creator filter → batch read),
  typed `storage<T>()` (~4–5 keys), race-first IPFS. In-memory single-shot scan now; chunked +
  incremental-persist seam left for testnet scale.

## Decision log (cont.)
- **2026-06-23** — W-B design reviewed vs `legacy/` + bindings verified against the real contracts
  (legacy JS adapters describe an older surface). DROP wholesale: `SwapInterface` setState/EventBus
  machinery, the 54-KB ERC404 adapter's dead methods, `candleAggregator`/`tradeEventCache` (never
  imported in legacy), `transferTokensToSelf` reroll hack, hardcoded vault-split (`80/20`,`19%`) +
  slippage literals (read `bondingFeeBps`/`pendingVaultCut`; slippage = user control). KEEP the
  legacy ERC721 *idea*: explicit state machine from contract reads — reborn as pure tested helpers
  (`deriveAuctionState`, `derivePhase`). Per-type page = branch on `card.contractType`. Decisions:
  **B5 = curve + candles** (fresh OHLC indexer); **staking IN** (new B7, beyond parity).

## Open questions
- A2 indexer: pure client-side event scan (fork-fast, may not scale on a busy testnet) vs a light
  indexed cache — decide at A2.
