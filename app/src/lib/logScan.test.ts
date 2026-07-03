import { describe, expect, it } from 'vitest'
import { reverseWindows, scanBackward } from './logScan'

describe('reverseWindows', () => {
  it('splits a range into newest-first windows of width <= size', () => {
    expect(reverseWindows(100n, 0n, 30n)).toEqual([
      { fromBlock: 71n, toBlock: 100n },
      { fromBlock: 41n, toBlock: 70n },
      { fromBlock: 11n, toBlock: 40n },
      { fromBlock: 0n, toBlock: 10n },
    ])
  })

  it('covers the range exactly (no gaps, no overlap, no blocks below floor)', () => {
    const ws = reverseWindows(1000n, 137n, 64n)
    expect(ws[0].toBlock).toBe(1000n) // starts at latest
    expect(ws[ws.length - 1].fromBlock).toBe(137n) // ends at floor
    for (let i = 0; i < ws.length - 1; i += 1) {
      // each window sits directly below the previous one
      expect(ws[i].fromBlock).toBe(ws[i + 1].toBlock + 1n)
      expect(ws[i].toBlock - ws[i].fromBlock + 1n).toBeLessThanOrEqual(64n)
    }
  })

  it('returns a single window when the range fits in one size', () => {
    expect(reverseWindows(100n, 90n, 50n)).toEqual([{ fromBlock: 90n, toBlock: 100n }])
    expect(reverseWindows(10n, 0n, 100n)).toEqual([{ fromBlock: 0n, toBlock: 10n }])
    expect(reverseWindows(100n, 100n, 30n)).toEqual([{ fromBlock: 100n, toBlock: 100n }])
  })

  it('clamps a negative floor to 0', () => {
    expect(reverseWindows(5n, -10n, 100n)).toEqual([{ fromBlock: 0n, toBlock: 5n }])
  })

  it('returns [] when the floor is above latest (nothing to scan)', () => {
    expect(reverseWindows(100n, 101n, 30n)).toEqual([])
  })

  it('throws on a non-positive window size', () => {
    expect(() => reverseWindows(100n, 0n, 0n)).toThrow()
  })
})

describe('scanBackward', () => {
  it('fetches newest window first and concatenates in window order', async () => {
    const seen: Array<[bigint, bigint]> = []
    const out = await scanBackward(
      async (from, to) => {
        seen.push([from, to])
        return [`${from}-${to}`]
      },
      { latest: 100n, floor: 0n, window: 30n },
    )
    expect(seen[0]).toEqual([71n, 100n]) // newest first
    expect(out).toEqual(['71-100', '41-70', '11-40', '0-10'])
  })

  it('early-stops after maxWindows (feed behaviour — never reaches the floor)', async () => {
    let calls = 0
    const out = await scanBackward(
      async (from, to) => {
        calls += 1
        return [`${from}-${to}`]
      },
      { latest: 1_000_000n, floor: 0n, window: 1000n, maxWindows: 2 },
    )
    expect(calls).toBe(2)
    expect(out).toEqual(['999001-1000000', '998001-999000'])
  })
})
