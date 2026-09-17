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

_(hunt in progress — this section is written after the judge pass)_

---

## 3. Proofs of concept

_(under `contracts/test/audit/`)_

---

## 4. Disposition

_(fix branch + PR, or named for rth's ruling, per finding)_
