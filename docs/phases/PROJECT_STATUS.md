# Project Status — resume here

**Reconciled to git-truth 2026-07-08** — see PR #22 (`4217ac7`) and the `alignment-target-requests`
merge (`8e6e3f2`): the full write-path fork-verify (portfolio/featured/admin) and the target-requests
feature are both landed on `main`, not pending as prior revisions of this doc said.

**As of 2026-06-30.** Single pickup point for the ms2.fun rebuild. The detailed interface map is
`contract-surface-coverage.md`; the methodology/plan is `attack-plan.md`. Everything below is on
**`main`**, gate-green (371 frontend tests; `forge build` clean; 1162 forge tests green; 15 e2e).
**Security audit closed out + metadata resolver stack shipped to `main` — 2026-06-30 (see below).**

**► RESUME HERE:** the metadata resolver stack, **vault flavors**, the **full end-to-end fork-verify**
(portfolio/featured/admin write paths, PR #22 `4217ac7`), and **alignment target requests**
(`8e6e3f2`) are all done and on `main`. Remaining pre-testnet track: the **holistic design/style
pass**. After that, the real **testnet deploy** (Phase 4).

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

## ✅ SHIPPED — metadata resolver modules (2026-06-30)
**Done and on `main`** (feature `50ad78a` + fork-walk/e2e `cf1ac0c`). The composable
metadata-resolution stack for ERC404, behind one generalized defensive `_tokenURI` seam. Designs
(source-verified) in **[ADR-0006](../decisions/0006-metadata-overlay-module.md)** (overlay/
augmentation) + **[ADR-0007](../decisions/0007-tiered-metadata-and-resolver-composition.md)** (tier
reveal + the `IMetadataResolver`/router composition). What landed:
- **Seam** — `ERC404BondingInstance` generic `mapping(bytes32=>address) modules` slot + factory-only
  set-once `initModule` (NO owner setter — mechanism sealed at construction, only module *content* is
  mutable), public `ownerOf`, and a defensive `_tokenURI` try/catch branch (uses `_ownerAt`, never bricks
  tokenURI on a misbehaving module).
- **Modules** — `MetadataResolverRouter` (ordered, first-non-empty, sealed at create under
  `isFactoryRegistered` auth), `MetadataOverlayModule` (per-id commissions + cohort event waves,
  holder-selectable version pointer, ARTIST/SPLIT payout via `RevenueSplitLib`), `TierRevealModule`
  (id-range reveal on effective holdings `balanceOf + staked`, config FROZEN at construction).
- **Create flow** — `ERC404Factory` gated overload threads resolver→[overlay,tier] + tier table + overlay
  policy into ONE create tx; `FeatureUtils` RESOLVER/OVERLAY/TIER tags; `DeployCore` deploys+approves the
  3 **real** modules with wizard metadata; `SeedAnvil` seeds a stacked collection (+ `rentFeatured`);
  `ValidateSepolia` asserts approval; `deploy.ts` surfaces the addresses into app config.
- **Frontend** — wizard `metadata-overlay`/`metadata-tier` `configType`s + resolver/overlay/tier slots +
  `metadataConfig` encoder/validator + submit threading + regenerated wagmi bindings.
- **Verified** — forge metadata suites 77 green (1162 total); frontend 371; **fork-walk**
  `app/e2e/metadata.spec.ts` green: create a stacked collection via the real wizard, then assert on-chain
  via viem that resolver→[overlay,tier] is sealed in precedence order, tier reveal flips with balance
  (`locked-`→`rare-1`), and overlay-over-base holds (commission unlock → `commission-3`, BASE pin → base).
  Integration facts pinned: prefix-regex wizard labels; `tokenURI` on the DN404 **mirror**
  (`mirrorERC721()`), not the base; preset-1 `unit = 1e24`.

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

## ✅ SHIPPED — vault flavors (pre-testnet task) — see `vault-flavors.md`
**Scoped + implemented + fork-verified 2026-07-01. All exit criteria met.** Promoted the LP vaults to
**first-class** alongside the Aave endowment, expressed in the wizard as **family → venue**, grouped off
on-chain `vaultType()`. Landed (gate-green: forge **1168** + a fork-gated graduation test, frontend
**380**, e2e **16** — incl. the new `vault-flavors.spec.ts` picker fork-walk; deploy+seed fork-walked
with on-chain vaultType/readiness verified):
- **Contracts (T1/T2):** `isLiquidityReady()` on all 4 vaults (O2 signal); **filled the ZAMM init-only
  pool-key gap** (`setPoolKey` + onlyOwner factory proxy, factory now `Ownable`); `DeployCore` per-target
  LP wiring (Uni `setVaultPoolKey`, ZAMM key baked at deploy) + `zammFeeOrHook`; `DeployAnvil` deploys
  ZAMM (real singleton) **and Cypher (real Algebra Integral, live on mainnet)** → **4 families × 2
  targets = 8 vaults, all correct `vaultType()` + `isLiquidityReady()=true` on the fork** (exit #1 met);
  `ValidateSepolia._checkVaults()` asserts registered + type + readiness; SeedAnvil now resolves vaults
  by family (`SeedUniVault`/`SeedAaveVault`), not fragile array index.
- **Wizard (T3/T4):** `useRegisteredVaults` reads `vaultType()`/`isLiquidityReady()`; new
  `lib/wizard/vaultFlavor.ts` derives family/venue; `WizardPage` is a family→venue picker (un-ready LP
  venues disabled); `submit.ts` unchanged.
- **Docs (T6):** ADR-0008 (two families) + ADR-0003 amend + un-retired banners; no current "retire LP"
  guidance remains.
- **Cypher:** Algebra Integral is live on mainnet (real addresses from camel404, verified on the fork) —
  `deployCypherVault=true`, registers + type-checks alongside the others.
- **Exit #2 (live Uni graduation) DONE + a real bug fixed:** `test/fork/VaultUniGraduationFork.t.sol`
  creates a **live V4 LP position** on the real mainnet PoolManager via the real zRouter. The walk caught
  a **mainnet-blocking bug** — `UniAlignmentVault.receive()` was unconditionally `nonReentrant`, so
  zRouter's swap-dust refund (and PoolManager native-ETH settlement) reverted mid-`convertAndAddLiquidity`
  and bricked every real conversion. Fixed to silently accept ETH while the guard is held (mirrors ZAMM);
  regression `test_ConvertAndAddLiquidity_acceptsZRouterDustRefund` verified to fail pre-fix.

## Not yet verified / open
- ~~Fork-verify Phase 2 + Phase 3 end-to-end~~ — **DONE (2026-07-08, PR #22 `4217ac7`).** Portfolio
  holdings, featured rent/boost/renew/prune, and all 5 admin panels are now walked as the real
  ADMIN/holder through the actual UI (`app/e2e/portfolio.spec.ts`, `app/e2e/featured.spec.ts`,
  `app/e2e/admin-panels.spec.ts`), on top of the earlier gating-config and metadata-stack walks
  (`app/e2e/gating.spec.ts`, `app/e2e/metadata.spec.ts`). The injected-wallet E2E harness
  (`app/e2e/fixtures/anvilWallet.ts` + the `@fork` pattern) remains the template for any further
  write-path walks.
- **Real testnet deploy** — only the anvil mainnet-fork has been exercised. With the metadata stack
  and the full write-path fork-verify both shipped, **no feature work now blocks testnet** — the
  remaining gate is the Phase-4 design pass. Testnet readiness (a real testnet, read-only provider,
  EXEC404 grandfathering) is a separate push.

## Backlog (non-blocking, with captured designs)
- **Admin pool-liquidity scout** — `contracts/script/ScanAlignmentPools.s.sol` (built, fork-proven):
  per-alignment-token, ranks ETH/token pools across venues + recommends the deepest V4 pool key to wire
  (resolves vault-flavors O3 by measurement). Uncommitted in the working tree.
- **Request an alignment target** — **DONE, merged to `main` (`8e6e3f2`)**
  (`docs/phases/alignment-target-requests.md`, ADR-0009): standalone `AlignmentTargetRequestRegistry`
  (refundable deposit, two-tx admin approve) + admin review panel + public `/request-target` form.
  Gate-green: forge 1185, frontend 398, e2e 17 (incl. the submit→approve fork-walk). Pairs with the
  scout (scout script itself remains uncommitted, see above).
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
