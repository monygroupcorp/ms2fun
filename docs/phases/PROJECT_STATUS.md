# Project Status — resume here

**As of 2026-06-24.** Single pickup point for the ms2.fun rebuild. The detailed interface map is
`contract-surface-coverage.md`; the methodology/plan is `attack-plan.md`. Everything below is on
**`main`**, gate-green (330 frontend tests; `forge build` clean).

---

## Headline
**The contract surface is essentially fully wired.** Every external-function interface a user/creator/
operator needs has an operational UI path — **except one blocked item (gating config)**. We pivoted
this session from "legacy-parity" to **contract-surface coverage** (the contracts are the source of
truth; `legacy/` was itself incomplete).

## Interface coverage (A–K) — see contract-surface-coverage.md for detail
| | Interface | Status |
|---|---|---|
| A | Discovery & home | ✅ |
| B | Launch / create | ✅ create · editions · queuePiece — **⛔ gating config blocked** (see below) |
| C | Per-type trading (ERC1155/721/404) | ✅ |
| D | Detail pages + NFT art/galleries | ✅ |
| E | Creator admin (per-instance, all 3 types) | ✅ |
| F | Portfolio (holdings) | ✅ |
| G | Vault & yield (incl. withdrawPrincipal) | ✅ |
| H | Featured-queue management | ✅ |
| I | Board (threaded replies + reactions) | ✅ |
| J | Profiles (set/read/clear + created-collections) | ✅ |
| K | Protocol admin console `/admin` (5 panels) | ✅ |

## The one blocked item
**B — gating config (`PasswordTierGatingModule.configureFor`).** Genuinely blocked, not lazy: the
FIRST config is **factory-only** (`isFactoryRegistered(msg.sender)`); only UPDATES are owner-callable,
and `createInstance` does NOT accept a `TierConfig`. So "set up password tiers" needs a **create-flow
(and likely contract) change** to thread the tier config through the factory at create time. Until then,
a gated-but-unconfigured instance is effectively open (tier 0, no cap). **Decision needed** — this is
the next real design call, not a UI slice.

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

## Not yet verified / open
- **Fork-verify Phase 2 + Phase 3 end-to-end** — they're on main + gate-green but not fully walked
  (portfolio holdings, featured rent/boost, the 5 admin panels operating as ADMIN). A fresh
  `pnpm chain:deploy` + walk is the next confidence step.
- **Real testnet deploy** — only the anvil mainnet-fork has been exercised. Testnet readiness (a real
  testnet, read-only provider, EXEC404 grandfathering) is a separate push.

## Backlog (non-blocking, with captured designs)
- **Gating-config** decision/build (the blocked B item — needs the create-flow change).
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
