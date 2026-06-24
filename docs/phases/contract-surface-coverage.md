# Contract-Surface Coverage Map

**Source of truth = the smart contracts**, not `legacy/` (which was itself incomplete). This maps the
entire external/public function surface of the live contract set into **natural interfaces** (by role
+ feature) and marks each interface's UI status: ✅ operational · 🟡 partial · ⬜ missing. Governance/
DAO is OUT; **creator admin and protocol admin are first-class**. Built from a 4-agent contract audit
(2026-06-24). Wired = referenced in `app/src/` outside `app/src/generated/`.

> Replaces the page-by-page parity framing. We measure "done" against the contract surface: every
> meaningful external function has an operational UI path, or is explicitly marked internal/out.

---

## Interfaces

### A. Discovery & Home — 🟡
- ✅ `QueryAggregator.getHomePageData` (featured), `getProjectCardsBatch` (hydrate); `MasterRegistry
  CreatorInstanceAdded` event scan (W-A2 all-collections).
- ⬜ Home composition (featured banner + top-vaults + activity feed + EXEC404 pin); filters polish.
*(≈ old W-C)*

### B. Launch / Create — 🟡
- ✅ `{ERC404,ERC1155,ERC721}Factory.createInstance` via wizard; ERC1155 `addEdition` post-create.
- ⬜ **`ERC721AuctionInstance.queuePiece`** — creators CANNOT add auction pieces after launch (no UI).
- ⬜ **Gating config** `PasswordTierGatingModule.configureFor` — wizard can't set password tiers
  (seam stubbed in `useCreateSubmit`). *(old W-G3)*

### C. Per-type trading — ✅ (W-B, done)
- ✅ ERC404 buy/sell/quote/freemint/reroll/graduate/staking; ERC1155 mint/freemint; ERC721 bid/
  settle/reclaim. The verbs are operational.

### D. Collection detail + sub-pages — 🟡  ← **user-flagged**
- ✅ Collection page per type (W-B1).
- ⬜ **ERC1155 edition detail PAGE** — `getEdition`/`getCurrentPrice`/`calculateMintCost` are wired
  inline, but there's no per-edition ROUTE (shareable URL, own styling). *(user: "no edition page")*
- ⬜ **ERC404 / ERC721 NFT (token) detail + gallery** — a DN404 is coin AND NFT; `tokenURI`/`ownerOf`/
  mirror balance are unsurfaced. No art view. *(user: "ERC404 … its also an NFT. show the art")*

### E. Creator admin (per-instance) — 🟡 (biggest execution gap)
Per-instance owner functions, mostly UNWIRED across all three types:
- ERC404: `setBondingActive` / `setBondingOpenTime` / `setBondingMaturityTime`, `setStyle`,
  `setMetadataURI`, `migrateVault`, `claimAllFees`, `setAgentDelegation`. (only `activateStaking` ✅)
- ERC1155: ✅ `withdraw` / `claimVaultFees` / `updateEditionMetadata`; ⬜ `setStyle`, `migrateVault`,
  `claimAllFees`, `setAgentDelegation`, `retryVaultContribution`.
- ERC721: ⬜ `claimVaultFees`, `migrateVault`, `claimAllFees`, `setAgentDelegation` + **`queuePiece`**
  (see B). ✅ `settleAuction` / `reclaimUnsold` (on the auction card).
- Cross-cutting: agent delegation (`setAgentDelegation` on every instance) is the "agents act for
  users" design — absent everywhere.

### F. Portfolio & holdings — ⬜  ← **user-flagged**
- ⬜ `QueryAggregator.getPortfolioData(user, instances, vaults)` is entirely unwired — one call returns
  ERC404 token+NFT+staked+pendingRewards, ERC1155 balances, vault contribution/shares/claimable.
  Powers a `/portfolio` page + the **ERC404 NFT gallery**. *(user: "no … portfolio ability")* *(old W-D1)*

### G. Vault & yield — 🟡
- ✅ `harvest` + reads (`principal`/`depositTime`/`accumulatedFees`/`totalPrincipal`/`communityPayout`).
- ⬜ **`withdrawPrincipal`** — VaultPanel labels principal "refundable" with NO withdraw button;
  `calculateClaimableAmount` ungates it. Alignment-target display (name/community) thin. *(old W-D2)*

### H. Featured-queue management — ⬜
- ⬜ `FeaturedQueueManager.rentFeatured` / `boostRank` / `renewDuration` / `pruneExpired` + reads
  (`getRentalInfo`/`getEffectiveRank`/`quoteDurationCost`). Read indirectly today, never written from
  the UI. Monetization surface. *(old W-E)*

### I. Social / board — 🟡  ← **user-flagged**
- ✅ `GlobalMessageRegistry.post` (new posts), event feed.
- ⬜ **Replies + reactions + threading** — the contract supports it (`messageType` 0=POST/1=REPLY/
  2=QUOTE/3=REACT, `refId` parent-link, `postBatch`); the rebuilt `/board` reads events but doesn't
  thread or aggregate. *(user: "board has no reactions or replies … lost in the migration")*

### J. Profiles — ✅ (minor gap)
- ✅ `setProfile` / `profileURI`. ⬜ `clearProfile` (one button).

### K. Protocol admin console — ⬜ (34 owner functions)
Operator surface (owner = Safe; UI still needed for routine ops):
- Factory mgmt (`registerFactory`/`deactivateFactory`), Vault mgmt (`registerVault`/`deactivateVault`),
  Alignment targets+ambassadors+payouts (AlignmentRegistry CRUD — *zero UI*), Component registry
  (`approveComponent`/`revokeComponent`), Treasury (`withdrawETH/ERC20/ERC721`, revenue-by-source,
  POL), Featured-queue config (rates/bounds/size), Agent delegation (`setAgent`/`revokeAgent`/
  `emergencyRevoker`), registry wiring. *(old W-F)*

### L. Skip (internal / out) 
`initialize*`, UUPS upgrade + ownership-handover, factory-only (`registerInstance`/`initializeStaking`),
staking-module instance-only hooks, V4 callbacks, standard token plumbing (except where it feeds a
gallery/portfolio), `claimFees`/delegation reverts on the Aave vault (NotSupported).

---

## Re-scoped sequence
1. **E + B**: creator admin across all types incl. `queuePiece` + agent delegation — the largest
   "configured-but-unclaimable" gap; unblocks creators operating their own collections.
2. **D**: edition detail page + NFT (token) detail/gallery — the user-visible "show the art" + share.
3. **F + G**: portfolio (`getPortfolioData`) + vault `withdrawPrincipal` — holdings + redeem.
4. **I**: board replies/reactions/threading — restore lost social.
5. **H**: featured-queue management.
6. **K**: protocol admin console (largest, but owner-only; can trail user surfaces).
7. **A**: home/discovery polish. Gating config (B) folds into the wizard when E lands.

Separately: **bug** — "live auction never loads" (deferred; diagnose before/with D).

## Method
4 read-only agents audited: ERC404 stack · ERC1155+ERC721 · master/registry/admin/treasury · vault/
query/social/gating. Each extracted every external function (mutability + access) and grepped
`app/src/` for a non-generated reference. Raw tables in the session transcript.
