# ADR-0009 — Alignment target request registry (request → review → approve)

**Status:** Design LOCKED 2026-07-01 (Mony). Implementation = the "Request an Alignment Target" task
(`docs/phases/alignment-target-requests.md`). Contract + deploy wiring shipped on
`feat/alignment-target-requests`; UI in progress.
**Related:** [ADR-0003](0003-aave-alignment-vault.md) (endowment / community payout),
[ADR-0008](0008-two-vault-families.md) (vault families a target's vaults use), and the admin
pool-scout `contracts/script/ScanAlignmentPools.s.sol` (run per requested token before approval).

## Context
Alignment targets (a community + its token[s]) are the curation core: a project can only bind a vault
to an **active** target whose asset set includes the vault's token — enforced at the single choke point
`MasterRegistryV1.registerVault` (`isAlignmentTargetActive` + `isTokenInTarget`). Registration is
`AlignmentRegistryV1.registerAlignmentTarget(...)`, which is **`onlyOwner`** (the Safe multisig via a 24h
Timelock). Every curation mutator is `onlyOwner`; there is **no intake path**. So a creator who wants to
align to a community that isn't listed has no way to propose it — the only recourse is out-of-band asking
the team. As the launchpad opens up, that's a real funnel gap.

## Decision
Add a **standalone `AlignmentTargetRequestRegistry`** that provides a permissionless *request* front
door with **admin-only approval**, sitting **in front of** the existing choke point — it never registers
a target itself. The request lifecycle is Pending → Approved / Rejected / Expired; approval finalizes by
the owner calling the unchanged `registerAlignmentTarget`.

Locked sub-decisions (from the task's O1–O4):

- **D5 — Standalone contract, not a core-registry change.** A new `Ownable` + `ReentrancyGuard` contract
  mirroring the `FeaturedQueueManager` pay-to-enter idiom. **Zero changes to the Safe/Timelock-owned
  `AlignmentRegistryV1`** (no UUPS upgrade, no new role). Isolated and disposable. The request layer only
  *reads* the registry (a best-effort dup guard) and holds escrow; the owner does the actual registration.
- **D6 — Refundable ETH deposit for anti-spam.** `submitRequest` escrows exactly `requestDeposit`
  (owner-tunable; 0 disables). **Refunded on approve and on TTL-expiry** (expiry isn't spam);
  **forfeited to the protocol treasury on a spam-reject** (`rejectRequest(id, forfeit=true)`), with a
  plain **reject-and-refund** (`forfeit=false`) for good-faith-but-declined proposals. Second line of
  defense: a bounded pending list (`maxPending`) + permissionless `pruneExpired` past `requestTTL`.
- **D7 — Two admin txs (v1), order enforced on-chain.** `approveRequest(id)` (refunds the deposit,
  delists) and `registerAlignmentTarget(...)` (prefilled from the request in the admin UI) are
  **separate** transactions. This keeps the core registry untouched. To make the split safe,
  **`approveRequest` reverts (`TargetNotRegistered`) unless the request's token is now in an active
  target** — so an admin can't refund + delist a request without having registered it (a "register THEN
  approve" invariant, not just UI label ordering). Reject has no such requirement (declining ≠
  registering). Submit correspondingly requires the primary token to be among the proposed assets, so
  registering makes it active. A one-tx path (a narrow `authorizedRegistrar` role on
  `AlignmentRegistryV1` so approval registers directly) is a **v2** upgrade, deliberately out of scope —
  it would touch the Safe/Timelock contract.
- **D8 — Minimal browse surface.** A public request form + a requester "my requests" status view + the
  `/admin` pending list. **No** full public targets/requests directory in v1 (targets are surfaced only
  indirectly via vaults today; a directory is deferred to backlog).

Intake mirrors the registry's own validation (non-empty title, ≥1 asset, nonzero asset tokens) so an
approve→`registerAlignmentTarget` can't revert on the proposed data. The stored `token` feeds the admin
**pool scout** (`ScanAlignmentPools <token>`) and a **best-effort dup guard** (reject if the token's
first registered target is already active — the registry exposes no array length for `tokenToTargetIds`,
so multi-target tokens are only partially covered; the admin still dedupes on review).

## Consequences
- **Positive:** a self-service funnel for new targets; on-chain, trustless request record + escrow (fits
  the lean onchain-only ethos); no risk to the core registry (no upgrade); reuses proven
  `FeaturedQueueManager` mechanics + the `AlignmentPanel` admin UI; composes with the pool scout for an
  end-to-end "request → scan → approve → wire" runbook. Ownership follows the platform pattern (owner =
  deployer at deploy, handed to ADMIN via the 2-step Solady handover in `deploy.ts`).
- **Negative / trade-offs:** approval is two txs (mild admin friction, addressed in v2); the dup guard is
  best-effort; escrowed deposits mean the contract custodies ETH while Pending (mitigated by
  `nonReentrant` + checks-effects-interactions on every payout). Approval still bottlenecks on a single
  owner — intentional (curation is the product), not delegated in v1.

## Alternatives considered
- **Extend `AlignmentRegistryV1`** with a pending mapping + internal register on approve — atomic, but a
  UUPS upgrade of a core Safe/Timelock contract (24h delay, storage-append care) and mixes intake into
  curation. Rejected for v1 (this is the v2 `authorizedRegistrar` direction, scoped down).
- **Off-chain form + `GlobalMessageRegistry` post** — lightest, but emit-only: no on-chain anti-spam and
  no pending state. Rejected as the primary; a request MAY additionally emit a GMR post for the social
  feed.
- **Free intake + admin moderation only** — simpler/friendlier, but spammable; the pending list fills
  with junk the admin must clear. Rejected in favor of the refundable deposit.
