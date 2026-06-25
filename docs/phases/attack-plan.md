# Attack Plan — Operational Capability Sprint

Goal: close the contract-surface gaps (see `contract-surface-coverage.md`, interfaces B/E/F/G/H/I/K) fast,
via agent-driven development, **without accumulating the latent bugs we keep catching** (gating
encoding, multicall3, per-second refetch). Strategy = **foundation → parallel batches → tight verify**.

## The multiplier: shared primitives first
Every interface is "read state → render → write action(s)", and every write action today re-implements
the same ~40-line idiom (useWriteContract + useWaitForTransactionReceipt + idle/sign/confirm/success/
error + reset + btn classes). There are ~50 actions left. So **Phase 0 extracts that idiom once**; after
it, an agent adds an action as ~5 lines of config, consistently and correctly. This is what turns a
multi-week slog into a few parallel batches.

## Phase 0 — Foundation (LEAD, 1 slice, blocks everything)
- **`useTxAction` / `<TxAction>`** — the write idiom in one place: takes a write config + optional
  gating, exposes `{ state: idle|signing|confirming|success|error, send, reset }` and a button. Tested.
- **`useOwnerGate(instance)`** — reads `owner()`, returns `isOwner` (creator-admin gating).
- **`<AdminSection>` / `<ActionRow>`** — owner-gated panel shell (consistent layout for E + K).
- **`<AmountField>`** — standardized amount input (parse/validate/cap, ETH + token units).
- **`docs/contract-facts.md`** — distilled from the 4-agent audit: exact signatures + access control +
  the encoding gotchas (gating `abi.encode(passwordHash,openTime)`, mirror reads, `client.multicall`
  needs multicall3, derive-state-don't-refetch). **Agents MUST cite it** — kills the divergent-conclusion
  class of bug (the B2/B4 gating split).

## Phase 1 — Operational core (parallel, ~6 agents) — the gaps you flagged
Build on Phase 0; lead integrates into the collection pages / board, gates + fork-verifies.
- **E-404** ERC404 creator admin: setBondingActive / setBondingOpenTime / setBondingMaturityTime,
  setStyle, setMetadataURI, migrateVault, claimAllFees, setAgentDelegation.
- **E-1155** ERC1155 creator-admin completion: setStyle, migrateVault, claimAllFees, setAgentDelegation.
- **E-721 + B** ERC721 creator admin: **queuePiece form** (creators can't add pieces today!),
  claimVaultFees, migrateVault, claimAllFees, setAgentDelegation.
- **G** vault `withdrawPrincipal` (fold into VaultPanel; gate on `calculateClaimableAmount`).
- **I** board replies + reactions + threading (contract supports `messageType`/`refId`/`postBatch`).
- (**B-gating-config** = wizard `configureFor` — folds in after E lands.)

## Phase 2 — Holdings & growth (parallel, ~3 agents)
- **F** portfolio page (`getPortfolioData`): ERC404 token+NFT+staked+rewards, ERC1155 balances, vault
  positions + claimable. Reuses the W-D NFT gallery for the holder's NFTs.
- **H** featured-queue management: rentFeatured / boostRank / renewDuration / pruneExpired + pricing reads.
- **A** home composition (featured banner + top-vaults + activity feed) + discovery filters polish.

## Phase 3 — Protocol admin console (parallel, ~5 agents)
Interface **K** (34 owner functions), in an `/admin` route shell the lead builds first; split by panel:
- Factory + vault mgmt · Alignment targets + ambassadors + payouts · Component approve/revoke ·
  Treasury (revenue/withdraw/POL) · Featured-config + agent delegation.

## Verification loop (every phase — non-negotiable)
fan out (worktree, based off the right ref) → **LEAD adversarial review of integration points** (the
gating/multicall/refetch bug class) → gates (typecheck/lint/test/build + forge build) → **fork-verify
checkpoint with Mony**. Nothing merges to main without a walk.

## Execution mechanism
Default = established **Agent fan-out** in lead-orchestrated batches (what we've used). Alternative =
a deterministic **Workflow** (pipelines fan-out + adversarial-verify stages automatically) — opt in by
saying "use a workflow"; it would run Phases 1/2/3 as fan-out→verify pipelines.

## Throughput
~14 agent slices + ~4 lead slices (Phase 0 + 3 route/mount shells). Phase 0 is the unlock; 1→2→3 are
each internally parallel. Sequence the phases so each ends on a fork-verify you control.
