# Project Status — resume here

**As of 2026-06-24.** Single pickup point for the ms2.fun rebuild. The detailed interface map is
`contract-surface-coverage.md`; the methodology/plan is `attack-plan.md`. Everything below is on
**`main`**, gate-green (330 frontend tests; `forge build` clean).

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
