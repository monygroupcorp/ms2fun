# Task — Request an Alignment Target (user proposes → admin reviews → approves)

**Status:** **DONE — merged to `main` (`8e6e3f2`, 2026-07-01).** T1 (contract) + T2 (deploy wiring) +
T3 (admin UI) + T4 (requester UI) + T5 (17 forge tests + e2e fork-walk) + T6 (ADR-0009) all shipped and
fork-verified. Architecture decisions locked (O1–O4). Full forge suite 1185 green.
**Surfaced by:** the vault-flavors pool-scout work — targets are admin-curated, so a user/creator has
no path to propose one (e.g. "please add CULT"). Pairs with `ScanAlignmentPools.s.sol` (the admin runs
the scout on a requested token before approving + wiring).
**Exit gate owner:** Mony (human acceptance)

> Today `AlignmentRegistryV1.registerAlignmentTarget(...)` is **`onlyOwner`** (Safe/Timelock) with no
> intake — a creator who wants to align to a community that isn't listed is stuck. This adds a
> **request → review → approve** front door without changing how an approved target gets economic
> effect (still the single `registerAlignmentTarget` choke point).

---

## Goal
Give any user/creator a way to **propose a new alignment target** (a community + its token) and track
its status, while keeping **approval strictly admin-gated**. A request captures enough for the admin to
run the pool scout and decide the vault wiring, so the pipeline is: **request → admin runs
`ScanAlignmentPools` → admin approves + registers the target (+ wires vaults + pool keys) → the
requester can now align to it.**

## Current state (facts that shape this — see the curation brief)
- `AlignmentRegistryV1` is `SafeOwnableUUPS` (Safe via 24h Timelock). **Every** mutator is `onlyOwner`;
  there is no reviewer/curator role and **no request/pending/approve pattern anywhere in `src/`** — this
  is greenfield.
- `registerAlignmentTarget(title, description, metadataURI, AlignmentAsset[] assets)` is a normal
  runtime `onlyOwner` fn (no deploy-only guard) → **the owner can register new targets on the live
  deployment at any time.** Requires a non-empty title and **≥1 asset** (`NoAssets` revert; the current
  admin UI copy wrongly implies empty assets are allowed — fix if reused).
- `AlignmentTarget { id, title, description, metadataURI, approvedAt, active }` — `approvedAt` is
  approval-flavored but carries **no pending lifecycle** today; `approvedAt == 0` is the load-bearing
  "not found" sentinel across all guards. Adding fields = a UUPS upgrade (Timelock-delayed).
- **Choke point:** `MasterRegistryV1.registerVault` rejects unless the target `isAlignmentTargetActive`
  AND `isTokenInTarget(token)`. So a target only has effect once the owner registers it active with the
  token — that stays the trust anchor; the request layer sits *in front* of it.
- **No public "browse targets" view exists** — the app surfaces targets only *indirectly via vaults*
  (`useRegisteredVaults` carries `targetId`). A requests/targets directory would be new UI.
- Ready-made templates: **`FeaturedQueueManager`** (pay-ETH-to-enter-a-bounded-set: `msg.value >= due`,
  forward-to-treasury, refund-excess via `SmartTransferLib`, bounded list + lazy prune, `nonReentrant`,
  `onlyOwner` config) for anti-spam deposits; **`ProfileRegistry`** (ownerless self-service, each write
  touches only `msg.sender`'s entry) for self-custodied submissions; **`AlignmentPanel` +
  `useOwnerGate`/`useTxAction`/`AdminSection`/`TxButton`** for the admin review/approve UI.

## Scope
**In:**
- A **request intake**: anyone submits {token address, proposed title/description/metadataURI, proposed
  asset(s), optional note} → an on-chain pending record.
- **Anti-spam** on intake (see O2).
- An **admin review/approve/reject** surface (extends `AlignmentPanel`): list pending requests, run the
  scout out-of-band, then approve (→ `registerAlignmentTarget` with the request's data) or reject.
- **Status tracking** for the requester (Pending / Approved / Rejected) + deposit handling.
- A lightweight **"request a target" form** in the app + a **pending-requests list** in `/admin`.

**Out (deferred):**
- A full public **targets directory** / browse-all-targets view (doesn't exist today) — optional, O4.
- Auto-wiring vaults/pool keys on approval — approval registers the *target*; vault+pool-key wiring
  stays the separate admin/deploy runbook step (uses `ScanAlignmentPools`). Not folded in here.
- Any ambassador/role delegation of approval — approval stays single-owner in v1.
- Granting the request contract an on-chain registrar role on the registry — see O3 (v2).

## Design decisions
**Locked:**
- **D1 — Permissionless request, admin-only approve.** Anyone can submit (deposit-gated, O2); only the
  registry owner (Safe/Timelock) approves + registers. Matches the all-`onlyOwner` curation model and
  keeps the scout an admin tool.
- **D2 — On-chain-anchored requests.** Requests live on-chain (fits the lean onchain-only-static ethos),
  not an off-chain DB. Reads are event-indexed like the rest of the app.
- **D3 — Approval finalizes through the existing choke point.** Approval results in the owner calling
  `AlignmentRegistryV1.registerAlignmentTarget` — how a target gets economic effect is unchanged; the
  request layer never bypasses it.
- **D4 — A request captures the token address + proposed target metadata + ≥1 asset**, so the admin can
  run `ScanAlignmentPools <token>` and register with exactly the proposed data. (Honor the on-chain
  `≥1 asset` rule at submit time.)

**Locked (resolved 2026-07-01):**
- **D5 (was O1) — Standalone `AlignmentTargetRequestRegistry`.** A new contract mirroring
  `FeaturedQueueManager` holds pending requests + deposit logic; approval marks the request and the admin
  registers on `AlignmentRegistryV1`. **No change to the Safe/Timelock-owned core registry.** A request
  MAY also emit a `GlobalMessageRegistry` post for the social feed (nice-to-have, not the record of truth).
- **D6 (was O2) — Refundable ETH deposit.** Deposit at submit: **refunded on approve**, **forfeited to
  treasury on spam-reject**, plus a plain **reject-and-refund** for good-faith-but-declined requests.
  Deposit size + bounds are `onlyOwner` knobs. Bounded pending list + lazy prune as a second line.
- **D7 (was O3) — Two admin txs in v1.** `approveRequest(id)` on the request contract (deposit handling)
  + `registerAlignmentTarget` on the registry, **prefilled from the request in the UI**. Zero
  core-registry risk now; a one-tx `authorizedRegistrar` role is a v2 upgrade (out of scope here).
- **D8 (was O4) — Minimal public browse.** A "request a target" form + a requester "my requests" status
  view + the `/admin` pending list. **No** full targets/requests directory in v1 (deferred to backlog).

**Open (minor — decide during T1):**
- **O5 — Duplicate/parity guard.** Reject requests whose token already belongs to an active target
  (reuse `tokenToTargetIds`) at submit time so no deposit is taken for an obvious dupe, vs. let the admin
  dedupe on review. Lean: cheap submit-time dup check (skip the deposit path for a known-active token).

## Task units
- [x] **T1 — Request contract (lead).** ✅ `contracts/src/master/AlignmentTargetRequestRegistry.sol` —
      `submitRequest` (payable, exact `requestDeposit` escrow, stores requester/token/title/description/
      metadataURI/assets/status/deposit), `approveRequest`/`rejectRequest(forfeit)` (`onlyOwner`),
      `pruneExpired` (permissionless, past TTL), bounded pending list + swap-and-pop delist, best-effort
      dup guard (O5), events, `nonReentrant`, `onlyOwner` config.
- [x] **T2 — Deploy wiring.** ✅ `DeployCore` deploys it (owner=deployer, escrow→treasury, defaults
      0.05 ETH / 50 / 30d) + serializes the address; `deploy.ts` hands it to ADMIN via the 2-step
      handover; `addresses.ts` + wagmi bindings regenerated. **Fork-verified:** owned by ADMIN;
      non-owner submit (0.05 ETH escrow) → ADMIN approve → Approved + deposit refunded.
- [x] **T3 — Admin UI.** ✅ DONE (`8e6e3f2`) — extended `AlignmentPanel` with `TargetRequestsPanel`
      (list pending, per-request Register-target (prefilled `registerAlignmentTarget`, ≥1 asset) +
      Approve + Reject(forfeit) via `TxButton`/`useTxAction`, `useOwnerGate`); fixed the empty-assets copy.
- [x] **T4 — Requester UI.** ✅ DONE (`8e6e3f2`) — public `RequestTargetPage` (`/request-target`) form
      (token + metadata + assets + deposit) + a "my requests" status view (indexed `RequestSubmitted`) +
      nav entry.
- [x] **T5 — Tests.** ✅ Forge `test/master/AlignmentTargetRequestRegistry.t.sol` (17: submit/approve/
      reject/forfeit/expiry/dup/queue-cap/onlyOwner/delist). Frontend unit tests (18, `targetRequests.ts`)
      + the fork-walk `app/e2e/target-requests.spec.ts` (@fork, `8e6e3f2`) — submits via the real form,
      then ADMIN register+approve via viem, asserting the choke-point end-to-end (target active,
      `isTokenInTarget` true, deposit refunded).
- [x] **T6 — Docs/ADR.** ✅ [ADR-0009](../decisions/0009-alignment-target-request-registry.md) — request
      lifecycle + the request-layer-vs-core-registry split + the request→scout→approve→wire runbook.

## Exit criteria
1. A non-owner submits a target request on the fork (deposit taken per O2); it appears in `/admin`.
2. The admin approves it → `registerAlignmentTarget` runs → `isAlignmentTargetActive(targetId)` is true
   and the token resolves via `isTokenInTarget`; a vault can then be registered/bound to it.
3. Reject path handles the deposit correctly (refund vs forfeit-to-treasury per O2); requester sees the
   status.
4. Spam bound holds — the pending list can't grow unboundedly (cap + prune) and free spam is disincentivized.
5. Green bar: `forge test` · frontend tests + lint · the new request fork-walk.

## Verification
`pnpm chain:fork` + `pnpm chain:deploy`; `forge test`; `pnpm test:e2e` incl. the new
`app/e2e/target-requests.spec.ts` submit→approve walk; manual `/admin` review of a seeded pending request.

## Decision log
- **2026-07-01 (review — pull-payment refund)** — Switched deposit refunds from push to **pull-payment**:
  approve / good-faith-reject / expiry credit a `refunds[requester]` ledger, claimed via `withdrawRefund()`
  (+ a "claim refund" action on `/request-target`). A requester that can't receive ETH can now only revert
  its own claim, never an admin action (forfeit still pushes to the trusted treasury). Per-request asset
  cap deemed unnecessary — the deposit is the spam lever (raise it if abused; it's revenue). +2 forge tests
  (21 total, incl. a `RevertingReceiver` proving approve can't be bricked); e2e extended to claim the
  refund. Full forge 1189.
- **2026-07-01 (review hardening)** — Accuracy pass on the two-tx flow: `approveRequest` now reverts
  `TargetNotRegistered` unless the request's token is already in an active target, enforcing "register
  THEN approve" on-chain (previously only UI label ordering) — an admin can't silently refund + delist a
  request without a target existing. Submit now requires the primary token to be one of the proposed
  assets (`TokenNotInAssets`) so registering makes it active. +2 forge tests (19 total); e2e still green
  (it registers before approving). Full forge 1187.
- **2026-07-01 (build — backend done, fork-verified)** — Shipped T1 (contract, 17 forge tests) + T2
  (DeployCore + deploy.ts ADMIN handover + addresses.ts + wagmi bindings) + T6 (ADR-0009) on
  `feat/alignment-target-requests`. Fork round-trip verified (non-owner submit w/ 0.05 ETH escrow →
  ADMIN approve → refund). O5 resolved: **best-effort submit-time dup guard** (reject if the token's
  first registered target is active; multi-target tokens only partially covered — registry exposes no
  array length for `tokenToTargetIds`; admin dedupes on review). Full forge suite 1185 green. T3/T4 UI
  in progress.
- **2026-07-01 (decisions locked)** — Resolved the load-bearing decisions with Mony: **D5** standalone
  `AlignmentTargetRequestRegistry` (no core-registry upgrade), **D6** refundable ETH deposit
  (refund-on-approve / forfeit-on-spam-reject / reject-and-refund), **D7** two admin txs in v1
  (approve in the request contract, then prefilled `registerAlignmentTarget`), **D8** minimal public
  browse (form + my-requests + `/admin` list; no directory). Only O5 (dedup guard) left as a T1 detail.
  Scope is build-ready.
- **2026-07-01 (opened)** — Task opened + scoped. Locked D1–D4. Confirmed (source): all curation is
  single-owner UUPS (Safe/Timelock); `registerAlignmentTarget` is live-callable and is the sole choke
  point (via `MasterRegistry.registerVault`); no request pattern exists; `FeaturedQueueManager` is the
  anti-spam deposit template and `AlignmentPanel` the admin-UI template; no public targets directory
  exists. Pairs with `ScanAlignmentPools.s.sol` (admin runs it per requested token).

## Open questions
Only **O5** (submit-time duplicate guard) remains — a T1 implementation detail, not a blocker.
