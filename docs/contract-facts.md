# Contract Facts — the agent crib sheet

Distilled from the 4-agent contract-surface audit (`phases/contract-surface-coverage.md`). **Agents
building UI MUST read this**, then confirm exact arg/return shapes in `app/src/generated/contracts.ts`
(the ABI is ground truth; this doc orients + records the non-obvious gotchas). `forkChainId` (from
`lib/addresses`) goes on every read and write.

## Use the Phase-0 primitives (don't re-roll the idiom)
- **Writes** → `useTxAction` + `<TxButton>` (`components/ui`). `const tx = useTxAction({ onSuccess:
  refetch }); tx.send({ address, abi, functionName, args, value?, chainId: forkChainId })`. Never
  hand-roll useWriteContract + useWaitForTransactionReceipt + status again.
- **Creator-admin gating** → `useOwnerGate(instance)` → `{ isOwner }`. Render owner-only actions only
  when `isOwner`.
- **Admin layout** → `<AdminSection title>` + `<ActionRow label hint>` wrapping a `<TxButton>`.
- **Amounts** → `<AmountField>` + `parseAmount(raw, decimals)` (undefined = invalid → disable submit).
- Generated hooks: `useRead/WriteErc{1155,721Auction,404Bonding}Instance<Fn>`; the DN404 mirror is
  `…MirrorErc721`. The mirror's ERC721 views (`tokenURI`/`ownerOf`/`totalSupply`) are NOT generated —
  read via a minimal inline ABI + `usePublicClient`.

## Nomenclature (don't overload "metadata")
- **content URI** = `metadataURI` — the JSON describing the asset (name/image/description). *What it is.*
- **style URI** = `styleUri` (collection `setStyle`; per-edition style rides in the edition content JSON
  as a `styleURI` field — no on-chain edition style slot). A CSS pointer for how the SITE renders the
  page. *How it looks.* NOTE: `styleUri` is currently write-only — no renderer applies it yet (backlog).
- Say "content" / "style" in UI labels, never bare "metadata".

## Gotchas (every one of these has already bitten us)
- **`client.multicall` needs Multicall3** — now declared on the fork chain (`lib/wagmi`). Fine to use.
- **Time-state: derive at render, never key a query on it.** Use `useChainNow` (`lib/time`) for "now"
  (chain-anchored), pass it to `deriveAuctionState`/`derivePhase` in the RENDER. Putting `nowSec` in a
  queryKey re-runs the whole read every second.
- **Gating data differs by call site:**
  - `mint(... bytes32 gatingData ...)` and `buyBonding(... bytes32 passwordHash ...)` → pass the RAW
    `keccak256(toHex(password))` (bytes32); the INSTANCE wraps it with openTime internally.
  - `claimFreeMint(bytes gatingData)` → pass `abi.encode(passwordHash, openTime)` (the module
    `abi.decode`s `(bytes32,uint256)`; a bare hash reverts). Helpers exist: `erc1155/gatingMint.ts`,
    `erc404/gating.ts`.
- **DN404 art lives on the mirror**, not the bonding instance. Enumeration is sparse after rerolls —
  scan `1..min(totalSupply, cap)` with `multicall({allowFailure:true})`.

## Interface E — per-instance creator admin (all `onlyOwner`; gate with `useOwnerGate`)
- **ERC404Bonding**: `setBondingActive(bool)`, `setBondingOpenTime(uint256)`,
  `setBondingMaturityTime(uint256)` (must be > openTime, both future), `setStyle(string)`,
  `setMetadataUri(string)`, `migrateVault(address)`, `claimAllFees()`, `setAgentDelegation(bool)`.
  (`activateStaking()` already wired.)
- **ERC1155**: `withdraw(uint256 amount)` (✅), `claimVaultFees()` (✅), `updateEditionMetadata(uint256,
  string)` (✅), `addEdition(...)` (✅), `setStyle(string)`, `migrateVault(address)`, `claimAllFees()`,
  `setAgentDelegation(bool)`, `retryVaultContribution()` (permissionless). Reads for withdraw context:
  `totalProceeds()`, `totalWithdrawn()`.
- **ERC721Auction**: **`queuePiece(string tokenURI)` payable** (msg.value = the piece's min bid; owner
  or delegated agent) — the missing "add a piece" action; `claimVaultFees()`, `migrateVault(address)`,
  `claimAllFees()`, `setAgentDelegation(bool)`. (`settleAuction`/`reclaimUnsold` ✅.)

## Interface G — vault / yield (AlignmentEndowmentVault, the instance is the benefactor)
- `harvest()` (✅, permissionless). `withdrawPrincipal(address benefactor)` — benefactor = the instance
  address; gate the button on `calculateClaimableAmount(benefactor)` (returns 0 while locked, gross at
  maturity). Reads: `principal(b)`/`getBenefactorShares(b)`, `depositTime(b)`, `accumulatedFees()`,
  `MATURITY_DURATION` (365d). Split logic is on-chain (matured 80 creator/19 community/1 platform).

## Interface I — board (GlobalMessageRegistry)
- `post(address instance, uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata,
  string content)`. **messageType: 0 POST · 1 REPLY · 2 QUOTE · 3 REACT.** `refId` = parent messageId
  for replies/reactions. `postBatch(posts[])` for batching. Event `MessagePosted(messageId, instance,
  sender, messageType, refId, actionRef, metadata, content)` — `useMessageFeed` reads it flat today;
  thread by refId + aggregate messageType-3 reactions.

## Interface F — portfolio (QueryAggregator)
- `getPortfolioData(address user, address[] instances, address[] vaults)` → ERC404 token+NFT+staked+
  pendingRewards, ERC1155 balances, vault contribution/shares/claimable + totalClaimable. Feed it the
  all-collections instances (W-A2 index) + their vaults. Reuse the W-D NFT gallery for holdings.

## Interface H — featured queue (FeaturedQueueManager, user-facing economics)
- `rentFeatured(address instance, uint256 duration, uint256 rankBoost)` payable,
  `boostRank(address instance)` payable, `renewDuration(address instance, uint256 additionalDuration)`
  payable, `pruneExpired(address instance)`. Reads: `getRentalInfo`, `getEffectiveRank`,
  `quoteDurationCost(duration)`, `getFeaturedInstances(offset,limit)`, `queueLength()`. Bounds: duration
  ∈ [7,365] days; excess ETH refunds.

## Interface K — protocol admin console (owner = Safe; `onlyOwner`/`onlyRoles`)
Group into role-gated panels (gate on `owner()` of each registry):
- **Factory/Vault** (MasterRegistry): `registerFactory`/`deactivateFactory`, `registerVault`/
  `deactivateVault`, `revokeInstance`, `updateInstanceMetadata`.
- **Alignment** (AlignmentRegistry): `registerAlignmentTarget`/`updateAlignmentTarget`/
  `deactivateAlignmentTarget`, `addAmbassador`/`removeAmbassador`, `setCommunityPayout` + the matching
  reads (getAlignmentTarget, getAmbassadors, getCommunityPayout).
- **Component** (ComponentRegistry): `approveComponent`/`revokeComponent` + getApprovedComponents(ByTag).
- **Treasury** (ProtocolTreasuryV1): `withdrawETH`/`withdrawERC20`/`withdrawERC721`, `setRevenueConductor`,
  reads getBalance/getRevenueBySource/getPolPosition.
- **Featured-config + Agents**: FeaturedQueueManager setters (DailyRate/DecayRate/DurationBounds/
  MaxFeaturedSize) + MasterRegistry `setAgent`/`revokeAgent`/`setEmergencyRevoker`.
- **Out (skip UI):** initialize*, UUPS upgrade + ownership-handover, factory-only registerInstance.
