import { describe, expect, it } from 'vitest'
import {
  carveAllowance,
  carveDisclosurePreview,
  DEFAULT_CARVE_BRACKETS,
  DEFAULT_MIN_POOL_ETH,
  effectiveCarveEth,
  graduationPreview,
  lpShare,
  parseBps,
} from './carve'

const ETH = 1_000_000_000_000_000_000n
const eth = (n: number): bigint => (BigInt(Math.round(n * 1000)) * ETH) / 1000n

describe('carveAllowance (mirrors RevenueSplitLib worked points)', () => {
  it('matches the locked-design worked points on the default brackets', () => {
    expect(carveAllowance(0n)).toBe(0n)
    expect(carveAllowance(eth(1))).toBe(eth(0.5))
    expect(carveAllowance(eth(4))).toBe(eth(2))
    expect(carveAllowance(eth(12))).toBe(eth(4))
    expect(carveAllowance(eth(20))).toBe(eth(6))
    expect(carveAllowance(eth(50))).toBe(eth(9))
    expect(carveAllowance(eth(100))).toBe(eth(14))
  })

  it('is continuous at the breakpoints (<= 1 wei per wei)', () => {
    for (const b of [DEFAULT_CARVE_BRACKETS.b1, DEFAULT_CARVE_BRACKETS.b2]) {
      const below = carveAllowance(b - 1n)
      const at = carveAllowance(b)
      const above = carveAllowance(b + 1n)
      expect(at - below <= 1n).toBe(true)
      expect(above - at <= 1n).toBe(true)
    }
  })

  it('is monotonic in the raise', () => {
    let prev = -1n
    for (const raise of [0n, eth(0.5), eth(1), eth(4), eth(5), eth(20), eth(21), eth(100)]) {
      const a = carveAllowance(raise)
      expect(a >= prev).toBe(true)
      prev = a
    }
  })
})

describe('effectiveCarveEth (mirrors ERC404Factory.effectiveCarveEth)', () => {
  it('takes the min of request, declared max, and floor headroom', () => {
    // R=4: allowance 2.0, LP80 3.2, headroom 2.2 -> full allowance fits.
    expect(effectiveCarveEth(eth(4), 10_000, 10_000)).toBe(eth(2))
    // Declared max halves the axis.
    expect(effectiveCarveEth(eth(4), 5000, 10_000)).toBe(eth(1))
    // A lower request wins over the declared max.
    expect(effectiveCarveEth(eth(4), 10_000, 2500)).toBe(eth(0.5))
  })

  it('clamps to the pool-floor headroom (minnow table: R=1.5 -> 0.2, R=2 -> 0.6)', () => {
    expect(effectiveCarveEth(eth(1.5), 10_000, 10_000)).toBe(eth(0.2))
    expect(effectiveCarveEth(eth(2), 10_000, 10_000)).toBe(eth(0.6))
  })

  it('is structurally zero for minnows at or under 1 ETH (floor clamps, never gates)', () => {
    expect(effectiveCarveEth(eth(0.8), 10_000, 10_000)).toBe(0n)
    expect(effectiveCarveEth(eth(1), 10_000, 10_000)).toBe(0n)
  })

  it('short-circuits zeroes', () => {
    expect(effectiveCarveEth(0n, 10_000, 10_000)).toBe(0n)
    expect(effectiveCarveEth(eth(4), 0, 10_000)).toBe(0n)
    expect(effectiveCarveEth(eth(4), 10_000, 0)).toBe(0n)
  })
})

describe('graduationPreview (mirrors RevenueSplitLib.splitGraduation)', () => {
  it('conserves the raise across all parts', () => {
    for (const [raise, carve] of [
      [eth(2), eth(0.6)],
      [eth(10), eth(1)],
      [eth(0.8), eth(0.4)],
      [eth(50), eth(9)],
    ] as const) {
      const g = graduationPreview(raise, carve)
      expect(g.protocol + g.vault + g.creator + g.pool).toBe(raise)
    }
  })

  it('applies the tithe: R=2 with the clamped 0.6 carve nets the creator 0.48', () => {
    const g = graduationPreview(eth(2), eth(1)) // request 1.0 -> clamped to 0.6
    expect(g.carve).toBe(eth(0.6))
    expect(g.creator).toBe(eth(0.48))
    expect(g.vault).toBe(eth(0.38) + eth(0.114))
    expect(g.protocol).toBe(eth(0.02) + eth(0.006))
    expect(g.pool).toBe(eth(1)) // held at the floor
  })

  it('never lets the pool fall below the floor when the LP share reaches it', () => {
    const g = graduationPreview(eth(3), eth(100)) // absurd request
    expect(g.pool).toBe(DEFAULT_MIN_POOL_ETH)
  })

  it('zero carve reproduces the plain 1/19/80 split', () => {
    const g = graduationPreview(eth(10), 0n)
    expect(g.protocol).toBe(eth(0.1))
    expect(g.vault).toBe(eth(1.9))
    expect(g.creator).toBe(0n)
    expect(g.pool).toBe(eth(8))
  })
})

describe('lpShare', () => {
  it('is the 80 of 1/19/80', () => {
    expect(lpShare(eth(10))).toBe(eth(8))
    expect(lpShare(0n)).toBe(0n)
  })
})

describe('carveDisclosurePreview (wizard rows)', () => {
  it('produces the declared-max ceilings + pool depths per sample raise', () => {
    const rows = carveDisclosurePreview(10_000)
    const at = (raise: bigint) => rows.find((r) => r.raise === raise)
    expect(at(eth(1))?.maxCarve).toBe(0n)
    expect(at(eth(2))?.maxCarve).toBe(eth(0.6))
    expect(at(eth(2))?.creatorNet).toBe(eth(0.48))
    expect(at(eth(4))?.maxCarve).toBe(eth(2))
    expect(at(eth(4))?.creatorNet).toBe(eth(1.6))
    expect(at(eth(4))?.poolDepth).toBe(eth(1.2))
    expect(at(eth(12))?.allowance).toBe(eth(4))
  })

  it('declared max 0 zeroes every ceiling (pool keeps the full LP80)', () => {
    const rows = carveDisclosurePreview(0)
    for (const r of rows) {
      expect(r.maxCarve).toBe(0n)
      expect(r.creatorNet).toBe(0n)
      expect(r.poolDepth).toBe(lpShare(r.raise))
    }
  })
})

describe('parseBps', () => {
  it('parses, floors, and clamps to [0, 10000]', () => {
    expect(parseBps('2500')).toBe(2500)
    expect(parseBps('10001')).toBe(10_000)
    expect(parseBps('-5')).toBe(0)
    expect(parseBps('99.9')).toBe(99)
    expect(parseBps('', 10_000)).toBe(10_000)
    expect(parseBps('garbage', 10_000)).toBe(10_000)
    expect(parseBps(undefined)).toBe(0)
  })
})
