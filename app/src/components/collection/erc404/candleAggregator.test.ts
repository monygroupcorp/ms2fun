import { describe, expect, it } from 'vitest'
import {
  type Trade,
  MAX_CANDLES,
  MIN_CANDLES,
  aggregateCandles,
  pickBucketCount,
} from './candleAggregator'

function t(blockNumber: bigint, price: number): Trade {
  return { blockNumber, price }
}

describe('pickBucketCount', () => {
  it('floors at MIN_CANDLES', () => {
    expect(pickBucketCount(0)).toBe(MIN_CANDLES)
    expect(pickBucketCount(1)).toBe(MIN_CANDLES)
    expect(pickBucketCount(MIN_CANDLES)).toBe(MIN_CANDLES)
  })
  it('caps at MAX_CANDLES', () => {
    expect(pickBucketCount(MAX_CANDLES)).toBe(MAX_CANDLES)
    expect(pickBucketCount(1000)).toBe(MAX_CANDLES)
  })
  it('passes through in the mid-range', () => {
    expect(pickBucketCount(7)).toBe(7)
  })
})

describe('aggregateCandles', () => {
  it('returns [] for no trades', () => {
    expect(aggregateCandles([])).toEqual([])
  })

  it('drops non-finite and non-positive prices', () => {
    expect(aggregateCandles([t(1n, 0), t(2n, -1), t(3n, NaN)])).toEqual([])
  })

  it('single block → one candle with OHLC over that block', () => {
    const candles = aggregateCandles([t(5n, 2), t(5n, 4), t(5n, 1), t(5n, 3)])
    expect(candles).toHaveLength(1)
    const c = candles[0]!
    expect(c.startBlock).toBe(5n)
    expect(c.endBlock).toBe(5n)
    expect(c.open).toBe(2)
    expect(c.close).toBe(3)
    expect(c.high).toBe(4)
    expect(c.low).toBe(1)
    expect(c.trades).toBe(4)
  })

  it('open is first by block order, close is last (input order independent)', () => {
    // Supplied out of order; sorting by block must fix open/close.
    const candles = aggregateCandles([t(9n, 9), t(1n, 1), t(5n, 5)])
    const first = candles[0]!
    const last = candles[candles.length - 1]!
    expect(first.open).toBe(1)
    expect(last.close).toBe(9)
  })

  it('covers the full block span exactly (no gaps/overlaps in bounds)', () => {
    const trades = Array.from({ length: 20 }, (_, i) => t(BigInt(100 + i * 3), i + 1))
    const candles = aggregateCandles(trades)
    expect(candles.length).toBeGreaterThanOrEqual(MIN_CANDLES)
    expect(candles.length).toBeLessThanOrEqual(MAX_CANDLES)
    expect(candles[0]!.startBlock).toBe(100n)
    expect(candles[candles.length - 1]!.endBlock).toBe(BigInt(100 + 19 * 3))
    // Bounds are contiguous: each candle starts right after the previous ends.
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.startBlock).toBe(candles[i - 1]!.endBlock + 1n)
    }
  })

  it('carries the previous close forward across an empty bucket as a flat doji', () => {
    // Two clusters far apart guarantee at least one empty middle bucket.
    const trades = [t(0n, 10), t(1n, 11), t(100n, 20), t(101n, 21)]
    const candles = aggregateCandles(trades)
    const gaps = candles.filter((c) => c.trades === 0)
    expect(gaps.length).toBeGreaterThan(0)
    for (const g of gaps) {
      expect(g.open).toBe(g.close)
      expect(g.high).toBe(g.low)
      expect(g.open).toBe(g.high)
      // A doji can only carry a price that actually traded before it.
      expect(g.close).toBeGreaterThan(0)
    }
  })

  it('does not emit leading carry-forward candles before the first trade', () => {
    const candles = aggregateCandles([t(50n, 5), t(51n, 6), t(52n, 7)])
    // Every candle either has trades or carries a prior close — never a leading empty.
    expect(candles[0]!.trades).toBeGreaterThan(0)
  })
})
