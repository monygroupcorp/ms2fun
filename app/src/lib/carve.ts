/**
 * Creator-carve math (graduation carve-out) — a pure TS mirror of the on-chain
 * `RevenueSplitLib.carveAllowance` / `splitGraduation` + `ERC404Factory.effectiveCarveEth`
 * (floor-division bigint math, bit-for-bit). Drives:
 *   - the create wizard's declared-max disclosure preview (allowance + pool depth at sample raises),
 *   - the creator admin menu's graduation carve control (live effective max for the input cap).
 *
 * The chain remains the source of truth at write time (the instance re-resolves the carve via the
 * factory in `deployLiquidity`); this module only previews. No React/wagmi — unit-testable.
 */

export const BPS = 10_000n

/** Progressive carve-allowance brackets (wei breakpoints + bps rates), owner-tunable on-chain. */
export interface CarveBrackets {
  b1: bigint
  b2: bigint
  r1: number
  r2: number
  r3: number
}

/** Protocol defaults: 50% of the first 4 ETH, 25% of the next 16, 10% beyond 20. */
export const DEFAULT_CARVE_BRACKETS: CarveBrackets = {
  b1: 4_000_000_000_000_000_000n,
  b2: 20_000_000_000_000_000_000n,
  r1: 5000,
  r2: 2500,
  r3: 1000,
}

/** Default graduation pool floor (1 ETH). A carve-CLAMP, never a graduation gate. */
export const DEFAULT_MIN_POOL_ETH = 1_000_000_000_000_000_000n

/** Marginal-rate bracket allowance: r1·min(R,b1) + r2·(min(R,b2)−b1)⁺ + r3·(R−b2)⁺. */
export function carveAllowance(raise: bigint, b: CarveBrackets = DEFAULT_CARVE_BRACKETS): bigint {
  const tier1 = raise < b.b1 ? raise : b.b1
  let allowance = (tier1 * BigInt(b.r1)) / BPS
  if (raise > b.b1) {
    const tier2 = (raise < b.b2 ? raise : b.b2) - b.b1
    allowance += (tier2 * BigInt(b.r2)) / BPS
  }
  if (raise > b.b2) {
    allowance += ((raise - b.b2) * BigInt(b.r3)) / BPS
  }
  return allowance
}

/** The LP 80 of a raise (mirrors RevenueSplitLib.split: 1% + 19% floored, remainder to LP). */
export function lpShare(raise: bigint): bigint {
  return raise - raise / 100n - (raise * 19n) / 100n
}

/**
 * Effective carve ETH — mirrors `ERC404Factory.effectiveCarveEth`:
 * min(request, allowance(raise) × declaredMax / 10000, headroom above the pool floor).
 */
export function effectiveCarveEth(
  raise: bigint,
  declaredMaxBps: number,
  carveRequestBps: number,
  brackets: CarveBrackets = DEFAULT_CARVE_BRACKETS,
  minPoolEth: bigint = DEFAULT_MIN_POOL_ETH,
): bigint {
  if (raise === 0n || declaredMaxBps === 0 || carveRequestBps === 0) return 0n
  let effBps = Math.min(carveRequestBps, declaredMaxBps, 10_000)
  if (effBps < 0) effBps = 0
  let carve = (carveAllowance(raise, brackets) * BigInt(effBps)) / BPS
  const lp = lpShare(raise)
  const headroom = lp > minPoolEth ? lp - minPoolEth : 0n
  if (carve > headroom) carve = headroom
  return carve
}

/** One graduation payout preview — all parts sum to the raise exactly (splitGraduation mirror). */
export interface GraduationPreview {
  protocol: bigint // 1% raise + 1% carve
  vault: bigint // 19% raise + 19% carve
  creator: bigint // 80% of carve
  pool: bigint // LP80 − carve (the pool depth)
  carve: bigint // effective gross carve applied
}

export function graduationPreview(
  raise: bigint,
  carveEth: bigint,
  minPoolEth: bigint = DEFAULT_MIN_POOL_ETH,
): GraduationPreview {
  const protocolBase = raise / 100n
  const vaultBase = (raise * 19n) / 100n
  const lp = raise - protocolBase - vaultBase
  const headroom = lp > minPoolEth ? lp - minPoolEth : 0n
  const carve = carveEth > headroom ? headroom : carveEth
  const carveProtocol = carve / 100n
  const carveVault = (carve * 19n) / 100n
  return {
    protocol: protocolBase + carveProtocol,
    vault: vaultBase + carveVault,
    creator: carve - carveProtocol - carveVault,
    pool: lp - carve,
    carve,
  }
}

/** A wizard-preview row: at raise R, what the declared max lets the creator take vs pool depth. */
export interface CarvePreviewRow {
  raise: bigint
  allowance: bigint // full protocol allowance at R
  maxCarve: bigint // what THIS declared max allows (floor-clamped)
  creatorNet: bigint // 80% of maxCarve — the creator's actual take-home ceiling
  poolDepth: bigint // LP depth left if the max is taken
}

/** Sample raises for the disclosure preview (1 / 2 / 4 / 12 / 20 / 50 ETH). */
export const PREVIEW_RAISES: readonly bigint[] = [1n, 2n, 4n, 12n, 20n, 50n].map(
  (n) => n * 1_000_000_000_000_000_000n,
)

/**
 * The wizard's live allowance/depth preview: for each sample raise, the creator's max take under
 * `declaredMaxBps` and the pool depth that would remain — so the disclosure is priced in.
 */
export function carveDisclosurePreview(
  declaredMaxBps: number,
  brackets: CarveBrackets = DEFAULT_CARVE_BRACKETS,
  minPoolEth: bigint = DEFAULT_MIN_POOL_ETH,
  raises: readonly bigint[] = PREVIEW_RAISES,
): CarvePreviewRow[] {
  return raises.map((raise) => {
    const allowance = carveAllowance(raise, brackets)
    const maxCarve = effectiveCarveEth(raise, declaredMaxBps, 10_000, brackets, minPoolEth)
    const g = graduationPreview(raise, maxCarve, minPoolEth)
    return { raise, allowance, maxCarve, creatorNet: g.creator, poolDepth: g.pool }
  })
}

/** Clamp + parse a bps input string (create wizard / admin control). NaN/garbage → fallback. */
export function parseBps(value: string | undefined, fallback = 0): number {
  const t = (value ?? '').trim()
  if (t === '') return fallback
  const n = Number(t)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(10_000, Math.floor(n)))
}
