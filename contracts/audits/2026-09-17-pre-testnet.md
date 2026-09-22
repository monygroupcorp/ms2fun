# ms2fun contracts — pre-testnet security audit

**Date:** 2026-09-17
**Scope:** every production contract under `contracts/src`, excluding `interfaces/`, `lib/`,
`mocks/`, `test/`, `*.t.sol` and `*Mock*.sol` — 62 files, 21,399 lines as counted at the base below.
That sentence is also a command, `contracts/audits/map-coverage.sh`, which fails naming any in-scope
file this report does not name; see §1.5 for what it counts today and why the two numbers differ.
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


### 1.5 Coverage — every in-scope file, and where it is mapped

§§1.1–1.4 are organised by the thing that holds value, not by file, which is the right shape for
reading but leaves "every contract is mapped" as an assertion. It is a command now:

```
cd contracts && bash audits/map-coverage.sh
```

It applies this report's own scope sentence — every `.sol` under `src/` that is not in
`interfaces/`, `lib/`, `mocks/` or `test/` and is not a `*.t.sol` or `*Mock*.sol` — and fails naming
any file whose declared identifiers appear nowhere above. **66 files in scope on 2026-09-20; 0
unmapped.** (The header's "62 files, 21,399 lines" was counted by hand at the audit base `238b0131`
and does not reproduce from the sentence beside it; the script is the definition from here on, and
the same filter counts 65 files at that base. One file has been added to `src/` since: `SafeOwnable`,
by L-2's own fix.)

Fifteen files reached §§1.1–1.4 only through a category word — "the four vault factories", "support
surfaces that hold no user funds" — and are named here so the check passes on substance rather than
on a keyword. They are grouped by what they can do to money.

**Moves ETH, and was unnamed.**

- `src/libraries/SmartTransferLib.sol` — **the tree's shared ETH payout primitive, and the single
  most-used one**: `smartTransferETH` is called at 29 sites across both bonding instances, the 1155
  and 721 instances, all three LP-fee vaults, `DeployBondEscrow`, `FeaturedQueueManager` and
  `PromotionBadges`. §1.3 describes these legs as "raw `.call{value:}`", which is what they were
  before this library; what they do now is try `SafeTransferLib.trySafeTransferETH(to, amount,
  gasleft())` and, if that fails, wrap to WETH and send the ERC-20 instead, reverting only if both
  fail. Two properties follow and belong in the map: every payout leg **forwards all remaining gas**
  to an address the payee controls, so every call site depends on its own checks-effects-interactions
  ordering rather than on a gas stipend; and a payee cannot brick a leg by refusing ETH, which is the
  adoption-gap the library exists to close. The sites spot-checked on 2026-09-20
  (`UniAlignmentVault:709`, `ERC1155Instance:744`) zero or advance their state before the call, and
  the second is `nonReentrant`.
- `src/treasury/ProtocolTreasuryV1.sol` — the sink §1.1 refers to as `src/treasury/`. Holds protocol
  revenue; `withdrawETH`, `withdrawERC20` and `withdrawERC721` are all `onlyOwner` (T0), and it
  accepts ERC-721 `safeTransfer`. No permissionless exit, and nothing else in the tree reads its
  balance.

**Deploys or parameterises something that moves ETH.**

- `src/vaults/uni/UniAlignmentVaultFactory.sol`, `src/vaults/cypher/CypherAlignmentVaultFactory.sol` —
  two of the "four vault factories" at T1. `deployVault` is `onlyOwner`; the factory owns every vault
  it deploys, so the vault's own `onlyOwner` setters (`setVaultPoolKey`, `setVaultPriceValidator`,
  `setVaultMaxPriceDeviationBps`, `setVaultDustDistributionThreshold`) are reachable only as
  passthroughs here. That ownership is what makes L-4 a finding about the ZAMM sibling: a setter the
  vault documents but no factory exposes is a setter no address can call.
- `src/factories/erc404/hooks/UniTitheHookFactory.sol` — **the one unnamed contract with a
  permissionless entry point that deploys fee-taking code.** `deployHook` is callable by anybody and
  every argument is theirs, including `vault`, `benefactor` and `hookFeeBips`; it mines a CREATE2 salt
  so the hook address carries exactly the `0xCC` v4 permission bits, and keys adoption on the
  init-code hash over all nine constructor arguments. That keying is what makes the open door
  harmless, and it is the same mechanism L-6's fix leans on: since #429 the parameterization names the
  pool too, so a hook deployed ahead for different arguments is a different hook at a different
  address, and a graduation either adopts exactly the hook it would have mined or mines its own. A
  caller who deploys ahead can hand a graduation its hook; they cannot hand it one bound elsewhere.
  The file carries its own `RE-AUDIT BEFORE DEPLOY` banner, which stands — it is not discharged by
  this report, and §"What this audit does not cover" is where that belongs.

**Holds no value, moves nothing.**

- `src/factories/erc404/ERC404BondingStorage.sol` — the bonding instance's storage layout plus the
  `IStakingTotals` read interface. No `.call{value:}` and no token transfer anywhere in it; it is
  where `ERC404BondingInstance` and `…Ops`, both mapped above, keep their state.
- `src/metadata/TierRevealModule.sol`, `src/metadata/TokenTierBandResolver.sol` — the tier/reveal
  readers behind the resolver router §1.3 already maps. Read-only.
- `src/libraries/MessageTypes.sol` — eleven lines of constants for `GlobalMessageRegistry`.
- `src/libraries/v4/CurrencySettler.sol`, `src/libraries/v4/LiquidityAmounts.sol` — vendored Uniswap
  v4 helpers. In scope only because the scope line excludes `lib/` and these sit under `libraries/`;
  they are upstream code, unmodified, exercised through the v4 paths already mapped.
- `src/factories/erc404/hooks/IAlignmentHook.sol`,
  `src/factories/erc404/hooks/IAlignmentHookFactory.sol`, `src/gating/IGatingModule.sol`,
  `src/gating/IMerkleGatingModule.sol` — interfaces that sit outside an `interfaces/` directory and so
  are not caught by the scope line's directory exclusion. Declarations only.

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

**Ruled, 2026-09-17.** The finding above is as it was found, and the sentence in it that no longer
holds is the one about `decisions.log`: the ruling now exists. The free-mint tranche is a design
decision, accepted as designed and not a defect — the mechanism stands, and what was owed was
describing it honestly on the three surfaces that did not. See §4.

`test/audit/FreeMintCurveSolvency.t.sol` stays as written and stays skipped, and that is now a
different thing from the other skipped proofs: it does not await a fix, because there will not be
one. It asserts a solvency property the owner has ruled the protocol does not offer, so it is a
record of the mechanism and not a defect ticket. The proofs that measure the ruled behaviour and run
*inside* the gate arrive with #430 — `BondingCurveFreeMintInvariant.t.sol` and
`FreeMintReserveDrain.t.sol`.

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
Rewritten onto the fixed behaviour when the fix landed (PR #434) and out of `foundry.toml`'s skip
list: 14 tests, of which 9 of the 10 that still compile against the pre-fix source fail there. The
tenth is the guard that no removal path was added, and it passes on both sides on purpose.

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

That was the half this audit found. Fixing it turned up a second, larger one underneath: **no
conversion had ever run in that suite at all.** The setup wires no reference pool, so
`_floorTokenOut` reverts `NoReferencePool` and every `convertAndAddLiquidity` call in the run
reverts — measured at 18,125 reverts out of 18,239 calls. Every invariant in the file that only says
something after a conversion was holding over a vault that had never converted anything. One of them,
`invariant_noDilutionInversion`, turns out not to be a property of this vault at all: it compared
lifetime converted ETH against share counts across batches, but shares are LP *units* and the
liquidity minted per ETH differs per batch, so the ordering it asserted is false by construction. It
failed the moment the path went live. That is the claim being wrong, not the code.

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
a real in-memory v4-core `PoolManager`. That is the proof as filed; it was rewritten against the
merged guard and now asserts the defect closed. See §3.

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

**L-12 · The Cypher vault never re-credits the token-side residual either, and L-10's fix did not
reach it.** `CypherAlignmentVault.sol:484` (the leg sized from the collect's return) against
`:294, :302-303, :349-351` (the ETH side of the same rounding, which *is* handled). Filed after the
rest of this section, by re-reading L-10 as a shape rather than as its two sites — see the note
below.

`convertAndAddLiquidity` buys `targetReceived` and offers the whole of it to the Algebra position
manager, which pulls only what its ratio needs at `amount0Min`/`amount1Min` of zero. The ETH half of
that rounding is handled: `_addToPosition` unwraps `ethForLP - wethUsed` back to native ETH and
`:294` carries it in `totalPendingETH`. The token half is dropped, and the contract says so in its
own words at `:302-303` — *"Leftover target dust remains as tokens in the vault."*

That dust has no reader. `_harvestAccruedFees` is the only leg in the contract that ever sells
alignment token and it sizes the swap from the collect's return alone; the next convert does not
re-offer the residue either, because `forceApprove` grants the position manager exactly the new buy;
and the vault's whole external surface is six value-moving entry points and two owner setters, none
of which moves alignment token. So it accretes on every convert with no path out. Same severity as
L-10 and for the same reasons: an unowned-balance leak, no theft and no DoS.

**Measured** at a 20% under-absorption on a 10 ETH tithe: **1.0e18 stranded after one convert,
2.1e18 after two**, with the harvest realising none of it. Against the fix the vault holds only the
latest convert's 1.1e18 and the harvest realises it onto the 80/19/1 rail.

**Never defended, and the fixture is why.** `test/vaults/CypherAlignmentVault.t.sol`'s
`test_convert_residualEthReturnsToPending` drives exactly this case — `setAbsorbBps(8000)`, one
convert — and asserts only the ETH half. The mock's `absorbBps` defaults to full absorption and no
Cypher test ever moves it, so the residue a real pool leaves was structurally invisible to the
suite. That is the same fixture shape L-10's fix had to repair on the Uni side, in the same words.

**This is §3's L-9 lesson landing a second time, and that is the point of recording it as its own
finding rather than as a sentence under L-10.** §3 says L-9 was reported by the hatch and the hatch
was the symptom, and tells whoever re-reads §2 to read every finding as naming a SHAPE. L-10 was
filed as "the LP vaults" and its row names two files; its fix is a faithful two-file fix; and the
third vault of that family — mapped in §1.3 on the line directly below its two siblings — was never
asked the question. The shape is **a leg sized from what an external call returned, where the
contract's own balance is the true amount**, and the sweep for it is cheap: every `collect`,
`remove` or `mint` return that feeds a swap or a transfer.

**Proof:** `test/audit/CypherVaultTokenResidue.t.sol` — 5 tests, in the default set. Three go red on
the numbers above if the balance read is reverted; two pass on both sides on purpose (the guard that
the sweep adds no removal path, and the control that the measurement is of the mechanism and not of
the fixture).

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

`contracts/test/audit/` holds nineteen files here and twenty once L-12's branch lands. Eighteen are
this audit's — thirteen written with the hunt, five added by the fixes that followed, and L-12's
written by the fix that follows this revision — and `SlitherSuppressionCensus.t.sol` predates it
(2026-08-20) and only shares the directory.

**Fifteen of them run in the default test set**, and that is the change since this section was first
written. It then described a set wholly outside the gate, because at that point every proof for an
open defect failed on purpose. As each fix landed its proof was rewritten from recording the defect
to asserting it closed, and its line was deleted from `foundry.toml`'s `skip`. That migration is
finished; four files remain outside the default set, and their two reasons are no longer symmetric.

1. **Pragma, not state.** Three drive v4-core's real `PoolManager`, whose pragma is exactly `0.8.26`,
   while the default profile is pinned to `0.8.28` for deploy-determinism (noesis-120) — the same
   constraint that already put `UniAlignmentV4Hook_RealSettlement.t.sol` behind `foundry.v4.toml`.
   All three pass. They are excluded for what they import, not for what they assert, and because no
   job selected that config, nothing caught them going red on their own — which is exactly what
   happened. PR #445 (merged) put two of them into the `real-settlement` CI job and left the third
   out by name, because it was the one that had already gone red — the subject of the note below.
   **That third one is in the job now**, on this branch, which is what makes its rewrite something
   a job will keep honest rather than something the next reader has to re-check by hand. The job's
   path is now the whole `skip` list bar `FreeMintCurveSolvency.t.sol`, which compiles under the
   default profile and is out for the other reason entirely.
2. **Ruled, not open.** `FreeMintCurveSolvency.t.sol` asserts a solvency property the protocol does
   not offer, and after the 2026-09-17 ruling it never will. It is the one proof here not waiting on
   a fix, and its `skip` line must not be deleted: that would make the contracts gate permanently red
   for a mechanism the protocol sells deliberately. What measures that mechanism *inside* the gate is
   `test/invariant/BondingCurveFreeMintInvariant.t.sol` and
   `test/factories/erc404/FreeMintReserveDrain.t.sol`, both landed with #430.

The four the gate does not cover, and the whole set, run under the companion config:

```
cd contracts && FOUNDRY_CONFIG=foundry.audit.toml forge test --match-path "test/audit/*"
```

Measured on the current tree. "in the gate" means the file is in the default set, so every
`forge test` and every contracts gate run keeps it honest:

| proof | reproduces | in the gate | measured |
|---|---|---|---|
| `AccessControlCluster.t.sol` | L-2, L-3, L-4 | yes | 12 pass |
| `AuctionTimeBufferLock.t.sol` | M-5 | yes | 4 pass |
| `CreateXSaltSquat.t.sol` | L-1 | yes | 6 pass |
| `CurveExactOutRoundingBuffer.t.sol` | L-5 | yes | 3 pass |
| `CypherVaultTokenResidue.t.sol` | L-12 | yes | 5 pass |
| `FreeMintCurveSolvency.t.sol` | H-1 | **no — ruled** | 1 pass, **3 fail by design** |
| `GraduationLpResidue.t.sol` | M-1 | yes | 15 pass (v4 9, ZAMM 3, Cypher 3) |
| `HookQueuedFeesMigratedVault.t.sol` | M-4 | no — pragma | 3 pass |
| `HookSecondPoolNotBound.t.sol` | L-6 | no — pragma | 3 pass |
| `OverlayFakeInstance.t.sol` | Info (overlay) | yes | 3 pass |
| `PriceValidatorFullRangeInertGuards.t.sol` | L-7 | yes | 3 pass |
| `PriceValidatorSpotTwapBand.t.sol` | L-7 (the fix) | yes | 8 pass |
| `QueueSpamAndSquatDisproof.t.sol` | the strikes | yes | 3 pass |
| `ReferenceTwapWindowFloor.t.sol` | L-8 | yes | 5 pass |
| `RenouncedLaunchPoolParity.t.sol` | L-11 | yes | 2 pass |
| `SlitherSuppressionCensus.t.sol` | — (predates this audit) | yes | 1 pass |
| `UniVaultPoolKeyRotation.t.sol` | M-3 | no — pragma | 3 pass |
| `UniVaultShareAccounting.t.sol` | M-2, L-10 (and strikes C, D) | yes | 5 pass |
| `ZRouterHatchAuth.t.sol` | L-9 | yes | 13 pass |
| `ZRouterRefundBoundedToOwnChange.t.sol` | L-9, second pass | yes | 5 pass |

Whole set on this branch: **21 suites, 98 passed, 3 failed** of 101 tests. The three failures are
H-1's, and they are the only red left in this directory. Inside the default set the seventeen suites
these files produce run 88 tests, all green. L-12's branch adds the twentieth file and its five
tests to both figures; the measurement with it is under L-12's disposition row in §4.

### L-9's fix was not complete, and the proof that says so was written after this report

`ZRouterRefundBoundedToOwnChange.t.sol` is the one row above that measures a defect this report did
not name. It belongs to L-9 and it is the reason that finding gets a second row rather than a footnote:
the L-9 pass authenticated the four hatches this audit named — `sweep`, `execute`, `snwap`'s
zero-`amountIn` branch, `revealName` — and did not reach the four swap legs that end in a refund of
exactly the same shape. `swapV3`, `swapV4`, `swapVZ` and `swapCurve` each read the router's WHOLE
resting balance at the end of an exact-out hop and sent it to `msg.sender`, so the guard on `sweep`
was walkable: a caller `sweep` refused could buy the cheapest fill they could construct and be handed
the same balance back as change. `swapV2` is the counter-example that makes it a slip rather than a
policy — its refund was bounded by the caller's own input all along. Fixed on `main` (`b530f871`);
each refund is now the leg's own change, measured against a baseline drawn before the leg touches
anything.

Recorded here because the lesson is about this audit's method and not about the router: **L-9 was
reported by the hatch, and the hatch was the symptom.** The finding's shape — an unauthenticated read
of a resting balance — had four more instances one call-graph hop away, in functions the report had
already walked for other reasons. A finding stated as a list of sites invites a fix that is a list of
sites. Whoever re-reads §2 should read every one of its findings as naming a SHAPE, and ask what else
in the tree has it.

**When a fix lands, delete that proof's line from `skip` in `foundry.toml`** so it joins the default
set and the gate keeps it honest. A proof left skipped awaiting a fix is a fix nobody verified. H-1's
is the exception and the only one: it is skipped because it is ruled, not because it is open.

### One proof had gone stale against its own fix

Worth recording, because it is the failure mode the rule above exists to prevent and the rule could not
catch it. `UniVaultPoolKeyRotation.t.sol` (M-3) is pragma-skipped, so deleting its `skip` line was
never available, and no job selected `foundry.audit.toml` — so nothing ran it. Its fix (#423, guard
commit `98aa634b`) merged two minutes BEFORE the audit that carried the proof (#422), and the file has
not been touched since it was added, so on `main` this proof has never once been meaningful: it arrived
already reverting `PoolKeyLocked()` — the guard the fix added, hit by a proof still trying to
demonstrate the defect. It was failing *because the fix worked*, which is evidence of nothing.

It is rewritten against the fix, the same move every other proof made, and against the real
`PoolManager` that is the reason this file exists at all — `test/vaults/UniAlignmentVault.t.sol` pins
both halves of the guard against a mock and cannot show the fee poke landing on a real v4 position.
Three tests: the rotation is refused once a real position is live **and the stored key does not move**;
after a refused rotation `convertAndAddLiquidity` still succeeds, so the poke lands and
`Position.CannotUpdateEmptyPosition` — the selector the finding measured — is unreachable rather than
merely unhit; and wiring a vault that holds no position is still open, at a tick spacing of 200 rather
than 60, which also disposes of the theory the hunt raised and discarded, that the brick was tick
spacing failing to divide the stale ticks. Both claim paths are exercised by callers the access check
lets THROUGH — the benefactor for `claimFees`, her registered delegate for `claimFeesAsDelegate` —
because a caller turned away at the door never reaches the poke and so proves nothing about it; the
door is asserted shut against a stranger in the same test.

Neutering the one-line guard turns all three red — checked on 2026-09-20 by replacing
`UniAlignmentVault.sol:1009` with a comment and re-running: `0 passed; 3 failed`, restored after.

**And it is in a job now.** The rewrite alone would have left the file exactly where it was — correct,
green, and read by nothing — which is the condition that produced the staleness in the first place.
`test/audit/UniVaultPoolKeyRotation.t.sol` is added to the `real-settlement` job's `--match-path` on
this branch, the job PR #445 built for the other two, and the comment above that job now states the
rule positively: the path is the whole `skip` list bar the one file skipped for a non-pragma reason,
so a proof added to that list for a pragma reason is unrun until it is added here too.

### State as first recorded

The block below is what each proof printed when its finding was filed, and where a fix followed, what
it printed after. It is kept as the evidence for the findings — the failing output is the measurement.
It is a historical record, not the current state: except for H-1's, none of these failures reproduces
on the tree today. The table above is what runs now.

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

test/audit/GraduationLpResidue.t.sol   (as first recorded, before the fix)
[FAIL: graduation must not leave ETH in the deployer module: 394079011861582438 != 0]
  ETH for pool: 20.0   stranded in module: 0.394079011861582438   = 197 bps of LP ETH
[FAIL: ZAMM's ETH refund must not be stranded: 198019801980198020 != 0]   = 99 bps
[FAIL: unconsumed WETH must not be stranded: 200000000000000000 != 0]     = 100 bps
[PASS] test_v4_freshPool_leavesNoMeaningfulResidue()   fresh-pool residue: 243 wei
[PASS] test_v4_tolerance_isTwoPercentOnPrice()
[PASS] test_v4_strandedEth_hasNoExit()

test/audit/GraduationLpResidue.t.sol   (as it stands, on `main`)
[PASS] test_v4_preInitWithinTolerance_returnsUnconsumedEthToTheRail()
[PASS] test_v4_preInitWithinTolerance_returnsUnconsumedCoinToTheInstance()
[PASS] test_v4_venueTakingUnder99Percent_revertsRatherThanStranding()
[PASS] test_v4_venueChargingMoreThanTheLeg_reverts()
[PASS] test_v4_initPriceBand_isOnePercentOnPrice()      <- was 2% on price at a constant labelled 1%
[PASS] test_v4_initPriceBand_acceptsJustInside()
[PASS] test_v4_freshPool_leavesNoResidue()
[PASS] test_v4_stillHasNoRemovalPath()                  <- re-checked after a front-run graduation
[PASS] test_v4_sweepUnconsumedCoin_sendsItToTheInstance()
[PASS] test_zamm_preSeedWithinTolerance_returnsRefundedEthToTheRail()
[PASS] test_zamm_preSeedWithinTolerance_returnsUnpulledCoinToTheInstance()
[PASS] test_zamm_sweepUnconsumedCoin_sendsItToTheInstance()
[PASS] test_cypher_venueAbsorbsLessThanSent_returnsBothSides()
[PASS] test_cypher_initPriceBand_isOnePercentOnPrice()
[PASS] test_cypher_sweepUnconsumedCoin_sendsItToTheInstance()

test/audit/UniVaultShareAccounting.t.sol   (as first recorded, before the fix)
[FAIL: UniAlignmentVault:495 - carried residual has no owner: 0 != 2500000000000000001]
[FAIL: UniAlignmentVault:476-483 - mallory took shares she did not fund:
       191187500000000000118 > 190000000000000000009]
  mallory windfall: 1.1875e18 LP units, funded entirely by alice's orphaned 2.5 ETH

test/audit/UniVaultShareAccounting.t.sol   (as it stands, on `uni-vault-conversion-residue`)
[PASS] test_A1_carriedResidualIsOwnedByItsContributor()
  carried totalPendingETH (wei)  : 2500000000000000001
  alice pendingETH after convert : 2500000000000000001      <- the whole carry, remainder included
[PASS] test_A2_carriedEthBuysSharesForItsOwner()
  alice ETH carried from batch 1 : 2500000000000000001
  alice  FAIR (carried/batchEth) : 1187500000000000000
  alice  ACTUAL                  : 1187499999999999824      <- her carry now buys her own shares
  mallory FAIR (400/batchEth)    : 190000000000000000009
  mallory ACTUAL                 : 189999999999999999815    <- was 191187500000000000118

test/audit/UniVaultPoolKeyRotation.t.sol   (as first recorded, before PR #423)
[FAIL: convertAndAddLiquidity bricked by unguarded setV4PoolKey (:940-944)]
  claimFees / claimFeesAsDelegate / convertAndAddLiquidity all revert 0xaefeb924
  totalEthLocked stranded: 20.0 ETH        totalShares: 10e18
[PASS] test_B_rotatingBackRestoresTheVault()

test/audit/UniVaultPoolKeyRotation.t.sol   (as it stands, rewritten against the merged guard)
[PASS] test_B_rotationIsRefusedOnceARealV4PositionIsLive()
  totalLPUnits after convert #1 : 5000000000000000000
[PASS] test_B_theFeePokeStillLandsAfterARefusedRotation()
  totalLPUnits after convert #2 : 10000000000000000000     <- the poke landed on a real position
  claimFees revert data          : 0x846d8c5c              <- NoFeesToClaim, not CannotUpdateEmptyPosition
  claimFeesAsDelegate revert data: 0x846d8c5c              <- NoFeesToClaim, not CannotUpdateEmptyPosition
      (both callers are ones the access check lets THROUGH, so each reaches the poke before it
       refuses; a caller turned away at the door would prove nothing. The door is asserted shut
       separately, in the same test, against a stranger.)
[PASS] test_B_wiringAVaultThatHoldsNoPositionIsStillOpen()
  totalLPUnits on keyB (spacing 200): 10000000000000000000

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

test/audit/CypherVaultTokenResidue.t.sol   (as first recorded, against `main` at 3886044c)
[FAIL: the residue has a reader: the harvest sells it: 1000000000000000000 != 0]
       test_A_convertResidueIsSweptByHarvest()
  alignment token left in the vault by one convert: 1000000000000000000
  ETH the harvest realised from the residue:        0
[FAIL: round two strands its own 1.1e18 and no more: 2100000000000000000 != 1100000000000000000]
       test_B_residueDoesNotAccreteAcrossConverts()
  residue after convert 1: 1000000000000000000
  residue after convert 2: 2100000000000000000     <- round one's is still underneath it
[FAIL: the whole residue is realised: 0 != 1000000000000000000]
       test_E_sweptResidueSplitsEightyNineteenOne()
[PASS] test_C_noEntryPointHandsAlignmentTokenToAnybody()   <- passes on both sides, on purpose
[PASS] test_D_control_fullAbsorptionStrandsNothing()       <- passes on both sides, on purpose

test/audit/CypherVaultTokenResidue.t.sol   (as it stands, on `audit-l12-cypher-token-residue`)
[PASS] test_A_convertResidueIsSweptByHarvest()
  alignment token left in the vault by one convert: 1000000000000000000
  ETH the harvest realised from the residue:        1000000000000000000
[PASS] test_B_residueDoesNotAccreteAcrossConverts()
  residue after convert 1: 1000000000000000000
  residue after convert 2: 1100000000000000000     <- only round two's own; round one's was swept
[PASS] test_C_noEntryPointHandsAlignmentTokenToAnybody()
[PASS] test_D_control_fullAbsorptionStrandsNothing()
[PASS] test_E_sweptResidueSplitsEightyNineteenOne()
  protocol leg (1%):      10000000000000000
  target leg (19%):      190000000000000000
  benefactor leg (80%):  800000000000000000
```

---

## 4. Disposition

The line is careful: nothing merges without rth's hand. Every item below is either a branch with a
PR — open, or merged by him since — or a named question for his ruling.

**As of 2026-09-20 every PR this section names has been merged by him.** Checked with `gh pr view`
against each number below: #423, #424, #426, #427, #428, #429, #430, #431, #432, #434, #435, #436 and
#445 are all `MERGED`, and the one High is ruled. One PR was opened against this disposition
since, #461 for L-12 — filed on 2026-09-21 by re-reading L-10 as a shape — and it merged the same
day, so the sentence above holds for it too; see the Lows table. What is otherwise left open is
clause 5 of this audit's own goal — rth's go/no-go on `testnet-deploy` clause 1 — and the items
§"What this audit does not cover" names as out of scope.

All five Mediums now carry fixes. Two of them were written with the audit, because each is a single
guard with a sibling in this same tree that already has it — a consistency repair rather than a new
design: **#423** (`uni-vault-poolkey-lock`) and **#424** (`auction-timebuffer-bound`). The other
three turned on decisions that were rth's rather than an auditor's, were named here with the shapes
each could take, and were then taken: **#427** (M-2), **#426** (M-4) and **#434** (M-1). The High is
still a ruling and is still unfixed, deliberately — see below. Every branch is green on the full
contracts gate.

### The one High

**H-1 (free-mint curve solvency) was named for rth's ruling rather than fixed on a branch, and on
2026-09-17 he ruled: the free-mint tranche is a design decision, accepted as designed and not a
defect.** Nothing under `src/` changes, and none of the three shapes below was taken. They are kept
here because they are what the ruling was made against — the question was which product the protocol
sells, not which implementation is correct:

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

Each of those was an economic decision about what the protocol sells, which is why the finding went
to rth rather than being settled by an auditor. What was *not* a judgment call was the three
surfaces that described the mechanism wrongly or not at all, and a ruling of "as designed" is what
makes describing it correctly the whole of the work. All three are done on branch
`h1-free-mint-made-true`, **PR #430**:

1. `app/src/lib/learn/concepts.ts:141` told creators the ERC-404 allocation is "genuinely held back…
   so paid buyers cannot eat into the free allocation" — true of supply, silent on ETH, and it
   presented ERC-404 as the protected case while warning in detail about the ERC-1155 effects. It
   now states the sizing, that circulating coin permanently exceeds what the curve can redeem by the
   amount claimed, and that the resulting shortfall can leave paid buyers unable to sell at any
   price.
2. `docs/spec/BONDING_CURVE_ARITHMETIC.md:233-237` sized the effect at 62% for a 10% allocation
   against a measured 42.5%. §7 now carries the sizing table, the band endpoints, the closed form,
   the circulation identity, and the command that produces every number.
3. `test/invariant/BondingCurveInvariant.t.sol:175` asserted `freeMintAllocation == 0`, so the two
   strongest solvency invariants in the tree had never been evaluated against a configuration a
   creator can select at create. The allocation is on there now, and a dedicated
   `BondingCurveFreeMintInvariant.t.sol` runs the spec's 10% at production curve parameters —
   `reserve == balance` and `reserve == F(totalBondingSupply)` both hold at zero tolerance over free
   coin, and the excess of circulating coin over tracked supply is asserted rather than avoided.

**No High is left both unfixed and unruled:** H-1 is ruled — designed, not a defect — with the proof
that measures it committed, the three options it was ruled against costed above, and the three
surfaces that misdescribed it corrected on #430.

### The five Mediums

| # | finding | disposition |
|---|---|---|
| M-1 | graduation modules cannot return unconsumed LP capital (v4 197 bps) | **fixed — branch `graduation-lp-residue`, PR #434.** All three venue modules now measure what their venue actually took — v4's settled delta, ZAMM's returned amounts, Cypher's `mint` return, all three of which were being discarded — and route the unconsumed ETH onto the 80/19/1 rail as a third diverted leg, reported apart from the caller's clamp residue because only the module can see it. Coin the venue declined goes back to the instance, which burns it under its own event topic: after graduation no path can move instance-held coin, so any other home is the same overhang at a different address. The init-price band is measured on PRICE on both v4 and Cypher, so the constant labelled 100 bps means it; and v4, which has no min-amount parameter to pass, asserts the siblings' 99% floor on the settled delta instead — with the ceiling they get for free from being pulled rather than pushed, both of them before the settle rather than after it. No removal entry point is added — the `RemovalProbe` still finds none, re-checked after a front-run graduation. The one backstop is `sweepUnconsumedCoin`, coin-only, permissionless and with no destination to choose, so it is not the owner sweep this row warned against and cannot touch the `pendingVaultCut` balance. Four fixtures had the strand written into them: the shared mock pool manager settled nothing by default, so suites read the module's retained balance as the pool's. |
| M-2 | Uni vault conversion residue is unowned and mints shares for the wrong benefactor | **fixed — branch `uni-vault-conversion-residue`, PR #427.** Ports `ZAMMAlignmentVault.sol:398-439` exactly: each benefactor's pro-rata share of the residual is carried back as their own `pendingETH`, they are re-registered as conversion participants, and the round-down remainder is settled on a `dustTaker` so `sum(pendingETH) == totalPendingETH` holds to the wei. The orphan the dust block used to hand a later batch's largest contributor no longer exists. The invariant suite is repaired on both counts — a reference pool so conversions actually run, and a settable absorption shortfall the fuzzer drives — and `afterInvariant` now asserts that coverage rather than assuming it. `invariant_noDilutionInversion` was restated: its cross-batch form is not a property of this vault. |
| M-3 | `setV4PoolKey` bricks every fee path on a live vault | **fixed — branch `uni-vault-poolkey-lock`, PR #423.** Ports the `PoolKeyLocked()` guard the ZAMM sibling has carried since it was written, against this vault's own `totalLPUnits`. Wiring an unwired vault is untouched; both halves are pinned by tests. This audit's own proof was **not** among them until now, and that is worth recording: `UniVaultPoolKeyRotation.t.sol` is skipped from the default set for the *pragma* reason rather than the fails-on-purpose one, so it ran in no job at all, and it went red the day the guard merged — still building the brick the guard makes unbuildable. It is rewritten onto the fix here: the rotation is refused, the stored key is unmoved, `convertAndAddLiquidity` still mints and both claim paths still reach the vault's own `NoFeesToClaim` rather than v4-core's empty-position selector. |
| M-4 | a migrated vault traps the hook's queued fees forever | **fixed — branch `hook-queued-fees-exit`, PR #426.** Both named shapes, arranged so neither adds a way to take the money. The hook now holds the master registry and answers to `deactivateVault`, the same lever `flushPendingVaultCut` already reads: `haltTithe()` is permissionless and stops the tax the moment the registry drops the vault, so nothing further is charged for a destination that no longer exists. `rescueQueuedFees(address)` is the owner's, but its destination must be a vault the registry currently curates and the credit goes to the hook's own immutable `benefactor` — so the owner chooses which curated vault, never whether to take it. Both refuse while the vault is still registered. |
| M-5 | unbounded anti-snipe buffer locks a bidder's ETH | **fixed — branch `auction-timebuffer-bound`, PR #424.** `timeBuffer <= baseDuration` in the constructor, inclusive, so nothing legal is narrowed; every auction in the tree and both seed scripts already sit far under it. A `max` on the wizard field is still owed. |

### Lows and Infos

Each is stated above with its file:line and, where the fix is a one-liner, the line. The four worth
doing soonest, because they are cheap and each closes a promise the code itself makes: **L-4** (a
docstring promising a setter no address can call), **L-8** (a `MIN_TWAP_WINDOW` floor), **L-2**
(override `renounceRoles`), and the `AlignmentRegistryV1` comment under INFO that sends a monitor to
watch the wrong event. Three of those four are fixed below; the `AlignmentRegistryV1` comment is the
one still open.

Every Low carries a branch and a PR, and the table below names both for each — twelve rows now, the
twelfth added on 2026-09-21. The Infos are
still as this report left them: no branch, and the file:line above is the whole of what exists.

| # | finding | disposition |
|---|---|---|
| L-1 | CREATE3 addresses can be squatted, and the ERC404 factory previews the wrong one | **fixed — branch `audit-l1-create3-preview`, PR #431, merged.** All seven CREATE3 factories stop hashing the caller *into* the salt — which is what dropped every one of them onto CreateX's unguarded `keccak256(abi.encode(salt))` path — and hand CreateX the shape it actually binds: `bytes20(address(this)) \|\| 0x00 \|\| bytes11(keccak256(creator, salt))`, through a shared `CreateXSalt` library. The creator still fills the entropy, so per-creator address separation is unchanged, and the address is now reachable by the factory alone. `0x00` rather than `0x01` in the 21st byte leaves `block.chainid` out of the hash, so a deterministic deploy stays deterministic across chains. The adjacent real bug goes with it: preview and deploy now derive the salt through the same call, so they cannot drift again. Note for whoever deploys next — this moves the address every factory resolves for a given `(creator, salt)`. Nothing in the tree pins a CREATE3 address, but a redeploy will not land where a previous one did. |
| L-2 | `renounceRoles` can destroy `PROTOCOL_ROLE` with no way back | **fixed — branch `audit-l2-l3-renounce-policy`, PR #428.** The override the factory was missing, beside the two it already carried: `grantRoles` and `revokeRoles` were both hardened against exactly this and solady's `renounceRoles` was inherited unmodified. The mask case goes with it — the role cannot be smuggled out inside a bigger one. The role is not frozen, only undestroyable; `transferProtocolRole` still hands it on. |
| L-3 | the four vault factories sit outside the project's own no-renounce policy | **fixed — branch `audit-l2-l3-renounce-policy`, PR #428.** The no-renounce half of `SafeOwnableUUPS` moves into a new `SafeOwnable` base; `SafeOwnableUUPS` extends it and keeps its own two-step-transfer half, and the four vault factories adopt it, so the nine UUPS contracts and the four factories now refuse for the same reason with the same error. Single-step `transferOwnership` is deliberately kept on the factories: `script/MigrateOwnership.s.sol` hands them to the governance Timelock with it, and a Timelock cannot broadcast solady's handover request leg without a governance proposal per contract. A test pins that the migration still works. |
| L-4 | a documented treasury setter that no address can call | **fixed — branch `audit-l4-l5-treasury-and-curve`, PR #435, merged.** `ZAMMAlignmentVaultFactory` gains `setVaultProtocolTreasury`, owner-gated beside the three passthroughs it already carries for this exact reason, so the lever the vault's docstring promises is reachable by the address the docstring implies. The destination is the protocol's own 1% treasury; a community's alignment sink is read live from the registry on every send and still has no setter anywhere in the tree. `CypherAlignmentVault.sol:119` carried the ZAMM sibling's sentence for a setter Cypher does not have at all — Cypher and Uni write the sink once at `initialize`, and Cypher's comment now says what Uni's already said. Whether Cypher and Uni should gain a setter is a separate question, left unruled and pinned as it stands. |
| L-5 | the zRouter fork dropped Curve exact-out's `+1` rounding buffer | **fixed — branch `audit-l4-l5-treasury-and-curve`, PR #435, merged.** Restored at each of the eight sites upstream carries it — including the `st == 4` inverse-of-`add_liquidity` line this report's list of seven omitted. Low for the reason stated above and no more: no live path reaches it. The proof pins that the buffer is a rounding repair and not a fee — a caller's `amountLimit` one wei below the quote still reverts `Slippage()`. |
| L-6 | the alignment hook does not bind its pool key | **fixed — branch `audit-lows-hook-validator-router`, PR #429.** The graduation pool becomes part of the hook's identity: `deployHook` takes the pool's `currency1` and tick spacing, both become hook immutables inside the init-code hash the factory mines, and the swap hooks refuse every other key. A hook for a different pool is therefore a different hook at a different address, so no rogue pool can bind first and an early `deployHook` caller can pre-empt nothing. `HookSecondPoolNotBound.t.sol` is rewritten against the fix: the rogue pool can still be initialized — `beforeInitialize` is not one of this hook's permission bits and adding it would move the address the hook must be mined to — but its first swap reverts and nothing leaves the PoolManager. |
| L-7 | the price validator's proportion guards are inert for the positions the vaults use | **fixed — branch `audit-lows-hook-validator-router`, PR #429.** The proportion guards are left exactly as they are: this report is right that they are correct and that they bind for bounded ranges. Added beside them is the guard that survives the position's shape — the caller's spot must sit within `maxPriceDeviationBps` of the V3 TWAP, measured on price and with the numeraire carried across first. `maxPriceDeviationBps` was a constructor argument the contract never read; it is read now, and its degenerate values are refused at deploy. Note for whoever reviews: this is a hard revert with no escape, the posture `CypherAlignmentVault._validateExistingPool` already takes, so a venue that has genuinely drifted past the band cannot convert until it re-converges. |
| L-8 | no minimum TWAP window | **fixed — branch `audit-lows-hook-validator-router`, PR #429.** `MIN_TWAP_WINDOW` is 300 seconds, checked on the RESOLVED window so the `0` shorthand is measured against the same floor as an explicit value. The default is 1800 and the shortest window pinned anywhere in this tree is 600, so nothing legal narrows. |
| L-9 | `zRouter`'s value-moving hatches are unauthenticated | **fixed — branch `audit-low-zrouter-hatch-auth`, PR #432.** Authenticated rather than closed, so the router keeps being a router: `sweep`, `snwap`/`snwapMulti`'s zero-`amountIn` branch and `revealName` may move what THIS transaction credited to the router, and the owner may move anything — which is what keeps a balance no credit describes recoverable rather than stranded. `execute` takes `onlyOwner` beside its trusted-target map, because it is an arbitrary call and no balance credit describes it; as deployed it is inert, so what that closes is what one future `trust()` call would otherwise open to every caller at once. **This fix was not complete, and that is recorded rather than quietly repaired:** the four swap legs that end in an exact-out refund read the router's whole resting balance and handed it to `msg.sender`, which made the `sweep` guard walkable by buying the cheapest fill one could construct. Fixed on `main` (`b530f871`), proof `ZRouterRefundBoundedToOwnChange.t.sol` — see §3. |
| L-10 | the LP vaults never re-credit the token-side residual | **fixed — branch `audit-l10-l11-residue-and-parity`, PR #436.** Both token→ETH legs now read the vault's own alignment-token balance rather than only the amount the collect returned, so the residue is sold and split 80/19/1 like any other yield. Reading the raw balance is safe because neither vault holds alignment token in flight at either call site: the Uni sweep runs in `_collectAndAccrueNow`, before `_doSwapAndLP` inside `convertAndAddLiquidity` and outside it on the claim paths; the ZAMM sweep runs in `_removeFeeLP`, before `_swapAndAddLiquidity` inside `convertAndAddLiquidity` and outside it on `harvest`. ZAMM's early return on zero fee growth is removed for the same reason — it gated the whole leg on fee LP existing, which is what let the residue survive every harvest that found no fees. One harness repair went with it: the testable Uni vault's mock LP never moved the token side, so it left the entire acquired amount behind — a balance no real pool leaves — and any reader of it saw a residue production never produces. |
| L-11 | a renounced launch opens its pool off curve parity | **fixed — branch `audit-l10-l11-residue-and-parity`, PR #436.** `LiquidityDeployerModule`'s zero-creator guard is correct and is untouched. What was missing is that `ERC404BondingOps.deployLiquidity` did not know about it: it sized `tokensForPool` at the curve's marginal price for a smaller ETH leg than the module then used, so the pool opened above the price the last curve buyer paid and `GraduationEthDiverted` reported a carve nobody received. The instance now takes the module's own rule and the two agree on the pool's ETH. One narrow case is named rather than left to be rediscovered: when the parity clamp fires the coin side is already at its maximum, and for a renounced launch the module's guard sends the leftover ETH into the pool, so that case is still fractionally above parity. This fix does not reach it and does not make it worse — the coin side is identical on both branches there. |
| L-12 | the Cypher vault never re-credits the token-side residual either | **fixed — branch `audit-l12-cypher-token-residue`, PR #461, merged.** L-10's repair in the third vault of the family: `_harvestAccruedFees` reads `IERC20(alignmentToken).balanceOf(address(this))` instead of the fee collect's return, so the amount an LP add declined is sold and split 80/19/1 with everything else. Reading the raw balance is safe for the reason it is safe in the two siblings — the vault holds no alignment token in flight at either call site, since this leg runs from `harvest` and as `receiveContribution`'s first effect and never inside `convertAndAddLiquidity`. No removal path is added: the residue is sold into the vault's own fee split, and that split pays ETH. Measured on that branch at a 20% under-absorption on a 10 ETH tithe — unfixed, 1.0e18 stranded after one convert and 2.1e18 after two with the harvest realising none of it; fixed, the harvest realises 1.0e18 onto the rail and two converts leave only the latest one's 1.1e18. Gate on the branch: `forge fmt --check` clean, `forge build` exit 0, EIP-170 diet gate PASS, `FOUNDRY_PROFILE=ci forge test` **2682 passed, 0 failed, 30 skipped** of 2712 across 249 suites (against `main`'s 2677 / 2707 / 248 — the difference is this branch's five tests), real-v4 leg 21 passed 0 failed. Those were the branch's numbers; since the merge the suite runs in the default set on `main`, where it is the 5 pass the proofs table records. |

Each carries a proof that measures the defect against this report's revision rather than asserting
it: `CreateXSaltSquat.t.sol` (L-1), `AccessControlCluster.t.sol` (L-2, L-3, L-4),
`CurveExactOutRoundingBuffer.t.sol` (L-5), `HookSecondPoolNotBound.t.sol` (L-6),
`PriceValidatorSpotTwapBand.t.sol` (L-7), `ReferenceTwapWindowFloor.t.sol` (L-8),
`ZRouterHatchAuth.t.sol` (L-9), `UniVaultShareAccounting.t.sol` (L-10),
`RenouncedLaunchPoolParity.t.sol` (L-11) and `CypherVaultTokenResidue.t.sol` (L-12). Five of them are
this audit's own reproductions, rewritten by the fix from recording the defect to asserting it
closed; the other five were written by the fixes themselves. Either way each PR names the assertions that are red without its source change, so none
of them can pass vacuously.

**All eleven are merged.** That sentence read "nine of the eleven" until 2026-09-20, when
`audit-l1-create3-preview` (L-1) and `audit-l4-l5-treasury-and-curve` (L-4, L-5) went in as #431 and
#435; checked with `gh pr view` against each number in the table.

**A twelfth arrived after that sentence was written, and the way it arrived is the point.** L-12 was
not found by a new hunt lane. It was found by taking §3's own instruction to read a finding as a
SHAPE and applying it to L-10 — "the LP vaults never re-credit the token-side residual", a finding
whose two sites became a two-site fix, in a family of three vaults §1.3 maps on consecutive lines.
The third had the defect. That merged on 2026-09-21 as #461, so all twelve rows are on `main` and
the row set owes nothing further. The method owes something larger: L-9 and L-10 have now each
been under-fixed in exactly the same way, by a fix that was as wide as the finding's list of sites
rather than as wide as its shape. Two instances is a pattern, and the remaining Mediums should be
re-read against it before testnet — M-1's "no path to recover what a venue did not consume" and
M-3's "an owner setter with no already-deployed lock" are both stated as a list of venues.

**Two things about this row set were only visible after the merges of 2026-09-20,** and neither is
readable from the rows above, so they are recorded here:

**The L-11 proof merged green on its branch and red on main.** `RenouncedLaunchPoolParity.t.sol`
passes at `b9905cbe`, the tip of `audit-l10-l11-residue-and-parity`, and both of its tests fail from
`c9ea5ffd` — the merge that brought it in — and at every commit after it, on a merge git had no
conflict to report. The two branches were each green alone: #436 was cut from a commit that did not
carry #434, and #434 made the shared mock charge for the liquidity it mints. So on main a venue takes
what it charges for, `LiquidityDeployerModule._returnResidue` moves the remainder out, and
`delivered == sized` is false by 2 wei. The fix was right and the assertion was stale, which is the
worse of the two ways for a proof to go red: for a day the tree carried a merged fix whose own proof
denied it. Repaired on #447 (`contracts-gate-red-on-main`), which admits the venue's integer-liquidity
residue, accounts for the declined leg exactly and bounds how much of the sized leg a venue may
decline at all — so the proof now asserts what L-11 actually promises instead of a wei-exact equality
the venue was never going to satisfy. It also asserts that nothing is stranded: the module holds no
ETH and no coin afterwards, and the instance holds exactly the gap, which is where a renounced
launch's residue is sent.

**The returned ETH leg was reported in no event.** `_returnResidue` force-transfers the unconsumed
ETH to the instance when `p.creator == address(0)`, then emitted `GraduationResidueReturned` with
`ethTithed` hard-coded to `0` on exactly that branch. That field is the tithed leg and this ETH was
returned rather than tithed, so it was correct in name and reported nothing; `coinReturned` carried
the coin side and the ETH side of the same residue appeared nowhere, leaving anyone reconciling where
a graduation's LP capital went to read it off a balance and trust that nothing else had paid the
instance. Nothing was lost, only unreported. Fixed on #450: all three venue modules emit
`GraduationResidueReturned(instance, ethTithed, ethReturned, coinReturned)`, exactly one of the two
ETH fields is non-zero for a given graduation, and a report summing the ETH a graduation diverted adds
`ethTithed` and must not add `ethReturned`, which was never levied on anyone.

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
  bash test/factories/erc404/eip170-diet-gate.sh && FOUNDRY_PROFILE=ci forge test && \
  FOUNDRY_CONFIG=foundry.v4.toml forge test --match-path test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol
```

- `forge fmt --check` — clean
- `forge build` — exit 0
- EIP-170 diet gate — PASS (`ERC404BondingOps` 23,655B, headroom 921B against a 500B floor)
- `FOUNDRY_PROFILE=ci forge test` — **2644 passed, 0 failed, 30 skipped**, 246 suites
- the real-v4 leg — **13 passed, 0 failed**, 3 suites

That was the audit branch at its merge, and it recorded the audit proofs as excluded from that set by
design. They are not any more: fourteen of the eighteen are in the default set and only four are
outside it — see §3.

**Re-measured on this branch, 2026-09-19,** because the figures above describe the audit branch before
this report's own fixes merged, and because the contracts gate was red on `main` from #436 (2026-09-18)
until #447 merged today. The clause this audit is gated on names the plain chain, so that is what was
run:

```
cd contracts && forge fmt --check && forge build && forge test
```

- `forge fmt --check` — clean
- `forge build` — exit 0
- `forge test` — **2644 passed, 0 failed, 30 skipped** of 2674, across 246 suites; exit 0

Inside that run, the sixteen suites the `test/audit/` files produce contribute 81 tests, all green. The
four files the default set does not compile are measured separately in §3.

**Re-measured again on 2026-09-20,** on this branch merged with `main` at `3886044c` — thirty-nine
commits it did not have, including every remaining audit fix. Same chain:

```
cd contracts && forge fmt --check && forge build && forge test
```

- `forge fmt --check` — clean
- `forge build` — exit 0
- `forge test` — **2677 passed, 0 failed, 30 skipped** of 2707, across 248 suites; exit 0

Inside that run the seventeen suites under `test/audit/` contribute 88 tests, all green — up from
sixteen and 81, because `ZRouterRefundBoundedToOwnChange.t.sol` joined the set with L-9's second pass
and the tree grew tests elsewhere. The four files the default set does not compile are measured
separately in §3; three of them are now in the `real-settlement` CI job and the fourth is H-1's.

Note what that exclusion bought and what it cost while it lasted: it kept the gate honest about
defects the gate did not cause, and it left those proofs unwatched. `UniVaultPoolKeyRotation.t.sol`
was red against a fix merged on 2026-09-17 and stayed red until 2026-09-19, when running the set by
hand was the first thing that looked at it.

That cost is since paid twice over. `ci-real-v4-audit-proofs-unrun` (PR #445) added the
`real-settlement` job that runs the real-v4 proofs, and the set it runs is now written in exactly one
place, `contracts/scripts/real-v4-gate.sh`, which both that job and a developer call. The script
refuses to run unless every file in `foundry.toml`'s `skip=` list is either in its run set or
recorded beside it with the reason it is deliberately out, and it asks forge which files its path
actually reaches before running them — because a `--match-path` that matches nothing exits 0. So a
proof can no longer be skipped and unwatched at the same time without something going red.
`FreeMintCurveSolvency.t.sol` is the one file recorded as out, red by the H-1 ruling and for as long
as it stands.
