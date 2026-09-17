# ms2fun contracts — pre-testnet security audit

**Date:** 2026-09-17
**Scope:** every production contract under `contracts/src`, excluding `interfaces/`, `lib/`,
`mocks/`, `test/`, `*.t.sol` and `*Mock*.sol` — 62 files, 21,399 lines.
**Base:** `contracts-pre-testnet-audit`, cut from `main` at `238b0131`.
**Method:** map → twelve-lane parallel hunt → adversarial judge pass → Foundry proof-of-concept
for each surviving High.

This audit is what `testnet-deploy` clause 1 waits on; that clause was ruled NO-GO on 2026-09-15
"until the contract work wanted before the test is finished and the audit is done".

---

## 1. Map

### 1.1 What the system is

ms2fun launches tokens and routes a permanent slice of each launch into an *alignment vault* held
for a curated community. Four subsystems carry value:

1. **Launch factories** deploy per-launch instances. The ERC404 bonding-curve launch is the main
   path; ERC1155 editions and ERC721 auctions are smaller surfaces beside it.
2. **Liquidity deployers** take a graduated launch's reserve, seed a real AMM pool, and tithe a
   cut to the alignment vault. One module per venue: Uniswap v4, ZAMM, Cypher/Algebra.
3. **Alignment vaults** hold the tithe and split the yield it earns 80% creator / 19% community /
   1% protocol. Three are LP-fee vaults (uni, zamm, cypher); the fourth, `AlignmentEndowmentVault`,
   holds ETH in Aave and is pooled across many benefactors.
4. **The master registry layer** decides which addresses are real: which factories may deploy,
   which instances are genuine, which alignment targets are curated, and who may act for them.
   Nearly every other contract's access control bottoms out in a `MasterRegistryV1` lookup.

`src/treasury/` sinks protocol revenue, `src/peripherals/zRouter.sol` is a swap router,
and `src/metadata/`, `src/registry/`, `src/gating/`, `src/promotion/`, `src/query/` are support
surfaces that hold no user funds.

### 1.2 Trust boundaries

The system has five distinct trust levels. Reading a finding's severity depends on which boundary
it crosses.

| Level | Who | What they can do | Enforced by |
|---|---|---|---|
| **T0 — protocol owner** | Safe multisig behind a Timelock | Upgrade UUPS implementations, register/revoke factories and instances, curate and de-curate alignment targets, set every owner-settable parameter, seat ambassadors | `Ownable` / `OwnableRoles` on the registries; `_authorizeUpgrade` |
| **T1 — registered factory** | `ERC404Factory`, `ERC1155Factory`, `ERC721AuctionFactory`, the four vault factories | Deploy instances and register them as genuine | `MasterRegistryV1` factory allowlist, written at T0 |
| **T2 — registered instance** | a deployed launch | Call the liquidity deployers, tithe into vaults, post to `GlobalMessageRegistry`, deploy POL | `onlyRegisteredInstance`, resolved through `MasterRegistryV1` |
| **T3 — ambassador / creator** | seated per alignment target; launch creator | `execute` capital out of the endowment vault, claim the creator yield leg, tune their own instance | `onlyOwnerOrAmbassador`, `AlignmentRegistryV1` seating |
| **T4 — anybody** | the public | Buy and sell on a curve, bid, stake, contribute to a vault, propose an alignment target, boost the featured queue | nothing — these are the permissionless surfaces, and the ones an attacker starts from |

Trusted-by-design, and therefore not findings on their own: T0 is trusted to be **honest but not
infallible**, so "the owner could rug" is only reported where it is reachable *without* owner
intent, or where it contradicts a promise the code itself makes. The de-curation freeze on
ambassador deploy rights is intended (rth, noesis-276). The owner-settable-number class is an
accepted class (rth, 2026-09-04).

### 1.3 External calls — what each contract talks to

Every contract that calls out of its own address, and the target it trusts. A target marked
**registry** is resolved through `MasterRegistryV1` at call time; **fixed** is set at deploy and
immutable; **caller** is supplied by whoever made the call, and is where an attacker chooses the
argument.

| Contract | Calls out to | Target chosen by |
|---|---|---|
| `ERC404Factory` | CreateX, MasterRegistry, ComponentRegistry, curve computer, DeployBondEscrow, alignment vault | registry + fixed |
| `ERC404BondingInstance` / `…Ops` | LiquidityDeployerModule, alignment vault, staking module, gating module, MasterRegistry, GlobalMessageRegistry; raw `.call{value:}` on payout legs | registry + fixed |
| `LiquidityDeployerModule` (v4) | Uniswap v4 `IPoolManager`, alignment-hook factory, `IHooks`, MasterRegistry, alignment vault | fixed + registry |
| `ZAMMLiquidityDeployerModule` | ZAMM, ERC20, MasterRegistry, alignment vault | fixed + registry |
| `CypherLiquidityDeployerModule` | Algebra factory / pool / position manager, WETH, ERC20, MasterRegistry | fixed + registry |
| `AlignmentEndowmentVault` | Aave `StataToken`, WETH, MasterRegistry; raw `.call{value:}` on each payout leg | fixed + registry |
| `UniAlignmentVault` | Uniswap v4 `IPoolManager`, `IVaultPriceValidator`, ERC20 | fixed |
| `ZAMMAlignmentVault` | ZAMM, `IVaultPriceValidator`, ERC20 | fixed |
| `CypherAlignmentVault` | Algebra factory / pool / router / position manager, WETH, `IVaultPriceValidator` | fixed |
| `AlignmentRegistryV1` | Uniswap V3 factory + pool, Algebra factory + pool, volatility oracle | **caller** (a candidate reference pool, validated for provenance before use) |
| `UniswapVaultPriceValidator` | Uniswap V3 factory + pool, Algebra pool, v4 `IPoolManager` | fixed + registry |
| `zRouter` | Uniswap V2/V3/V4, ZAMM, Curve (stable/crypto/tricrypto/twocrypto), Permit2, ERC2612/DAI permit, ERC6909 | **caller** |
| `BestRouteAcquirer` | Algebra swap router, a route router | **caller** |
| `QueryAggregator` | ~12 read interfaces across instances, vaults, the featured queue | registry (read-only) |
| `MetadataResolverRouter` / `SafeResolverLib` / overlay + tier modules | `IMetadataResolver` and per-instance readers | registry, via a defensive staticcall wrapper |
| `MasterRegistryV1` | factories, instances, vaults, alignment registry, component registry | its own records |
| `ProtocolOwnedLiquidityV1` | Uniswap v4 `IPoolManager`, MasterRegistry | fixed + registry |
| `DeployBondEscrow` | the bonding instance (state read), WETH, treasury | fixed |
| `FeaturedQueueManager`, `GlobalMessageRegistry`, `MerkleGatingModule`, `ERC404StakingModule` | MasterRegistry | registry |

`FrontendRegistry` calls an ENS resolver; `ComponentRegistry`, `ProfileRegistry`,
`PromotionBadges`, `OnchainImageStore`, `LaunchManager`, `CurveParamsComputer`,
`BondingCurveMath`, `RevenueSplitLib`, `MetadataUtils`, `FeatureUtils`, `HookAddressMiner`,
`DynamicPricingModule` and `SafeOwnableUUPS` make no value-bearing external call.

### 1.4 Value flows

Where ETH and tokens physically move. Every one of these is a path an attacker would like to
redirect.

**F1 — curve buy.** T4 sends ETH to `ERC404BondingInstance.buyBonding`. Price comes from
`BondingCurveMath` against the stored curve params; ERC20 + mirrored NFTs go out to the buyer;
ETH accumulates as the instance's reserve. Fees split through `RevenueSplitLib`.

**F2 — curve sell.** The reverse: tokens in, ETH out of the reserve.

**F3 — graduation.** When the reserve reaches the preset's target, the instance calls its
`LiquidityDeployerModule`. The reserve splits three ways under `RevenueSplitLib` (1% protocol /
19% vault / 80% LP), the LP leg seeds the pool, the vault leg is tithed to the alignment vault
via `receiveContribution`, and a failed tithe is stashed as `pendingVaultCut` for a later
`flushPendingVaultCut`. Each venue module documents a **graduation-LP permanence invariant** —
the minted position is not withdrawable by the creator.

**F4 — protocol-owned liquidity.** A registered instance calls `ProtocolOwnedLiquidityV1
.receivePOL`, escrowing the whole position's capital in that one call.

**F5 — endowment deposit.** Anyone calls `receiveContribution` on `AlignmentEndowmentVault`; ETH
is wrapped and deposited into an Aave `StataToken` position; immutable per-benefactor shares are
minted at the pool's live price. Principal is a **permanent donation with no refund path**.

**F6 — endowment yield.** `_crystallizeYield` computes position value minus basis and splits it
80/19/1: the creator leg through a MasterChef accumulator (`accCreatorYieldPerShare` +
`rewardDebt`, pulled via `claimYieldPurse`), the target leg to the registry's community payout for
the target, the protocol leg to `protocolTreasury`.

**F7 — endowment withdrawal.** An ambassador (T3) `execute`s capital out; `releaseCorpusToCommunity`
sweeps after de-curation; `flushRoundResidue` collects a closed round's residue. All three debit
the pooled `totalPrincipal` only, so every benefactor's share falls pro-rata.

**F8 — LP vault fees.** The uni/zamm/cypher vaults collect fees from their positions and split
them by the same `PROTOCOL_CUT_BPS = 100` / `TARGET_CUT_BPS = 1900` constants, creator taking the
remainder.

**F9 — staking rewards.** `ERC404StakingModule` is a Synthetix-style accounting backend holding
no funds; the instance pays the ETH it computes.

**F10 — auction settlement.** `ERC721AuctionInstance` takes bids, refunds the outbid, and on
settle routes proceeds out with an alignment cut.

**F11 — deploy bond.** A creator's refundable bond is escrowed in `DeployBondEscrow` (separate
from the factory, which keeps a "holds no ETH" invariant) and either returned or forfeited to the
treasury. Default `bondAmount` is 0 — the lever is off.

**F12 — featured queue.** `FeaturedQueueManager` takes ETH for placement and rank, permissionlessly
boostable and renewable by anyone.

**F13 — target request deposit.** `AlignmentTargetRequestRegistry` escrows a deposit per proposal
and refunds it through a pull-payment ledger.

**F14 — router swaps.** `zRouter` moves user funds through external AMMs on caller-chosen routes.

---

## 2. Findings

Twelve hunt lanes filed 118 candidate findings. Every one was put through a skeptic pass that
tried to disprove it against the code, and the majority did not survive: struck as already fixed
on `main`, already defended by a test, already ruled, or simply wrong about what the code does.
What follows is what survived, with the evidence that made it survive.

**Severity means:** *High* — direct loss or lock of user or protocol funds reachable by someone
who is not the trusted owner. *Medium* — conditional loss, griefing with real cost to victims, or
a broken invariant needing an unusual-but-reachable precondition. *Low* — a correctness defect
with bounded impact. *Info* — hardening, clarity, dead code.

### Already ruled, and not re-reported

Cited so the reader knows they were looked at, not missed:

- The 2026-09-10 round-closing High in `_closeRoundIfPriceCollapsed` is **fixed** on this base.
  `AlignmentEndowmentVault.sol:150-156` now records the residue being redeemed OUT of the position
  into `roundResidue` before the basis is zeroed, so `totalPrincipal == 0` with ETH still in the
  position is unreachable. Landed in PR #383.
- The endowment share model (immutable per-benefactor shares, `fundingRound`,
  `MIN_SHARE_PRICE_INVERSE`) is rth's accepted design, option (a), 2026-09-10.
- The endowment factory's `setVaultCommunityPayout` capability is **gone** — it survives only as a
  deliberate tombstone at `AlignmentEndowmentVaultFactory.sol:88` with two negative tests pinning
  the selector's absence.
- De-curation freezing an ambassador's deploy rights is intended (noesis-276).
- `setBondingOpenTime` re-checking the stored maturity against `MAX_BONDING_DURATION` (PR #380's
  hold) **is present** at `ERC404BondingOps.sol:974-984`, landed in `63fa1c10`.
- The 80/19/1 split, the ERC404+endowment pairing, and the owner-settable-number class are ruled.

One correction worth recording: the audit branch was cut 30 commits behind `main` and was missing
six contract fixes, #418, #420 and #421 among them. It was merged up to `main` (`71b22fc8`) before
the judging pass, and every finding below is anchored against that tree. Two candidate findings —
the `setBondingOpenTime` bound and the endowment accumulator's flooring division — were struck
precisely because they were already fixed in commits the stale base could not see.

---

### HIGH

#### H-1 · A free-mint tranche is redeemable against a reserve only paid buyers funded

**`src/factories/erc404/ERC404BondingOps.sol:500-503`** (mint) and
**`src/factories/erc404/ERC404BondingInstance.sol:614-616`** (redeem).

`claimFreeMint` transfers a unit to the claimer and writes neither `totalBondingSupply` nor
`reserve`:

```solidity
freeMintClaimed[msg.sender] = true;
freeMintsClaimed++;
_transfer(address(this), msg.sender, unit);
```

`sellBonding` decrements both, and its only entry check is that the seller holds the balance —
nothing distinguishes free coin from bought coin. So free-minted coin is redeemed against ETH that
curve buyers put in.

The supply carve-out at `buyBonding:531` (`maxSupply - liquidityReserve - freeMintAllocation*unit`)
looks like it reserves room for the tranche, and it does — *for supply*. The curve is then scaled
to raise `targetETH` over exactly that span (`ERC404Factory.sol:570-582`), so `reserve` tops out at
`targetETH` backing the curve's own supply while the tranche adds sellable coin funded by nothing.
The carve-out is what *guarantees* the tranche is claimable on top of a fully-sold curve.

At the shipped STANDARD preset (25 ETH, G=7.2), with `φ = allocation/maxBondingSupply`, the
fraction of the raise a free dump removes is `ln((pole-1+φ)/(pole-1)) / 3.171259`:

| allocation | φ | raise removed |
|---|---|---|
| 5% | 0.0588 | 26.8% |
| **10%** | **0.125** | **42.5%** |
| 25% | 0.385 | 75.5% |

**Measured, not asserted:** 25.000 ETH in, 10.636 ETH out to free claimers, 14.364 ETH left. The
loss is not spread across holders — it falls in strict reverse-exit order with a hard lock at the
tail. After a 12.5% dump the late cohort recovers 10.854 ETH against 19.859 paid (−45%), and the
early cohort is then left holding 4.0e24 coin against a `totalBondingSupply` of 3.0e24, so
`calculateRefund` reverts `AmountExceedsSupply` and **1e24 of paid coin is unsellable at any price**.

Gating changes the beneficiary, not the loss: the magnitude is a function of the allocation, not
of who claims it. A perfect merkle allowlist costs paid buyers exactly the same ETH.

**On the existing acceptance.** `ERC404BondingInstance.sol:603-607` says, of the sell fee, that it
monetizes exits "including free-mint redemptions that dilute the reserve (F3, risk-accepted),
without touching curve solvency". Read precisely, "without touching curve solvency" is a claim
about the *fee*, and the acceptance is the parenthetical. `docs/spec/BONDING_CURVE_ARITHMETIC.md:233-237`
states the mechanism and names the two fixes, defending it as *"The allocation is the creator's
choice; the number is stated here so it is known when it is chosen."*

That defence does not hold, and this is the sharpest fact in the finding: the creator never reads
that spec, and the surface they do read says the opposite. `app/src/lib/learn/concepts.ts:141`
tells the creator, for ERC-404 specifically, that "the allocation is genuinely **held back**… so
paid buyers cannot eat into the free allocation." The panel warns in detail about the ERC-1155
price-curve effect and presents ERC-404 as the protected case. The spec's own sizing (62% at a 10%
allocation) also disagrees with the measured 42.5%.

Neither an in-code comment nor a spec paragraph is an owner ruling, and no ruling for this exists
in `decisions.log`.

**Default is off, one field away from on.** `freeMintAllocation` is a per-create parameter, not a
preset field; the wizard defaults it to 0 and every deploy script passes 0. The only bounds are
`allocation < nftCount` and `allocationTokens <= maxSupply - liquidityReserve` — i.e. up to 90% of
supply is accepted, with no warning at any layer. Graduation is manual, so the dump window is the
whole bonding period.

**Never defended:** `test/invariant/BondingCurveInvariant.t.sol:175` asserts
`instance.freeMintAllocation() == 0`, so the repo's two strongest solvency invariants have never
run against this configuration. The test's own comment shows the author knew why.

**Proof:** `test/audit/FreeMintCurveSolvency.t.sol` — 3 failing, 1 passing control (the same script
at `allocation = 0`).

---

### MEDIUM

#### M-1 · No graduation venue module can return what its venue did not consume

**`src/factories/erc404/LiquidityDeployerModule.sol:374-376, :397-401`** (Uniswap v4),
**`src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol:211-212`**,
**`src/factories/erc404cypher/CypherLiquidityDeployerModule.sol:174, :209-224`**.

One defect with three instances, reported together because the fix is shared. Each module hands its
venue the whole LP leg and has no path to recover the remainder. Exhaustively verified across all
three: the only value-out paths are `deployLiquidity`, `flushPendingVaultCut` (which pays only a
previously-stashed amount) and `unlockCallback` (unreachable outside a graduation — `_ctx` is
deleted after `unlock`). Every owner-gated function is a setter that moves nothing. All three end
in a bare `receive()`. **There is no sweep, not even an owner-only one.**

The ordinary case is dust — 243 wei of ETH and 97 wei of coin on a 25-ETH graduation, so the
hunters' "leaks on every graduation" framing is wrong and is struck. The attacker case is real and
costless: pre-`initialize` needs no liquidity at all on v4 and Algebra, and only dust on ZAMM.

| venue | stranded (attacker case, 25 ETH raise / 20 ETH LP leg) | cap |
|---|---|---|
| **Uniswap v4** | **0.394 ETH = 197 bps**, or 19,900 coin = 198 bps | none — no min-amount check at all |
| ZAMM | 0.198 ETH = 99 bps, or 10,000 coin | `a0Min/a1Min` at 99% |
| Cypher | 0.200 WETH = 100 bps, or 10,000 coin | `amount0Min/amount1Min` at 99% |

v4 is the severe instance for two compounding reasons the hunt lanes did not connect. First,
`unlockCallback` has **no slippage floor**, so the tolerance band is its only cap, where both
siblings revert past 1%. Second, **the "1%" tolerance is 2% on price**:
`_requireSqrtPriceWithinTolerance:465-473` measures deviation on `sqrtPriceX96`, and price is its
square, so `MAX_INIT_PRICE_DEVIATION_BPS = 100` admits −1.99%/+2.01%. The 197 bps stranded is
exactly `d/(1+d)` for `d = 2.01%`. Same defect at `CypherLiquidityDeployerModule.sol:311-318`;
ZAMM compares reserve *ratios* and so its 1% really is 1%, which is why it strands half as much.

Nobody's fee leg pays for this — protocol still takes its 1%, the vault its 19%, the creator the
full carve. The loss falls entirely on the graduated pool's depth, permanently, because the LP is
locked forever.

**Not defended.** `test/security/GraduationFrontRunGuard.t.sol` covers a benign same-price pre-init
and a grossly-skewed one; its v4 arm never calls `deployLiquidity`. No test anywhere asserts a
post-graduation module balance. The inside-tolerance-but-not-exact case — the only one that strands
anything — is untested on all three venues.

**The fix is not an owner sweep.** `test/factories/LpLockInvariant.t.sol:44` deliberately pins the
*absence* of removal entry points on these modules, and a sweep on a singleton that custodies
graduation ETH is a new trust surface. Fix it in-transaction: measure actual consumption (v4's
settled delta, ZAMM's discarded return values, Cypher's `mint` return), route the remainder back
onto the existing 80/19/1 rail as a second `excessEth` leg, and return unspent coin to the instance.
Then apply the tolerance to price, or halve the constant, so the band matches its label.

**Proof:** `test/audit/GraduationLpResidue.t.sol` — 5 failing across the three venues, plus a
passing `test_v4_tolerance_isTwoPercentOnPrice` and a passing `test_v4_strandedEth_hasNoExit`.

#### M-2 · A conversion's unabsorbed ETH is owned by nobody, and mints shares for someone else

**`src/vaults/uni/UniAlignmentVault.sol:441-496`** — zeroing at `:470`, dust at `:473-474`,
orphaning at `:495`.

`_distributeSharesAndCleanup` sets `pendingETH[b] = 0` for every participant, then sets
`totalPendingETH = ethUnabsorbed`. The carry has no owner. The next batch mints shares against it,
the attribution loop can only cover `sum(pendingETH) < ethToAdd`, and the shortfall lands in
`accumulatedDustShares` — which is handed to *that* batch's `largestContributor`.

At the worst price the oracle floor permits (`maxPriceDeviationBps = 500`, so a swap may legally
return 95% of TWAP-fair): Alice contributes 100 ETH and **2.5 ETH is orphaned** with her
`pendingETH` at 0. In the next batch Mallory's fair share is 190.0e18 LP units and she receives
191.1875e18 — a **1.1875e18-unit windfall funded entirely by Alice's ETH**. Alice's share count
never moves.

This is not wei-dust and it is steerable: `convertAndAddLiquidity` is permissionless, so a
sandwicher can push the swap to the 95% floor to maximise the orphan, then be the next batch's
largest contributor and collect it.

The ZAMM sibling already solves this correctly — `ZAMMAlignmentVault.sol:398-439` carries the
residual back as per-benefactor `pendingContribution[b]` and settles the remainder on `dustTaker`,
so "no wei of pendingETH is left unowned". That is the reference implementation for the fix.

**Why no invariant caught it:** `test/invariant/UniVaultInvariant.t.sol` runs against
`TestableUniAlignmentVault`, whose `_addToLpPosition` hardcodes `ethDeposited` to the whole ETH leg
(`test/helpers/TestableUniAlignmentVault.sol:39-54`). `ethUnabsorbed` is *structurally* always zero
there, so `invariant_pendingSumConsistency` cannot see this.

**Proof:** `test/audit/UniVaultShareAccounting.t.sol` — 2 failing.

#### M-3 · One unguarded owner call bricks every fee path on a live Uni vault

**`src/vaults/uni/UniAlignmentVault.sol:940-944`.** `setV4PoolKey` has no "liquidity already
deployed" lock and does not reset `lastTickLower/Upper` or `totalLPUnits`. The ZAMM sibling has
exactly that guard — `ZAMMAlignmentVault.sol:325-326` reverts `PoolKeyLocked()` once
`principalInvariant != 0`.

The brick is real, but not for the reason first filed: v4's `checkTicks`
(`lib/v4-core/src/libraries/Pool.sol:94-98`) validates only ordering and MIN/MAX, never tick-spacing
divisibility. What reverts is `Position.update`'s `CannotUpdateEmptyPosition`
(`lib/v4-core/src/libraries/Position.sol:83-85`) on the zero-`liquidityDelta` fee poke of an empty
position — which fires for **any** key rotation, same spacing or not, because the new poolId's
position is empty. `unlockCallback` reads the *current* key, so `_claimVaultFees` pokes the new pool
at the old ticks.

`claimFees`, `claimFeesAsDelegate` and `convertAndAddLiquidity` all then revert with the same
selector `0xaefeb924`, stranding the benefactors' 80% leg. Measured: 20 ETH locked, 10e18 shares
outstanding, all three paths dead.

Medium rather than High because it is owner-only and **reversible** — rotating the key back
restores every path, which the proof also demonstrates. It remains a one-call, no-guard, silent
total DoS of the benefactor leg with no on-chain warning.

**Proof:** `test/audit/UniVaultPoolKeyRotation.t.sol` — 1 failing, 1 passing recovery test, against
a real in-memory v4-core `PoolManager`.

#### M-4 · A migrated vault traps the alignment hook's queued fees forever

**`src/factories/erc404/hooks/UniAlignmentV4Hook.sol:203-214, :220-227`.** Confirmed independently
by two judges.

`queuedFees` has exactly one exit: an uncaught call into `vault`, which is `immutable` — as are
`benefactor` and `hookFeeBips`. The hook's entire owner surface is `setLpFeeRate`. There is no
sweep, no pause, no re-point.

The vault's intake **can** close permanently: `AlignmentEndowmentVault.sol:335` reverts
`VaultMigrated` unconditionally, and `migrated = true` is one-way (`:844`), set by `migratePosition`
— the vault's own documented Aave-reserve-deprecation emergency. Nothing re-opens it. After that,
the hook keeps taxing every swap and 100% of the take falls into `queuedFees`, unreachable and
growing without bound.

Held at Medium because the hook ships **off**: `alignmentHookFactory` defaults to `address(0)` and
enabling it is a deliberate governed call (`LiquidityDeployerModule.sol:531`). But it is not dead
code — `docs/phases/vault-flavors.md:203` lists Uni V4 as the default flavor with "Yes — perpetual.
Every swap taxes `hookFeeBips` of the ETH leg → alignment vault, forever." The trap needs a governed
enable plus a governed migrate, and the owner intends neither consequence; the ETH is real user swap
tax with no exit.

The existing coverage only ever exercised a *transient* revert — the RealSettlement test `vm.etch`es
a working vault over the reverting one before flushing. The permanent case was uncovered.

Note the asymmetry that shows this was an oversight rather than a decision: the deployer module's
own retry lane gates on `isVaultRegistered`, so an operator can clear a stashed cut with
`deactivateVault`. The hook has no such gate and `deactivateVault` does nothing for it.

**Proof:** `test/audit/HookQueuedFeesMigratedVault.t.sol` — against a real vault, real hook and real
in-memory `PoolManager`. Rewritten around the fix (branch `hook-queued-fees-exit`): 3 passing. The
reproduction is unchanged through the trap, and the tail now walks the runbook that releases it.

#### M-5 · An unbounded anti-snipe buffer can lock a winning bidder's ETH for a century

**`src/factories/erc721/ERC721AuctionInstance.sol:169-170, :321-324`.**

The anti-snipe rule is an **absolute reset**, not an increment:
`auction.endTime = uint40(block.timestamp) + timeBuffer`. The implicit invariant
`timeBuffer <= baseDuration` is enforced nowhere — not in the instance constructor
(`InvalidTimeBuffer` checks `!= 0` only), not in `ERC721AuctionFactory._deployInstance:115`, which
forwards the parameter raw, and not in the app (`projectTypes.ts:359` sets `min: 1` and no max). So
the *first* bid on a fresh auction resets `endTime` to `now + timeBuffer`.

The bidder has no exit. The instance has no cancel, withdraw or rescue; `settleAuction:348` and
`reclaimUnsold:426` both gate on `endTime`, and `reclaimUnsold` additionally rejects a live
`highBidder`. The only refund path is a strictly-higher bid from a third party — which locks the
volunteer instead and re-arms the clock.

Measured: posted end 3,599 seconds away; actual end after the first bid **3,153,600,000 seconds —
100 years**. A plausible misconfiguration (a one-year buffer on an auction advertised as one day)
rolls forward indefinitely: 665 days and counting in the proof.

The creator gains nothing — the 80% leg only pays at settlement, a century away. This is a pure
foot-gun that irreversibly locks *other people's* funds, and the realistic trigger is not malice
but reading "anti-snipe buffer" as "how long a fresh bid keeps the auction alive".

Fix is one line in the constructor: `if (p.timeBuffer > p.baseDuration) revert InvalidTimeBuffer();`

**Proof:** `test/audit/AuctionTimeBufferLock.t.sol` — 4 passing tests. The proof was rewritten once
the fix merged (PR #424): the two tests that built the century and the one-year buffer now assert the
constructor's refusal, and two more run the same bid-and-rescue sequence at the largest legal buffer
(`timeBuffer == baseDuration`) to show what the bound buys — every reset is capped at one
`baseDuration` from the bid, and the auction settles. The absence of a withdraw path is unchanged and
was never the defect; the unbounded wait was.

---

### LOW

**L-1 · CREATE3 addresses can be squatted, and the ERC404 factory previews the wrong one.**
`ERC404Factory.sol:590-591` and the six sibling factories. CreateX's guard for this salt shape is
`keccak256(abi.encode(salt))` with no `msg.sender` term — the extra hash in `senderBoundSalt =
keccak256(abi.encodePacked(msg.sender, salt))` is what *destroys* the sender binding, since the
pseudorandom top bytes never match `SenderBytes.MsgSender`. An attacker recomputes it from public
calldata and squats for **122,814 gas**, reverting the victim's `createInstance`. Not High: the
victim retries with a fresh salt (proven), the wizard already draws a CSPRNG salt, and the four
*vault* factories are `onlyOwner`. Handing CreateX the raw salt shaped as
`bytes20(caller) || 0x00 || entropy` is unsquattable — and is exactly the formula
`computeInstanceAddress:777-780` already assumes. Which is the **adjacent real bug**: that preview
uses the permissioned guard while `deployCreate3` takes the Random path, so it returns an address
CreateX will never use, and no test asserts otherwise. Proof: `test/audit/CreateXSaltSquat.t.sol`.

**L-2 · `renounceRoles` can destroy `PROTOCOL_ROLE` with no way back.** `ERC404Factory.sol:250-259`
hardens `grantRoles`/`revokeRoles` against exactly this, but solady's public `renounceRoles` is
inherited unmodified. One call kills all six admin levers for every address including the owner.
The hardening's existence is what makes the un-overridden sibling a defect — the code states an
invariant and then leaves a hole in it. Proof: `test/audit/AccessControlCluster.t.sol`.

**L-3 · The four vault factories sit outside the project's own no-renounce policy.**
`SafeOwnableUUPS.sol:15-23` covers the nine UUPS contracts; the vault factories — which *own* every
vault they deploy — keep one-step `transferOwnership` and a reachable `renounceOwnership`. A renounce
permanently kills `setVaultPoolKey`, without which an unwired Uni vault can never LP. Proof: same
file.

**L-4 · A documented treasury setter that no address can call.** `ZAMMAlignmentVault.sol:622`
`setProtocolTreasury` is `onlyOwner`, the owner is the factory, and the factory exposes no
passthrough — while the vault's docstring at `:143-144` promises "only `setProtocolTreasury` moves
the destination". `CypherAlignmentVault.sol:119` promises a setter that **does not exist on the
contract at all**; Uni likewise has none. (The related `DeployCore` `setZQuoter` instruction was
already fixed in `13f4b10b`.) Proof: same file.

**L-5 · The zRouter fork dropped Curve exact-out's `+1` rounding buffer.**
`src/peripherals/zRouter.sol:551, 553, 559, 561, 572, 576, 580` — upstream
`lib/zRouter/src/zRouter.sol` ends all seven with `+ 1`. Curve's `get_dx` rounds down, so every
exact-out Curve route under-quotes by one wei per hop and reverts `Slippage()`. Low only because no
live path reaches it: `BestRouteAcquirer` never dispatches `AMM.CURVE`, nothing in `src/` or the app
calls `swapCurve`, and mainnet uses the canonical upstream router. It is a latent availability bug
in a contract this protocol does publish on testnet. Proof:
`test/audit/CurveExactOutRoundingBuffer.t.sol` — isolates it by showing exact-in still works.

**L-6 · The alignment hook does not bind its pool key.** `UniAlignmentV4Hook.sol:132-138` checks only
`currency0 == address(0)`, so anyone can initialize a second ETH-paired pool on a launch's hook —
confirmed with no revert and no gate. It drains nothing: the hook's `take` is charged back to the
rogue pool's own swapper via the returned delta, proven to the wei (crediting the benefactor 0.1 ETH
cost the attacker 3.61 ETH), and the credit goes to the launch's fixed benefactor, never the
attacker. A donation surface, not a farm — worth binding for hygiene. Proof:
`test/audit/HookSecondPoolNotBound.t.sol`.

**L-7 · The price validator's proportion guards are inert for the positions the vaults actually use.**
`UniswapVaultPriceValidator.sol:324-339`. Both vaults are full-range, and a full-range position is
50/50 at every price, so the deviation guard and the `[35,65]` clamp cannot fire — measured worst
deviation across the realistic band is 5.45e-15 against a 5e16 threshold, ten orders of magnitude of
headroom. Two things keep this at Low rather than Medium. The code already **states the theorem**
at `:353-358` and explains that the validator is shared and must stay correct for bounded ranges —
and that is true: the clamp does bind for bounded ranges and at the tails of the tick range, so the
hunters' "never binds at any magnitude" is struck. And the inertness is protective: sizing is
price-independent, so manipulating spot buys nothing here. The vault's real anti-manipulation
control is `_floorTokenOut` → `quoteEthForTokensVia`. The "NO fail-open" promise holds — it was
always about the pinned-pool quote path, which reverts rather than returning zero. Proof:
`test/audit/PriceValidatorFullRangeInertGuards.t.sol`.

**L-8 · No minimum TWAP window.** `AlignmentRegistryV1.setReferencePool:490-505` validates target,
token, pool code, kind and probes the oracle, but never the window magnitude; `twapWindow = 1` turns
the vaults' only real price floor into a manipulable spot read. Owner-set, and a bad window is a
subset of a bad pin — but it touches a promise the code makes elsewhere:
`CypherAlignmentVault.sol:37, :256` both say "deep, owner-pinned, unmanipulable TWAP". One-line fix:
a `MIN_TWAP_WINDOW` floor.

**L-9 · `zRouter`'s value-moving hatches are unauthenticated.** `sweep:915`, `execute:1025`,
`snwap:1045`, `revealName:1270`. All four reach only the router's own resting balance, and nothing
rests there: balances are transient-tracked and every leg ships output to `to` in the same
transaction. No protocol contract holds a standing approval — the vaults approve the exact swap
amount immediately before an exact-in swap that consumes it. `execute` is gated on
`_isTrustedForCall`, a map written only by `trust()` which **nothing in this repo ever calls**, so it
is inert as deployed. Two sub-claims are **struck**: `amountLimit == 0` is unreachable from any
vault (`convertAndAddLiquidity` rejects a zero floor and `_floorTokenOut` raises it), and the
"`deadline == type(uint256).max` silently switches venue" claim is factually wrong — the sentinel
exists in `swapV2` and `swapVZ`, and both cited vault lines call `swapV4`, which has no sentinel.

**L-10 · The LP vaults never re-credit the token-side residual.** `UniAlignmentVault.sol:421-437`
and `ZAMMAlignmentVault.sol:387-392` measure and re-credit unconsumed ETH but abandon unconsumed
alignment token. `_convertVaultFeesToEth` is driven by the collected fee amount and never reads the
vault's own token balance, so the residue accretes monotonically with no path out — 2.5e18 → 5.0e18
across two 100-ETH batches at a 5% swap surplus, ~0 at honest prices. An unowned-balance leak, no
theft and no DoS.

**L-11 · A renounced launch opens its pool off curve parity.** `LiquidityDeployerModule.sol:421`
(and ZAMM `:181`, Cypher `:152`) force `carve = 0` when `p.creator == address(0)`, but
`ERC404BondingOps.sol:710` does not — so the instance sized `tokensForPool` at parity for a larger
ETH leg than the module then uses, the pool opens above the curve's last price, and
`GraduationEthDiverted` misreports. Reachable because `ERC404BondingInstance` inherits plain solady
`Ownable` and never overrides `renounceOwnership`, though graduation then needs a pre-configured
agent. No ETH is stranded or burned — the zero-address guard is itself correct. One-line fix belongs
in `ERC404BondingOps.deployLiquidity`: zero `carveEth` when `owner() == address(0)`.

---

### INFO

Recorded because each is a true statement about the code that a later reader would otherwise have
to rediscover. None is a defect worth a fix on its own.

- **A comment promises a guarantee the code does not deliver.** `AlignmentRegistryV1.sol:341-344`
  says a pinned payout means "a stolen owner key finds no call that redirects a curated community's
  yield", and presents the registry's own UUPS upgrade as the exhaustive carve-out. But
  `AlignmentEndowmentVault._targetSink()` resolves the registry **live**, and
  `MasterRegistryV1.setAlignmentRegistry:106-111` is a bare `onlyOwner` address write that
  re-points payout, ambassador **and** curation for every endowment vault at once. This is a
  documentation and monitoring defect, not a control defect: both registries are `SafeOwnableUUPS`
  handed to the *same* Timelock (`script/MigrateOwnership.s.sol:66-75`), so it is the same
  principal the comment already concedes can upgrade the registry — no new capability, no lower
  bar. What is genuinely wrong is the operational instruction: the comment says the redirect is
  visible "as an upgrade", so a monitor built on that sentence watches `Upgraded` on
  `AlignmentRegistryV1` and misses `AlignmentRegistrySet` on `MasterRegistryV1` entirely. Fix the
  comment; add the second event to the watchlist.
- **A migrated vault also stalls the deployer's tithe retry lane**, but unlike M-4 it has an escape:
  `flushPendingVaultCut` gates on `isVaultRegistered`, and the Timelock that calls `migrateVault`
  can call `deactivateVault` to clear every stashed cut back to the instance's creator. An
  undocumented runbook step, not a trap. Add it to the migration runbook.
- **`_realizeImpairment` has no dust tolerance** (`AlignmentEndowmentVault.sol:787-795`): ERC-4626
  floor rounding can make a healthy position read `basis - 1`, emitting `ImpairmentRealized(0 bps)`
  and reclassifying 1 wei of principal as yield. The write-down is the correct action under the
  stated policy, and no consumer of the event exists in the app.
- **`MetadataOverlayModule._onlyInstanceOwner/_onlyHolder`** resolve authority through a
  caller-supplied `inst` with no registry check. Driven end to end: a fake instance can publish
  waves and set commissions, but state is namespaced, `configured[fake]` stays false (so indexers
  can filter), and the unlock accounting balances to the wei — the attacker funds a row they could
  have written directly. Event pollution. One `isRegisteredInstance` check would close it.
- **The endowment credits any contract as a benefactor but can only pay one exposing `owner()`**
  (`:340` vs `:573-574`). Self-inflicted and already documented at `:327-328`. The undocumented half
  is worth a line: `owner()` is read **live**, so selling a graduated launch transfers every
  unclaimed wei of accrued creator yield to the buyer.
- **Clone initializers are first-caller-wins**, safe only because every factory deploys and
  initializes in one call and CreateX gives no reentrancy window. Worth keeping named, because
  `_effectiveCarve` trusts whatever `factory` a clone recorded.
- **Staking stream dust is unreachable** (`ERC404StakingModule.sol:217`): the truncation remainder
  is booked to `stakingReserve` but never streamed and never captured as `streamLeak`. Bounded at
  604,799 wei per `claimAllFees` — locking a single gwei takes ~1,654 fee sweeps. The rounding
  direction is the safe one. The code already concedes the over-estimate at
  `ERC404BondingOps.sol:541-542`.
- **A zero-value ambassador `execute` remains callable on an emptied or migrated vault**
  (`:969`). Already named, tested and reasoned about in
  `test/vaults/aave/AlignmentEndowmentVaultSplitLaw.t.sol:596`. With zero value, no approvals beyond
  WETH→stataToken, and the alignment registry now denied as a target (`4497a641`), the surface is
  inert.
- **`ERC1155Instance` can be constructed with a zero protocol treasury** (`:593`), whose 1% leg is
  then computed, marked spent and dropped — unlike `ERC721AuctionInstance:167`, which rejects zero
  outright. Reachable only in a window between two statements of `DeployCore`. Worth a constructor
  check for parity.
- **`QueryAggregator.getERC1155EditionsBatch:1215-1220`** reintroduces the `nextEditionId() - 1`
  underflow guarded 30 lines away, and is the only batch entry point not bounded by
  `MAX_QUERY_LIMIT`.
- **`FrontendRegistry.removeEnsName:79-93`** leaves `nodeRelease[node]` set — an orphan pointer on
  an unmanaged node.
- **Coverage gap, no defect:** there is no Uni-side regression test for the conversion participant
  cap; only the ZAMM one exists (`test/security/Finding1_UnboundedArray.t.sol`).

---

### Struck — and why it matters that they were

The skeptic pass removed far more than it kept. The ones worth recording, because each looked like a
real finding and a future reader will re-derive it:

- **The endowment accumulator's flooring division** — filed Medium, would have stranded the entire
  80% creator leg at a floor-priced pool. **Already fixed** by `16515bf2` (PR #418) the day before
  the hunt's base: `_creditCreatorLeg` pools the leg with `creatorYieldRemainder`, credits what the
  division carries, holds the rest, and charges the counter at the *ceiling*. Residual is bounded
  under 1 gwei on a 1-ETH pool by a committed invariant.
- **`ProtocolOwnedLiquidityV1.receivePOL` settling from the shared balance** — fixed by
  `fd0e023b`/`e20ccd86`; `msg.value` must now equal the native leg exactly and the remainder is
  refunded. Also has no production caller.
- **A ZAMM `feeOrHook` forwarded as an arbitrary hook address** — the most alarming filing in the
  set. Struck: the canonical quoter hardcodes four literal fee tiers (`zQuoterBase.sol:38-45`) and
  never enumerates hooked ZAMM pools, the quoter address is `onlyOwner`, and no caller-supplied path
  to that word exists. Worth a one-line range check for parity with the V3/V4 branches.
- **UUPS implementations and clone implementations left seizable** — real, and reaches nothing.
  Solady's `upgradeToAndCall` carries `onlyProxy` and reverts on the implementation before
  `_authorizeUpgrade` runs; neither contract has `selfdestruct` or `delegatecall`; and an EIP-1167
  clone delegatecalls into the implementation's *code*, never its storage. Adding
  `_disableInitializers()` is hygiene.
- **Free ERC1155 claims ratcheting the paid price curve** — intended. The reserve-from-supply
  contract is enforced on both paths, so a free claim consumes a unit of scarcity and `minted` is
  the scarcity cursor by design; not advancing it would systematically *under*-price the scarcity
  the creator created.
- **The overlay tithe folding into the artist's payout below 0.001 ETH** — the mechanism and the
  test that pins it are both real, but there is no 19% promise on that surface to contradict:
  `Payout.ARTIST` pays the artist 100% with no tithe at all, so the evasion motive is empty. The
  honest liveness fallback beats reverting the holder's unlock or stranding wei.
- **Participant-cap griefing on the alignment vaults** — the accepted bound biting as designed.
  Every production caller already wraps the tithe in `try/catch` with retry escrow (seven call
  sites), the cap clears on any permissionless conversion, and the attacker's 0.5 ETH is permanently
  donated with no withdraw path. The attacker pays the victim.
- **Featured-queue squatting** — a squatter pays the treasury to put their rival *into* the featured
  set, and `boostRank`/`renewDuration` stay permissionlessly open throughout. Proven: the rival buys
  rank and a fan extends the slot during the squat.
- **Auction queue spam** — the stated harm is backwards. The queue is strictly FIFO so spam lands
  *behind* the creator's own pieces, and every spam piece is funded by the spammer's `msg.value` and
  refunded to the creator. Agents are a Timelock-appointed role, not attacker-reachable.
- **Reentrancy, anywhere** — none live. Solady's fixed-slot guard makes the instance-side and
  Ops-side `nonReentrant` the *same* lock across the delegatecall boundary, and every trampoline
  carries it on exactly one side.
- **The ERC404 `onERC721Received`-mid-buy hazard** — does not exist. DN404's coin path carries no
  receiver hook at all; the only hook is `DN404Mirror.safeTransferFrom`, post-settlement.
- **A 1:1 aToken assumption in the endowment** — not made. It re-derives from
  `convertToAssets(balanceOf)` on every read.
- **Unchecked arithmetic, casts and assembly** — a full census was taken: 21 `unchecked` blocks, 85
  narrowing or sign-crossing casts, 39 `assembly` blocks, and every non-constant denominator proven
  non-zero. The ERC404 `uint32` band-id surface is airtight in both directions (the factory rejects
  `idEnd > type(uint32).max` before narrowing, and DN404 independently caps `idLimit`).
- **The bonding curve's buy/sell round trip** — exactly neutral. `calculateCost` and
  `calculateRefund` are the same expression over a pure integral, so there is no free-money mint and
  no slicing arbitrage. Graduation front-running loses 3.1%–17% because the 20% tithe *is* the
  slippage bound.

---

## 3. Proofs of concept

Thirteen proofs sit under `contracts/test/audit/`. They are **not** in the default test set, for two
independent reasons recorded in `foundry.toml`'s `skip` list and in `foundry.audit.toml`:

1. Three drive v4-core's real `PoolManager`, whose pragma is exactly `0.8.26`, and the default
   profile is deterministically pinned to `0.8.28` for deploy-determinism (noesis-120). This is the
   same constraint that already put `UniAlignmentV4Hook_RealSettlement.t.sol` behind
   `foundry.v4.toml`.
2. The proofs for open defects **fail on purpose** — they assert the property the code should hold.
   A red test in the default set would make the contracts gate report a failure the gate did not
   cause, and a gate that is red for a known reason stops being read.

Run the whole set:

```
cd contracts && FOUNDRY_CONFIG=foundry.audit.toml forge test --match-path "test/audit/*"
```

| proof | reproduces | state |
|---|---|---|
| `FreeMintCurveSolvency.t.sol` | H-1 | **3 fail**, 1 control passes |
| `GraduationLpResidue.t.sol` | M-1 | **5 fail** (v4 ×2, ZAMM ×2, Cypher ×1), 3 pass |
| `UniVaultShareAccounting.t.sol` | M-2 (and strikes C, D) | **2 fail**, 2 pass |
| `UniVaultPoolKeyRotation.t.sol` | M-3 | **1 fail**, 1 recovery test passes |
| `HookQueuedFeesMigratedVault.t.sol` | M-4 | 3 pass (the trap, its exit, and the halted tithe) |
| `AuctionTimeBufferLock.t.sol` | M-5 | 4 pass (assert the merged guard, and the bounded lock) |
| `CreateXSaltSquat.t.sol` | L-1 | 7 pass (squat, recovery, wrong preview) |
| `AccessControlCluster.t.sol` | L-2, L-3, L-4 | passes |
| `CurveExactOutRoundingBuffer.t.sol` | L-5 | 2 pass (isolates the missing wei) |
| `HookSecondPoolNotBound.t.sol` | L-6 | passes (shows it drains nothing) |
| `PriceValidatorFullRangeInertGuards.t.sol` | L-7 | 3 pass (inert, and where it *does* bind) |
| `OverlayFakeInstance.t.sol` | Info (overlay) | 3 pass (attack works, value conserved) |
| `QueueSpamAndSquatDisproof.t.sol` | the strikes | passes — evidence for what was struck |

**When a fix lands, delete that proof's line from `skip` in `foundry.toml`** so it joins the default
set and the gate keeps it honest. A proof left skipped is a fix nobody verified.

Whole-set result on this branch: **36 passed, 12 failed** across 16 suites. The twelve failures
are the twelve reproductions; nothing else in the set is red. The recorded output is below.

```
Ran 4 tests for test/audit/FreeMintCurveSolvency.t.sol:FreeMintCurveSolvencyTest
[PASS] test_control_noFreeMint_lastCohortExitsWhole()
[FAIL: reserve fell below what curve buyers paid in, with no curve buyer having sold:
       14363869285800511043 < 25000000000000000178] test_freeMintDrainsTheReservePaidBuyersFunded()
  ETH paid in by curve buyers:   25.000000000000000178
  ETH extracted by free claimers: 10.636130714199489135
  reserve left for paid buyers:   14.363869285800511043
[FAIL: the last paid cohort cannot exit at the price it entered at:
       10854415633947537141 < 19859325867669882025] test_lastPaidCohortCannotExitAtItsEntryPrice()
[FAIL: paid coin outstanding exceeds totalBondingSupply: the tail cannot be sold at all:
       4000000000000000000000000 > 3000000000000000000000000] test_residualPaidCoinIsUnsellable()

test/audit/GraduationLpResidue.t.sol
[FAIL: graduation must not leave ETH in the deployer module: 394079011861582438 != 0]
  ETH for pool: 20.0   stranded in module: 0.394079011861582438   = 197 bps of LP ETH
[FAIL: ZAMM's ETH refund must not be stranded: 198019801980198020 != 0]   = 99 bps
[FAIL: unconsumed WETH must not be stranded: 200000000000000000 != 0]     = 100 bps
[PASS] test_v4_freshPool_leavesNoMeaningfulResidue()   fresh-pool residue: 243 wei
[PASS] test_v4_tolerance_isTwoPercentOnPrice()
[PASS] test_v4_strandedEth_hasNoExit()

test/audit/UniVaultShareAccounting.t.sol
[FAIL: UniAlignmentVault:495 - carried residual has no owner: 0 != 2500000000000000001]
[FAIL: UniAlignmentVault:476-483 - mallory took shares she did not fund:
       191187500000000000118 > 190000000000000000009]
  mallory windfall: 1.1875e18 LP units, funded entirely by alice's orphaned 2.5 ETH

test/audit/UniVaultPoolKeyRotation.t.sol
[FAIL: convertAndAddLiquidity bricked by unguarded setV4PoolKey (:940-944)]
  claimFees / claimFeesAsDelegate / convertAndAddLiquidity all revert 0xaefeb924
  totalEthLocked stranded: 20.0 ETH        totalShares: 10e18
[PASS] test_B_rotatingBackRestoresTheVault()

test/audit/HookQueuedFeesMigratedVault.t.sol   (as first recorded, before the fix)
[FAIL: swap-tax ETH queued against a migrated vault has no exit]
  ETH trapped in the hook after 4 post-migrate swaps: 0.040000000000000000

test/audit/HookQueuedFeesMigratedVault.t.sol   (as it stands, on `hook-queued-fees-exit`)
[PASS] test_migratedVault_queuedFeesHaveAnExit_andTheTitheStops()
  ETH recovered from the hook: 0.030000000000000000
[PASS] test_rescue_refusesAnyDestinationTheRegistryDoesNotCurate()
[PASS] test_resumeTithe_restoresTheTitheWhenTheVaultIsRegisteredAgain()

test/audit/AuctionTimeBufferLock.t.sol   (as first recorded, before PR #424 merged)
[PASS] test_A_hundredYearTimeBuffer_locksWinningBidderETH()
  posted end, seconds away, BEFORE the bid: 3599
  actual end, seconds away, AFTER  the bid: 3153600000   (100 years)

test/audit/AuctionTimeBufferLock.t.sol   (as it stands, against the merged guard)
[PASS] test_A_hundredYearTimeBuffer_isRefusedAtConstruction()
[PASS] test_A_plausibleMisconfig_oneYearBufferOnADayAuction_isRefused()
[PASS] test_A_atTheMaximumLegalBuffer_theLockIsBoundedByOneBaseDuration()
[PASS] test_A_rollForward_survivesTheFixButIsBoundedPerBid()
```

---

## 4. Disposition

The line is careful: nothing here is merged. Every item below is either a branch with a PR open for
rth's hand, or a named question for his ruling.

Two of the five Mediums carry fixes, chosen because each is a single guard with a sibling in this
same tree that already has it — so the fix is a consistency repair rather than a new design:
**#423** (`uni-vault-poolkey-lock`) and **#424** (`auction-timebuffer-bound`). Both are green on the
full contracts gate. The other three, and the High, turn on decisions that are rth's rather than an
auditor's, and are named below with the shapes each could take.

### The one High

**H-1 (free-mint curve solvency) is named for rth's ruling, not fixed on a branch.** This is the
deliberate choice and the reason is that the two available fixes are different products, not
different implementations:

- **(a) Lock free-minted coin from `sellBonding` until graduation.** The tranche keeps its
  marketing function — holders get the NFT, the art, the tier — and loses its exit. Paid buyers are
  made whole. It changes what a free mint *is* for every creator who has been told the allocation is
  theirs to give away freely.
- **(b) Count the tranche into `totalBondingSupply` at claim.** The curve prices it as supply, so it
  costs paid buyers nothing — but it moves every subsequent buyer up the curve, which changes the
  raise a creator gets for a given allocation, and a 10% allocation becomes a visible ~10% price
  step rather than an invisible 42.5% exit haircut.
- **(c) Bound the allocation** so the extracted share stays under a stated tolerance, and keep the
  current behaviour below that bound.

Each of those is an economic decision about what the protocol sells, and the realm's own record
shows this class of question going to rth rather than to an auditor. What is *not* a judgment call,
and should happen whichever way he rules:

1. `app/src/lib/learn/concepts.ts:141` currently tells creators the ERC-404 allocation is "genuinely
   held back… so paid buyers cannot eat into the free allocation." That sentence is false today.
   Under (a) it becomes true; under (b) or (c) it must be rewritten.
2. `docs/spec/BONDING_CURVE_ARITHMETIC.md:233-237` sizes the effect at 62% for a 10% allocation; the
   measured figure is 42.5%.
3. `test/invariant/BondingCurveInvariant.t.sol:175` should stop asserting
   `freeMintAllocation == 0` once the configuration is defended, so the solvency invariants actually
   cover it.

**No High is left both unfixed and unruled:** H-1 is named here for rth's ruling, with the failing
proof committed and the three options costed.

### The five Mediums

| # | finding | disposition |
|---|---|---|
| M-1 | graduation modules cannot return unconsumed LP capital (v4 197 bps) | **rth's ruling.** The fix routes the remainder back onto the 80/19/1 rail in-transaction and touches all three venue modules plus the tolerance constant. An owner sweep — the obvious shortcut — is forbidden by `LpLockInvariant.t.sol`'s `RemovalProbe` on purpose, so this needs a shape decision before code. The tolerance half (apply the band to price, or halve the constant) is a one-line change that can ship first and independently. |
| M-2 | Uni vault conversion residue is unowned and mints shares for the wrong benefactor | **rth's ruling.** `ZAMMAlignmentVault.sol:398-439` is the reference implementation — carry the residual as per-benefactor `pendingContribution[b]` and settle the remainder on a `dustTaker`. Porting it also requires fixing `TestableUniAlignmentVault` so `invariant_pendingSumConsistency` stops being vacuous. |
| M-3 | `setV4PoolKey` bricks every fee path on a live vault | **fixed — branch `uni-vault-poolkey-lock`, PR #423.** Ports the `PoolKeyLocked()` guard the ZAMM sibling has carried since it was written, against this vault's own `totalLPUnits`. Wiring an unwired vault is untouched; both halves are pinned by tests. |
| M-4 | a migrated vault traps the hook's queued fees forever | **fixed — branch `hook-queued-fees-exit`.** Both named shapes, arranged so neither adds a way to take the money. The hook now holds the master registry and answers to `deactivateVault`, the same lever `flushPendingVaultCut` already reads: `haltTithe()` is permissionless and stops the tax the moment the registry drops the vault, so nothing further is charged for a destination that no longer exists. `rescueQueuedFees(address)` is the owner's, but its destination must be a vault the registry currently curates and the credit goes to the hook's own immutable `benefactor` — so the owner chooses which curated vault, never whether to take it. Both refuse while the vault is still registered. |
| M-5 | unbounded anti-snipe buffer locks a bidder's ETH | **fixed — branch `auction-timebuffer-bound`, PR #424.** `timeBuffer <= baseDuration` in the constructor, inclusive, so nothing legal is narrowed; every auction in the tree and both seed scripts already sit far under it. A `max` on the wizard field is still owed. |

### Lows and Infos

None carries a branch. Each is stated above with its file:line and, where the fix is a one-liner,
the line. The four worth doing soonest, because they are cheap and each closes a promise the code
itself makes: **L-4** (a docstring promising a setter no address can call), **L-8** (a
`MIN_TWAP_WINDOW` floor), **L-2** (override `renounceRoles`), and the `AlignmentRegistryV1` comment
under INFO that sends a monitor to watch the wrong event.

### What this audit does not cover

Stated plainly so the gap is not mistaken for a clean bill:

- **No fork testing.** `noesis-249` deferred a fork suite before mainnet, and that deferral stands.
  Every proof here runs against mocks or an in-memory PoolManager, so real Aave, real Uniswap v4 and
  real Algebra behaviour on a live chain is unverified by this pass.
- **The `deep` fuzz/invariant profile was not run.** It has no selector and is entry 2 of
  `docs/PRE-MAINNET-CHECKLIST.md`; no pass/fail number for it is quoted here.
- **One deploy-config question surfaced and was not chased**, because it belongs to whoever owns
  that lane: `script/DeploySepolia.s.sol:158-159` states that `0x0000…F600e4` — the same address
  `script/DeployMainnet.s.sol:25` pins as the mainnet zRouter — predates `swapVZ`, so every ZAMM leg
  reverts `Unauthorized()`. If that address is a canonical CREATE2 singleton, the bytecode is
  identical on both chains, which would mean the ZAMM family's **mainnet** acquisition path is
  broken on day one. Either the two chains hold different builds — in which case "canonical
  singleton" is the wrong description and the mainnet pin needs verifying against `swapVZ`'s
  selector — or this is a real day-one defect. Worth one person's afternoon before any mainnet
  deploy.

### Gate

Run on this branch at the merge with `main`:

```
cd contracts && forge fmt --check && forge build && \
  bash test/factories/erc404/eip170-diet-gate.sh && FOUNDRY_PROFILE=ci forge test
```

- `forge fmt --check` — clean
- `forge build` — exit 0
- EIP-170 diet gate — PASS (`ERC404BondingOps` 23,715B, headroom 861B against a 500B floor)
- `FOUNDRY_PROFILE=ci forge test` — **2549 passed, 0 failed, 29 skipped**, 233 suites

The audit proofs are excluded from that set by design and run under their own config; see §3.
