/**
 * Pure presentation/math helpers for the ERC404 bonding surface (W-B4). No React, no wagmi — kept
 * separate from the hooks so the slippage / countdown / fee arithmetic is unit-testable in isolation
 * (the discipline legacy's 1,137-LOC SwapInterface lacked).
 */

/** Basis-point denominator (100% = 10_000 bps). */
export const BPS_DENOMINATOR = 10_000n

/**
 * Apply a slippage tolerance to a quoted BUY cost → the `maxCost` we are willing to pay.
 * `slippageBps` of 50 = 0.5%. Rounds UP so the cap never lands below the true cost.
 */
export function applyBuySlippage(quotedCost: bigint, slippageBps: number): bigint {
  const bps = toBpsBigint(slippageBps)
  // ceil(quotedCost * (DENOM + bps) / DENOM)
  const numerator = quotedCost * (BPS_DENOMINATOR + bps)
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR
}

/**
 * Apply a slippage tolerance to a quoted SELL refund → the `minRefund` we will accept.
 * Rounds DOWN so the floor never lands above the true refund.
 */
export function applySellSlippage(quotedRefund: bigint, slippageBps: number): bigint {
  const bps = toBpsBigint(slippageBps)
  if (bps >= BPS_DENOMINATOR) return 0n
  return (quotedRefund * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR
}

/** Coerce a (possibly fractional / negative) bps number into a clamped non-negative bigint. */
function toBpsBigint(slippageBps: number): bigint {
  if (!Number.isFinite(slippageBps) || slippageBps <= 0) return 0n
  return BigInt(Math.round(slippageBps))
}

/** Format a bps fee for display, e.g. 1900n → "19%". Pure integer math, no float drift. */
export function formatBps(bps: bigint): string {
  const whole = bps / 100n
  const frac = bps % 100n
  if (frac === 0n) return `${whole}%`
  const fracStr = frac.toString().padStart(2, '0').replace(/0+$/, '')
  return `${whole}.${fracStr}%`
}

/** Format a unix-second remaining count as a compact `Dd Hh Mm Ss` countdown. <=0 → "now". */
export function formatCountdown(remainingSec: number): string {
  if (remainingSec <= 0) return 'now'
  const d = Math.floor(remainingSec / 86_400)
  const h = Math.floor((remainingSec % 86_400) / 3_600)
  const m = Math.floor((remainingSec % 3_600) / 60)
  const s = Math.floor(remainingSec % 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (d > 0 || h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/** Format a unix-second timestamp (bigint) as a local date-time string for "opens at …". */
export function formatOpenTime(openTimeSec: bigint): string {
  return new Date(Number(openTimeSec) * 1000).toLocaleString()
}
