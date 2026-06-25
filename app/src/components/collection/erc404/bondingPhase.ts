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
 */

export type BondingPhase = 'preopen' | 'bonding' | 'graduated'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** The reads `derivePhase`/`canDeployLiquidity` need — binding-order-agnostic. */
export interface BondingView {
  bondingActive: boolean
  bondingOpenTime: bigint
  bondingMaturityTime: bigint
  graduated: boolean
  /** Set to the deployer address once liquidity is deployed; zero address before. */
  liquidityDeployer: `0x${string}`
  totalBondingSupply: bigint
  maxSupply: bigint
}

/** True once liquidity has been deployed (DEX phase), by flag or non-zero deployer. */
export function isGraduated(b: Pick<BondingView, 'graduated' | 'liquidityDeployer'>): boolean {
  return b.graduated || b.liquidityDeployer.toLowerCase() !== ZERO_ADDRESS
}

/** Derive the bonding phase at time `nowSec` (unix seconds, bigint). */
export function derivePhase(b: BondingView, nowSec: bigint): BondingPhase {
  if (isGraduated(b)) return 'graduated'
  if (!b.bondingActive || nowSec < b.bondingOpenTime) return 'preopen'
  return 'bonding'
}

/**
 * Whether `deployLiquidity` is callable now (permissionless graduation): only during the live
 * `bonding` phase, and only once the curve is FULL (supply ≥ max) or MATURED (now ≥ maturity).
 */
export function canDeployLiquidity(b: BondingView, nowSec: bigint): boolean {
  if (derivePhase(b, nowSec) !== 'bonding') return false
  const full = b.maxSupply > 0n && b.totalBondingSupply >= b.maxSupply
  const matured = b.bondingMaturityTime > 0n && nowSec >= b.bondingMaturityTime
  return full || matured
}
