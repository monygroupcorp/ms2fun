# Project Status — resume here

**As of 2026-06-30.** Single pickup point for the ms2.fun rebuild. The detailed interface map is
`contract-surface-coverage.md`; the methodology/plan is `attack-plan.md`. Everything below is on
**`main`**, gate-green (347 frontend tests; `forge build` clean; 1162 forge tests green).
**Security audit closed out 2026-06-30 — see the audit section below.**

---

## Headline
**The contract surface is fully wired.** Every external-function interface a user/creator/operator
needs has an operational UI path — **including gating config, now unblocked** (see below). We pivoted
this session from "legacy-parity" to **contract-surface coverage** (the contracts are the source of
truth; `legacy/` was itself incomplete).

## Interface coverage (A–K) — see contract-surface-coverage.md for detail
| | Interface | Status |
|---|---|---|
| A | Discovery & home | ✅ |
| B | Launch / create | ✅ create · editions · queuePiece · **gating config (during + after create)** |
| C | Per-type trading (ERC1155/721/404) | ✅ |
| D | Detail pages + NFT art/galleries | ✅ |
| E | Creator admin (per-instance, all 3 types) | ✅ |
| F | Portfolio (holdings) | ✅ |
| G | Vault & yield (incl. withdrawPrincipal) | ✅ |
| H | Featured-queue management | ✅ |
| I | Board (threaded replies + reactions) | ✅ |
| J | Profiles (set/read/clear + created-collections) | ✅ |
| K | Protocol admin console `/admin` (5 panels) | ✅ |

## B gating config — RESOLVED (2026-06-25)
Was blocked because the FIRST `configureFor` was **factory-only** and `createInstance` didn't accept a
`TierConfig`. Decision: support config **during AND after** create (max flexibility), ERC404 + ERC1155.
Shipped:
- **Contract:** new `IPasswordTierGatingModule.sol` hoists `TierConfig`/`TierType` (shared type).
  `configureFor` first-config relaxed to **factory OR instance owner** (updates still owner-only).
  Both factories gained a **gated `createInstance` overload** (legacy signatures preserved → zero
  caller churn) that forwards the config to the module in the SAME create tx. Empty config = open.
- **Frontend:** `lib/wizard/gatingConfig.ts` encoder (keccak passwords, length-matched arrays);
  wizard renders the password-tier `SchemaForm` and threads config into the single create tx;
  `ConfigureGatingRow` on the ERC1155 + ERC404 creator-admin panels for owner-authored
  add/update post-create (calls `configureFor` directly on the module).
- **Gate:** forge build clean; frontend 347 tests + lint + build green.
- **Fork-walked ✅ (2026-06-25):** new `app/e2e/gating.spec.ts` drives the real wizard with an
  injected auto-signing anvil wallet — creates a gated collection with a tier in ONE tx, then edits
  tiers from creator admin, asserting on-chain via viem. The walk caught + fixed THREE real bugs the
  unit tests missed: (1) deploy approved a *mock* password-gating module (no `configureFor`) while the
  real module lacked the wizard metadata → now the real module carries it, mock dropped
  (`DeployCore.sol`); (2) `SchemaForm` list fields counted only non-empty rows, so added rows never
  rendered → tracked by explicit count; (3) defaulted selects weren't committed to form state, so
  `visibleWhen` dependents stayed hidden → `collectDefaults` seeds them. The injected-wallet fixture
  (`app/e2e/fixtures/anvilWallet.ts`) is reusable for ALL future write-path walks.

---

## How the build is structured (for adding more)
**Phase-0 primitives** (`app/src/components/ui/`) are the multiplier — compose them, don't re-roll:
- `useTxAction` + `<TxButton>` — the write idiom (sign/confirm/success/error + once-only onSuccess).
- `useOwnerGate(addr)` — `owner()` read → `isOwner` (creator/protocol-admin gating).
- `<AdminSection>` / `<ActionRow>` — admin panel layout.
- `<AmountField>` + `parseAmount` — numeric inputs.
- **`docs/contract-facts.md`** — the crib sheet (signatures, access, gotchas). Agents MUST read it.

**Agent rhythm:** fan out worktree agents (each owns disjoint files, cites contract-facts) → lead
merges + **adversarially reviews integration points** + gates → fork-verify. The review repeatedly
caught real bugs (gating-encoding, multicall3, per-second refetch, board-channel) — keep doing it.

## Verifying UI ↔ contract coverage (write-path E2E)
**`docs/testing-write-path-e2e.md`** — headless Playwright walks that drive the real app against the
fork with an injected auto-signing wallet, asserting on-chain via viem. This is the tool for proving
(not assuming) that every contract function has a working UI path. Template: `app/e2e/gating.spec.ts`.

## Dev loop & fork facts
- `pnpm chain:fork` (start anvil mainnet-fork) → `pnpm chain:deploy` (deploy + seed + advance +
  registry handover + writes `app/src/config/local-deployment.json`).
- **Testing wallet = `0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86` (ADMIN).** The seed transfers every
  instance to it (creator admin), funds it 50 ETH, seeds it an ERC404 holding (portfolio), and
  deploy.ts hands it the registries via the 2-step handover (so `/admin` works as ADMIN). Connect with
  it to see the ADMIN nav + owner-only panels.
- Gotchas (all in `contract-facts.md` / `[[dev-fork-seed]]`): the fork chain MUST declare
  `multicall3` (else `client.multicall` throws); `vm.warp` is a no-op under `--broadcast` (advance the
  chain in deploy.ts instead); UI time is chain-anchored (`lib/time/useChainNow`); re-deploy is
  collision-safe (saltNonce); `local-deployment.json` is `skip-worktree` (committed copy is a
  zero-address placeholder — to change tracked contents, `--no-skip-worktree`, edit, commit, re-skip).

---

## ► NEXT PHASE — the design / style pass (Phase 4)
**Not yet done, and it fell through the reframe.** Every surface this session was built to Gallery
Brutalism *in isolation* (per-agent), but there has been **no holistic visual review** across them all.
This is the retired plan's W-H1 ("Brutalist styling pass across all new surfaces"), which never carried
into the contract-surface reframe — so it's an unscheduled gap, NOT optional polish. Scope:
- Cohesion sweep across ALL new surfaces — collection pages (3 types), trading panels (swap/bid/mint),
  bonding chart, edition/token detail, NFT galleries, portfolio, board threading, the 5 admin panels,
  featured panel, wallet/nav. Do they feel like ONE app?
- Rubric = `docs/DESIGN_SYSTEM_V2.md` (pure monochrome, 8px grid, no gradients/shadows/radius>2px;
  chromatic aberration ONLY on large display text + primary CTAs — check for over/under-use), type
  hierarchy, spacing, mono-label consistency, empty/loading/error states, responsive behavior.
- Benefits from Mony's eye (visual judgment). Likely a fan-out: review surfaces → list inconsistencies
  → fix → sign-off.
- **Distinct from the "style renderer" backlog item** (creator-supplied per-page `styleUri` CSS).

## ► GREENLIT — metadata resolver modules (BEFORE testnet)
**Greenlit 2026-06-25 (Mony). Must be live before the testnet deploy.** Two stacking ERC404 metadata
modules behind one generalized, defensive `_tokenURI` seam. Full designs (source-verified) in
**[ADR-0006](../decisions/0006-metadata-overlay-module.md)** (overlay/augmentation) +
**[ADR-0007](../decisions/0007-tiered-metadata-and-resolver-composition.md)** (tier reveal + the
`IMetadataResolver`/router composition). Build order:

1. **Seam (immutable impl, once) — `ERC404BondingInstance`:** add a **generic** `mapping(bytes32 => address)
   public modules` (ONE keyed slot for all known + future module pointers — no per-category slot overfit;
   decided 2026-06-26) + `initModule(bytes32 role, address)` **factory-only, set-once — NO owner setter**
   (mechanism sealed at construction; only module *content* is mutable, and it lives in the modules). The
   resolver lives at `modules[METADATA_RESOLVER]`, registry-validated by the factory at create. Add the
   **defensive** `_tokenURI` branch (the ONLY new call-site;
   `try/catch`, uses `_ownerAt(id)` NOT `_ownerOf` — preserves no-revert-on-unminted) + public
   `ownerOf(id) → _ownerOf(id)` (module write-auth). **No speculative hooks** — new call-sites later are an
   accepted impl/factory upgrade. Existing `gating/staking/liquidity` slots stay as-is (not retrofitted).
   (STAKERS payout / `fundStakers` DROPPED 2026-06-26 to keep the seam feature-free; re-add later as a general primitive.)
   Not yet deployed, so this is a clean impl bump — but it IS a **new implementation + factory version**
   (already-live EXEC404 won't get the seam; fine, fossil). Cut it alongside any other pre-testnet
   factory/impl change so it's one new version, not two.
2. **`IMetadataResolver`** (`resolve(instance,id,holder)→string`) + **`MetadataResolverRouter`** (ordered
   per-instance resolvers, **sealed at construction set-once, auth `masterRegistry.isFactoryRegistered`**
   — NOT a hardcoded factory; survives upgrades + blocks seal-front-run on deterministic CREATE3 addrs),
   defensive, first-non-empty). ComponentRegistry tag `resolver`.
   **Create-flow orchestration (H7):** the new factory version wires, in ONE create tx — `instance.initModule
   (METADATA_RESOLVER, router)` + `router.initResolvers(inst, [overlay,tier])` + `tier.initTiers(inst, …)`
   + overlay create-config — via a new create-params struct (tier URIs make the payload large). Ordering:
   register instance, then module seals under `isFactoryRegistered` auth.
3. **`MetadataOverlayModule`** (ADR-0006): commission + event-wave state, version-pointer selection
   (AUTO/BASE/COMMISSION/wave#), `unlock`/`select` (sets selection on pay), Payout routing — **module-side
   only**: ARTIST direct · SPLIT via `RevenueSplitLib` + vault `receiveContribution` (STAKERS deferred).
   **Content mutable-forever / additive** (safe: serves over an indestructible holder-selectable base).
   ComponentRegistry tag `overlay`.
4. **`TierRevealModule`** (ADR-0007): id-range tiers, reveal when **effective holdings**
   (`balanceOf + stakingModule.stakedBalance`) ≥ threshold. **Config FROZEN at construction** (`initTiers`
   factory-only, set-once — mutable rarity = rug; frozen rules, dynamic reveal). ComponentRegistry tag `tier`.
5. **Wizard/UI** (per ADR-0005): overlay `configType` `metadata-overlay` (create-time policy + post-create
   ops for waves/commissions); tier `configType` `metadata-tier` — **full tier table is create-time only,
   sealed** (no post-create tier authoring). Creator-admin: publish wave / set commission (overlay, ongoing);
   holder pin/unlock control (tier reveal is automatic). Router order chosen at create, frozen.
6. **Deploy + seed integration** (the feature isn't done until it deploys + seeds like every other module):
   - **`FeatureUtils.sol`** — add tag constants `RESOLVER` / `OVERLAY` / `TIER` (or `bytes32("…")` inline,
     as `curve_computer` does).
   - **`script/DeployCore.sol`** (Phase 7/7b region, ~L345–425) — deploy the 3 **real** modules
     (`MetadataResolverRouter`, `MetadataOverlayModule`, `TierRevealModule`, each `new …(masterRegistry)`),
     `approveComponent` each under its tag, and **set real wizard metadata** (`data:application/json` with
     `configType`) on overlay + tier directly — **NOT MockComponentModule stubs.** Lesson from the gating
     fork-walk (`[[parity-program]]`): a mock approved in place of the real module (missing `configureFor`)
     shipped a latent bug; these modules have real `initResolvers`/`initTiers`/`initModule` wiring, so the
     approved component MUST be the functional contract. Mirror `passwordTierGatingModule` exactly.
   - **New ERC404 factory+implementation version** wired in DeployCore (the seam bump from step 1); confirm
     `ValidateSepolia`/equivalent asserts the 3 modules approved.
   - **`script/SeedAnvil.s.sol`** — create one ERC404 collection wired with the full stack
     (resolver→`[overlay,tier]`, tiers seeded, one overlay wave + one paid commission published), owned by
     the dev wallet `0x54Ef…`, and **`rentFeatured`** it so it lands in discovery (`[[dev-fork-seed]]`:
     discovery = featured queue). This is what the fork-walk drives.
   - **`app/scripts/dev-chain/deploy.ts` + `local-deployment.json`** — surface the 3 new module addresses
     into app config so the wizard lists them (live `getApprovedComponentsByTag`).
7. **Tests + gate:**
   - **Forge unit** — one suite per contract under `test/factories/erc404/` + `test/metadata/` (pattern:
     `ERC404StakingModule.t.sol`, `ComponentRegistry.t.sol`): resolve precedence, auto-latest **for
     open/NONE waves too — not staked-gated**, pin, **BASE-falls-through-to-tier**, sellable-unlock-on-
     transfer, effective-holdings reveal, **staking↔rarity** interaction, **commission-locks-on-pay**,
     **unlock reentrancy/CEI**, **seal-front-run blocked** (`isFactoryRegistered` auth), defensive
     `try/catch` → base on a reverting module.
   - **Frontend unit** — `metadata-overlay` + `metadata-tier` `configType` `SchemaForm`s (per ADR-0005),
     holder pin/unlock control, creator publish-wave/commission panel.
   - **Fork-walk ✅ (2026-06-30)** — `app/e2e/metadata.spec.ts` drives the REAL stepped wizard with the
     injected wallet (`app/e2e/fixtures/anvilWallet.ts`) to create a stacked ERC404 in ONE create tx, then
     asserts on-chain via viem: resolver→[overlay,tier] sealed in precedence order + tier table sealed;
     tier reveal FLIPS WITH BALANCE (buy 1 unit → `tokenURI(1)=="locked-"`; buy a 2nd → `"rare-1"`);
     overlay-over-base (PAY commission on id 3 unlocks → `"commission-3"`, holder BASE pin → base `"3"`).
     Three integration facts the walk pinned down: the reskinned wizard needs prefix-regex labels
     (asterisk in label text); `tokenURI` is served by the DN404 **mirror** (`mirrorERC721()`), not the
     base; preset-1 `unit = 1e24`. Passes on `pnpm chain:fork` + `pnpm chain:deploy` → `pnpm test:e2e`.
   - **Green bar ✅:** `forge build` clean · `forge test` 1162 green (metadata suites 77) · frontend 371
     tests + lint green · the new fork-walk green.

## ► Security audit — CLOSED OUT (2026-06-30)
Full `sc-auditor` (Map-Hunt-Attack) pass over `contracts/src`. Report: `.sc-auditor-work/REPORT.md`;
PoCs in `.sc-auditor-work/pocs/` (a PoC that PASSES = the attack succeeds). Every fix shipped with a
regression test **verified to fail under the pre-fix code**. All on **`main`** (FF'd from
`feat/metadata-resolver-modules`), `forge test` green (1162). Verify: `forge test --match-path "test/security/*"`.

| # | Severity | Status |
|---|---|---|
| **F1** | CRITICAL | FIXED — Uni `_payCallerReward` tx.gasprice drain removed wholesale (`2724079`) |
| **F2** | HIGH | FIXED — ERC721 settle-brick: `_mint` + try/catch + pendingVaultCut (`2724079`) |
| **F3** | HIGH | **RISK-ACCEPTED** by owner — free-mint = dilutive-by-design, bounded by allocation+allowlist. Follow-up #40 below. |
| **F4** | HIGH | FIXED — Uni watermark dilution → MasterChef `accFeesPerShare`/rewardDebt (`2724079`) |
| **F5** | HIGH | FIXED — ZAMM oracle floor wired through init/factory/DeployCore (`2724079`) |
| **F6** | MED | FIXED — CREATE3 sender-bound salt across all factories (`2724079`) |
| **F7** | MED | FIXED — Uni convert minOut oracle floor `_floorTokenOut` (`2724079`) |

**#36 lower-severity triage** (4 parallel auditor lanes; nothing REAL-EXPLOITABLE):
- **Tier-1** FIXED (`870f7dc`): Cypher harvest oracle floor; `claimAllFees` Aave-vault try/catch + `nonReentrant`; `sellBonding` cap `>=`→`>`; real `withdrawDust`.
- **Tier-2** (design-level) all FIXED:
  - ZAMM IL-as-fees mislabel → constant-product invariant fee detection (`f11f5dd`)
  - V4-hook router-stranding/misattribution → credit a fixed benefactor, not swap `sender` (`91fbd3d`)
  - Aave shared-position first-mover bank-run → pro-rata loss socialization on impairment (`f146a7c`)
- **Tier-3** LOW/NOT-A-BUG: no action (trusted-token returns, owner-keyed V4 salt, etc. — see REPORT §6).

**D1 (#37)** — least-privilege hardening: config/seal modules now use factory-**of**-instance auth
(`getInstanceInfo(inst).factory == msg.sender`). Gating-module portion committed (`4da4b66`); the 3
metadata modules (TierReveal/ResolverRouter/Overlay) are hardened in-place and land with the metadata feature.

**#40 (F3 follow-up)** — bonding fee moved to **exit-only** (`c57ce30`): buys are fee-free; `sellBonding`
skims `bondingFeeBps` → treasury; graduation 1/19/80 split unchanged. Monetizes curve exits incl. free-mint
redemptions without taxing entrants.

Tracking detail + the stash-pop/hunk-staging gotchas live in the `audit-status` memory.

## Not yet verified / open
- **Fork-verify Phase 2 + Phase 3 end-to-end** — on main + gate-green but not fully walked (portfolio
  holdings, featured rent/boost, the 5 admin panels operating as ADMIN). The **gating-config flow is
  now walked** (see B above). The new injected-wallet E2E harness (`app/e2e/fixtures/anvilWallet.ts` +
  the `@fork` pattern in `gating.spec.ts`) is the template to walk these remaining write paths
  headlessly — `pnpm chain:fork` + `pnpm chain:deploy`, then `pnpm test:e2e`.
- **Real testnet deploy** — only the anvil mainnet-fork has been exercised. Testnet readiness (a real
  testnet, read-only provider, EXEC404 grandfathering) is a separate push.

## Backlog (non-blocking, with captured designs)
- **Style renderer** — `styleUri` is write-only today; a scoped-CSS renderer for collection + edition
  pages. Nomenclature locked (content URI vs style URI); edition style → content-JSON `styleURI` field.
  Design captured in `[[improvements-backlog]]`.
- **Per-owner NFT gallery scan** — portfolio shows ERC404 NFT *counts* + a link, not the owner's tokens
  (the mirror scan isn't cheaply owner-filterable).
- Minor: profile `clearProfile` is in; treasury ERC20 amount is raw base-units (decimals unknown).

## Key entry points
- Routes: `app/src/App.tsx` (nav + routes incl. `/portfolio`, `/admin`, `/collection/:instance`,
  `/collection/:instance/{edition,token}/:id`).
- Admin: `app/src/routes/AdminPage.tsx` + `app/src/components/admin/*`.
- Per-type collection: `app/src/components/collection/{erc1155,erc721,erc404,types}/`.
- Seed/deploy: `contracts/script/SeedAnvil.s.sol`, `app/scripts/dev-chain/deploy.ts`.
