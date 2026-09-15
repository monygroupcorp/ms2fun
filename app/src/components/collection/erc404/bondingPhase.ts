/**
 * ERC404 bonding-curve phase machine (W-B1) — a PURE derivation of the trading phase from contract
 * reads. Legacy buried this in a 1,137-LOC SwapInterface as scattered `isLiquidityDeployed()` /
 * `liquidityPool !== 0x0` checks; here it is one tested function the B4 swap UI and B5 chart share.
 *
 * Phases:
 *  - `preopen`   — bonding not yet active, or before `bondingOpenTime`. No trading.
 *  - `bonding`   — the curve is live: buy/sell against `CurveParamsComputer` quotes.
 *  - `graduated` — liquidity deployed (DEX). Curve closed; trading moves to the pool.
 *
 * `deployLiquidity` is permissionless once the curve is FULL or MATURED — `canDeployLiquidity`
 * derives that so the UI can surface a "graduate" affordance during the `bonding` phase.
 *
 * FULL is measured against the BUYABLE ceiling, not `maxSupply()` — see `buyableCeiling`.
 */

export type BondingPhase = 'preopen' | 'bonding' | 'graduated'

/** The reads `derivePhase`/`canDeployLiquidity` need — binding-order-agnostic. */
export interface BondingView {
  bondingActive: boolean
  bondingOpenTime: bigint
  bondingMaturityTime: bigint
  graduated: boolean
  totalBondingSupply: bigint
  maxSupply: bigint
  /** Coin held back for the graduation pool — never buyable on the curve. */
  liquidityReserve: bigint
  /** Free mints, denominated in NFT units: `freeMintAllocation * unit` coin is held back. */
  freeMintAllocation: bigint
  /** Coin per NFT id. */
  unit: bigint
}

/**
 * The most coin a buy can ever take off the curve: `maxSupply` less what is held back for the
 * graduation pool and for the free-mint allocation. The buy path enforces exactly this bound —
 * `ERC404BondingInstance:520` reverts `ExceedsBonding()` past it — so `maxSupply` on its own names
 * coin no buyer can reach. The reserve is non-zero for every creatable instance, so the gap is never
 * hypothetical: a curve bought to exhaustion sat at ~90% of `maxSupply` with every further buy
 * reverting.
 *
 * Same expression as the contract-side lens (`QueryAggregator.erc404CardData`, which calls this
 * figure `max`) and the same clamp: a configuration reserving the whole supply has a buyable ceiling
 * of zero, which is the truth, rather than an underflow.
 */
export function buyableCeiling(
  b: Pick<BondingView, 'maxSupply' | 'liquidityReserve' | 'freeMintAllocation' | 'unit'>,
): bigint {
  const reserved = b.liquidityReserve + b.freeMintAllocation * b.unit
  return reserved >= b.maxSupply ? 0n : b.maxSupply - reserved
}

/**
 * True once liquidity has been deployed (DEX phase). Keyed ONLY off the contract's `graduated`
 * flag — set true inside `deployLiquidity()`. NOT off `liquidityDeployer`: that is the venue module
 * configured at construction (it reverts if zero), so it is ALWAYS non-zero and says nothing about
 * whether the curve has closed. (Venue detection lives in `useGraduatedVenue`.)
 */
export function isGraduated(b: Pick<BondingView, 'graduated'>): boolean {
  return b.graduated
}

/** Derive the bonding phase at time `nowSec` (unix seconds, bigint). */
export function derivePhase(b: BondingView, nowSec: bigint): BondingPhase {
  if (isGraduated(b)) return 'graduated'
  if (!b.bondingActive || nowSec < b.bondingOpenTime) return 'preopen'
  return 'bonding'
}

/**
 * Whether `deployLiquidity` is callable now (permissionless graduation): only during the live
 * `bonding` phase, and only once the curve is FULL (supply ≥ the buyable ceiling) or MATURED
 * (now ≥ maturity).
 *
 * FULL is the ceiling and not `maxSupply`: a curve bought out to the ceiling is not graduated and
 * stays armed — nothing on chain flips for it — yet every further buy reverts. Against `maxSupply`
 * such a curve read not-full forever and the graduate affordance never appeared, while the project
 * card (which has read the ceiling since the contract-side lens landed) already showed it sold out.
 * A zero ceiling is uncapped-or-unbuyable and reads not-full, matching the lens's own `supply < max`.
 */
export function canDeployLiquidity(b: BondingView, nowSec: bigint): boolean {
  if (derivePhase(b, nowSec) !== 'bonding') return false
  const ceiling = buyableCeiling(b)
  const full = ceiling > 0n && b.totalBondingSupply >= ceiling
  const matured = b.bondingMaturityTime > 0n && nowSec >= b.bondingMaturityTime
  return full || matured
}
