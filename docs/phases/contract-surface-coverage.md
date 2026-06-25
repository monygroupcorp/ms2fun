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

### A. Discovery & Home — ✅ (Phase 2, done 2026-06-24)
- ✅ Home: featured grid (rank-sorted, EXEC404 pinned) + stats bar + recent-activity preview, on the
  featured fast-path. Discovery filters polished (count, clear-filters). All-collections event scan ✓.

### B. Launch / Create — 🟡 (one BLOCKED item remains)
- ✅ `{ERC404,ERC1155,ERC721}Factory.createInstance` via wizard; ERC1155 `addEdition`; ERC721
  `queuePiece` (Phase 1 admin).
- ⛔ **Gating config** `PasswordTierGatingModule.configureFor` — BLOCKED, not just unwired: the FIRST
  config is **factory-only** (`isFactoryRegistered(msg.sender)`); only UPDATES are owner-callable, and
  `createInstance` doesn't accept a `TierConfig`. So "set up password gating" needs a create-flow (and
  likely contract) change to pass the tier config through the factory. Deliberate decision, deferred.
  (An unconfigured gated instance is effectively open — tier 0, no cap.)

### C. Per-type trading — ✅ (W-B, done)
- ✅ ERC404 buy/sell/quote/freemint/reroll/graduate/staking; ERC1155 mint/freemint; ERC721 bid/
  settle/reclaim. The verbs are operational.

### D. Collection detail + sub-pages — ✅ (W-D, done 2026-06-24)
- ✅ Collection page per type (W-B1).
- ✅ **ERC1155 edition detail page** — route `/collection/:instance/edition/:id`: hero art, stats,
  inline shared `MintPanel`, metadata-driven theming (`theme.accent`/`background`), copy-link share.
- ✅ **NFT galleries + token detail page** — `/collection/:instance/token/:id`: DN404 mirror art
  (`mirrorERC721`→`tokenURI`/`ownerOf` via minimal ABI) + ERC721 piece art + auction history.
  Galleries (`Erc404NftGallery`, `Erc721PieceGallery`) mounted on the collection surfaces.

### E. Creator admin (per-instance) — ✅ (Phase 1, done 2026-06-24)
Owner-gated admin panel per type (composing the Phase-0 primitives), self-hides for non-owners:
ERC404 (bonding lifecycle/style/metadata/migrateVault/claimAllFees/delegation), ERC1155 (the prior
withdraw/claimVaultFees/updateMeta refactored + setStyle/migrateVault/claimAllFees/delegation/retry),
ERC721 (**queuePiece** + claimVaultFees/migrateVault/claimAllFees/delegation). Original gap below:

#### (original gap)
Per-instance owner functions, mostly UNWIRED across all three types:
- ERC404: `setBondingActive` / `setBondingOpenTime` / `setBondingMaturityTime`, `setStyle`,
  `setMetadataURI`, `migrateVault`, `claimAllFees`, `setAgentDelegation`. (only `activateStaking` ✅)
- ERC1155: ✅ `withdraw` / `claimVaultFees` / `updateEditionMetadata`; ⬜ `setStyle`, `migrateVault`,
  `claimAllFees`, `setAgentDelegation`, `retryVaultContribution`.
- ERC721: ⬜ `claimVaultFees`, `migrateVault`, `claimAllFees`, `setAgentDelegation` + **`queuePiece`**
  (see B). ✅ `settleAuction` / `reclaimUnsold` (on the auction card).
- Cross-cutting: agent delegation (`setAgentDelegation` on every instance) is the "agents act for
  users" design — absent everywhere.

### F. Portfolio & holdings — ✅ (Phase 2, done 2026-06-24)
- ✅ `/portfolio` via `getPortfolioData(user, instances, vaultAddrs)`: ERC404 token+NFT+staked+rewards,
  ERC1155 balances, vault positions + totalClaimable; MAX_QUERY_LIMIT(50)-capped. NFT holdings shown
  as counts + link to the collection gallery (per-owner mirror scan deferred).

### G. Vault & yield — ✅ (Phase 1, done 2026-06-24)
- ✅ `harvest` + reads, and **`withdrawPrincipal`** — VaultPanel now shows claimable principal
  (gated on `calculateClaimableAmount`; disabled+dated-hint while locked) + the matured 80/19/1 split.
- ⬜ (minor) richer alignment-target display (name/community) — fast-follow.

### H. Featured-queue management — ✅ (Phase 2, done 2026-06-24)
- ✅ FeaturedPanel on every collection: rent / boost / renew / prune + live `getRentalInfo` status;
  `value` = `quoteDurationCost(duration) + rankBoost` (verified against the contract).

### I. Social / board — ✅ (Phase 1, done 2026-06-24)  ← **user-flagged**
- ✅ `post` + **threaded replies** (messageType 1, refId=parent) + **reactions** (messageType 3,
  distinct-sender aggregated). Replies/reactions post to the PARENT's channel so threads render on the
  board AND in collection/profile feeds. Pure threading transform is unit-tested.

### J. Profiles — ✅ (Phase 3)
- ✅ `setProfile` / `profileURI` / `clearProfile`; created-collections list already on the profile.

### K. Protocol admin console — ✅ (Phase 3, done 2026-06-24)
- ✅ `/admin` console (nav + page gated on the MasterRegistry owner), FIVE registry panels each
  self-gating on their `owner()`: **MasterRegistry** (factory/vault/instance mgmt), **Alignment**
  (targets/ambassadors/payouts), **Component** (approve/revoke), **PlatformConfig** (featured-queue
  rates/bounds/size + agent delegation), **Treasury** (balance + revenue-by-source + POL; withdraw
  ETH/ERC20/ERC721 + setRevenueConductor).
- ✅ Registry ownership handed to the testing wallet via the 2-step handover (deploy.ts impersonation),
  so the console is operable as `0x54Ef…`.

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
