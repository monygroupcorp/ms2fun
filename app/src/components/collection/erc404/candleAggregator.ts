/**
 * Pure OHLC candle aggregation for ERC404 bonding trades (W-B5).
 *
 * FRESH implementation — legacy's candleAggregator.js was dead code and is intentionally NOT copied.
 *
 * Input: a flat list of trades, each with a `blockNumber` and a `price` (ETH-per-token, as a
 * floating-point number — caller derives it from `cost / amount`). Output: a small set of OHLC
 * candles bucketed by contiguous block-number ranges.
 *
 * Bucketing: we split the [minBlock, maxBlock] span into a fixed number of equal-width block ranges,
 * auto-picking the count in [MIN_CANDLES, MAX_CANDLES] from the number of distinct trade blocks (so a
 * thin history yields few candles and a busy one yields more, but always a chart-friendly handful).
 * Empty buckets carry the previous candle's close forward as a flat doji (open=high=low=close), so
 * the price line is continuous and gaps read as "no trades, price held".
 */

export interface Trade {
  blockNumber: bigint
  /** ETH per token for this trade (cost / amount), as a float. Must be finite and > 0. */
  price: number
}

export interface Candle {
  /** Inclusive lower block bound of this bucket. */
  startBlock: bigint
  /** Inclusive upper block bound of this bucket. */
  endBlock: bigint
  open: number
  high: number
  low: number
  close: number
  /** Number of trades that fell in this bucket (0 for carried-forward gaps). */
  trades: number
}

export const MIN_CANDLES = 3
export const MAX_CANDLES = 15

/**
 * Pick a candle count in [MIN_CANDLES, MAX_CANDLES] from the number of distinct trade blocks.
 * Few distinct blocks → few candles; many → capped at MAX_CANDLES.
 */
export function pickBucketCount(distinctBlocks: number): number {
  if (distinctBlocks <= MIN_CANDLES) return MIN_CANDLES
  if (distinctBlocks >= MAX_CANDLES) return MAX_CANDLES
  return distinctBlocks
}

/**
 * Aggregate trades into OHLC candles bucketed by equal-width block ranges.
 * Returns [] when there are no trades. Trades may arrive in any order.
 */
export function aggregateCandles(trades: readonly Trade[]): Candle[] {
  const clean = trades.filter((t) => Number.isFinite(t.price) && t.price > 0)
  if (clean.length === 0) return []

  // Sort ascending by block so bucket assignment and carry-forward are well-defined.
  const sorted = [...clean].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  )

  const minBlock = sorted[0]!.blockNumber
  const maxBlock = sorted[sorted.length - 1]!.blockNumber

  const distinct = new Set(sorted.map((t) => t.blockNumber.toString())).size
  const bucketCount = pickBucketCount(distinct)

  // Degenerate span (all trades in one block): a single candle covering that block.
  if (maxBlock === minBlock) {
    return [buildCandle(minBlock, minBlock, sorted)]
  }

  const span = maxBlock - minBlock + 1n
  const count = BigInt(bucketCount)
  // Ceil-divide so the last bucket's end reaches maxBlock without overflow.
  const width = (span + count - 1n) / count

  const candles: Candle[] = []
  let prevClose: number | undefined

  for (let i = 0n; i < count; i++) {
    const start = minBlock + i * width
    if (start > maxBlock) break
    let end = start + width - 1n
    if (i === count - 1n || end > maxBlock) end = maxBlock

    const inBucket = sorted.filter((t) => t.blockNumber >= start && t.blockNumber <= end)

    if (inBucket.length === 0) {
      // Carry the previous close forward as a flat doji; skip leading gaps (no price yet).
      if (prevClose === undefined) continue
      candles.push({
        startBlock: start,
        endBlock: end,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        trades: 0,
      })
      continue
    }

    const candle = buildCandle(start, end, inBucket)
    prevClose = candle.close
    candles.push(candle)
  }

  return candles
}

/** Build one OHLC candle from a non-empty, block-ascending slice of trades. */
function buildCandle(startBlock: bigint, endBlock: bigint, slice: readonly Trade[]): Candle {
  const open = slice[0]!.price
  const close = slice[slice.length - 1]!.price
  let high = open
  let low = open
  for (const t of slice) {
    if (t.price > high) high = t.price
    if (t.price < low) low = t.price
  }
  return { startBlock, endBlock, open, high, low, close, trades: slice.length }
}
