/**
 * Invert the bonding curve's cost function so a BUY can be denominated in ETH-to-spend (S4).
 *
 * The on-chain `calculateCost(params, totalBondingSupply, amount)` is the source of truth for what a
 * given token `amount` costs; there is no on-chain inverse. Cost is monotonic increasing in `amount`
 * and returns 0 (not a revert) for a too-small amount, so we bisect: find the LARGEST amount whose
 * cost is <= the target spend. That guarantees we never overspend the user's budget (the buy's
 * `maxCost` is then this exact cost + slippage, and the amount is whatever the curve gives for it).
 *
 * This module is pure — it takes the cost probe as an async callback (`costOf`), so it's testable
 * without a chain and the caller owns the RPC. On the local fork each probe is instant; the optional
 * `seed` (a client-curve estimate of the amount) brackets the search tightly so it converges in a
 * handful of probes rather than bisecting the whole supply range.
 */

export interface CostInverse {
  /** Token base units to buy. */
  amount: bigint
  /** Exact on-chain cost for that amount (wei). */
  cost: bigint
}

function bigMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export async function solveBuyAmount(opts: {
  /** ETH (wei) the user wants to spend. */
  targetSpend: bigint
  /** Buyable ceiling: maxSupply - liquidityReserve - freeMintAllocation*unit - totalBondingSupply. */
  maxAmount: bigint
  /** On-chain cost probe: calculateCost for `amount` (0 = too small, never a revert). */
  costOf: (amount: bigint) => Promise<bigint>
  /** Optional client-curve estimate of the amount, to bracket the search tightly. */
  seed?: bigint | undefined
  /** Stop once cost is within this many bps BELOW target (default 0.5%). */
  toleranceBps?: number | undefined
  /** Bisection iteration cap (default 32). */
  maxIters?: number | undefined
  signal?: AbortSignal | undefined
}): Promise<CostInverse | undefined> {
  const { targetSpend, maxAmount, costOf, seed, toleranceBps = 50, maxIters = 32, signal } = opts
  if (targetSpend <= 0n || maxAmount <= 0n) return undefined

  const aborted = () => signal?.aborted === true

  // Bracket the top: hi must satisfy cost(hi) > target (so the answer lies in [0, hi]). Start from
  // the seed (clamped) and double until cost(hi) exceeds target or we hit the buyable ceiling.
  let hi = seed !== undefined && seed > 0n ? bigMin(seed, maxAmount) : maxAmount
  let costHi = await costOf(hi)
  if (aborted()) return undefined

  let expand = 0
  while (costHi <= targetSpend && hi < maxAmount && expand < 48) {
    hi = bigMin(hi * 2n, maxAmount)
    costHi = await costOf(hi)
    if (aborted()) return undefined
    expand += 1
  }

  // Even the whole buyable supply costs <= target → buy it all (spend less than budget).
  if (costHi <= targetSpend) return { amount: hi, cost: costHi }

  // Bisect [0, hi] for the largest amount with cost <= target.
  let lo = 0n
  let best: CostInverse | undefined
  for (let i = 0; i < maxIters && lo <= hi; i += 1) {
    if (aborted()) return undefined
    const mid = (lo + hi) / 2n
    if (mid <= 0n) break
    const c = await costOf(mid)
    if (aborted()) return undefined
    if (c === 0n) {
      // Too small to price — need more tokens.
      lo = mid + 1n
      continue
    }
    if (c <= targetSpend) {
      best = { amount: mid, cost: c }
      // Close enough below target? stop.
      if ((targetSpend - c) * 10_000n <= targetSpend * BigInt(toleranceBps)) break
      lo = mid + 1n
    } else {
      hi = mid - 1n
    }
  }

  return best
}
