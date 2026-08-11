import { describe, expect, it } from 'vitest'
import { type CurveParams, curveParamsFromTuple, curvePriceAt, sampleCurve } from './curveSampler'

const WAD = 10n ** 18n

// Shaped like real CurveParamsComputer output (see computeCurveParams): normalizationFactor in WHOLE
// tokens (maxBondingSupply / 1e18), so a supply at the WAD scale yields scaledSupplyWad ≈ 1e18, and
// the pole solved for the shipped presets (liquidityReserveBps = 1000 → G = 7.2).
const NORM = 8n * 10n ** 6n // 8e6 whole tokens
const POLE = 1043800000000000000n // 1.0438e18
const params: CurveParams = {
  kCoeff: WAD / 40n, // 0.025 ETH
  poleWad: POLE,
  normalizationFactor: NORM,
}

// A supply equal to normFactor*1e18 gives scaledSupplyWad = 1e18 (i.e. "1.0" in WAD) — the top of
// the bonding range.
const FULL_SUPPLY = Number(NORM) * 1e18

describe('curveParamsFromTuple', () => {
  it('maps the 3-tuple in calculateCost order', () => {
    const p = curveParamsFromTuple([1n, 2n, 3n])
    expect(p.kCoeff).toBe(1n)
    expect(p.poleWad).toBe(2n)
    expect(p.normalizationFactor).toBe(3n)
  })
})

describe('curvePriceAt', () => {
  it('returns k / pole at supply 0', () => {
    expect(curvePriceAt(params, 0)).toBeCloseTo(0.025 / 1.0438, 8)
  })

  it('rises to k / (pole - 1) at the top of the bonding range', () => {
    expect(curvePriceAt(params, FULL_SUPPLY)).toBeCloseTo(0.025 / 0.0438, 6)
  })

  it('spans the closed-form price ratio end to end', () => {
    const first = curvePriceAt(params, 0)
    const last = curvePriceAt(params, FULL_SUPPLY)
    // R = pole / (pole - 1) = 23.83x. A flat curve reads 1.0 here.
    expect(last / first).toBeCloseTo(1.0438 / 0.0438, 4)
  })

  it('is monotonically increasing across the range', () => {
    const a = curvePriceAt(params, FULL_SUPPLY / 4)
    const b = curvePriceAt(params, FULL_SUPPLY / 2)
    const c = curvePriceAt(params, (FULL_SUPPLY * 3) / 4)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('returns 0 when normalizationFactor is 0', () => {
    expect(curvePriceAt({ ...params, normalizationFactor: 0n }, FULL_SUPPLY)).toBe(0)
  })

  it('returns 0 at or beyond the pole, where the on-chain library refuses to price', () => {
    const atPole = (Number(POLE) / 1e18) * FULL_SUPPLY
    expect(curvePriceAt(params, atPole)).toBe(0)
    expect(curvePriceAt(params, atPole * 2)).toBe(0)
  })
})

describe('sampleCurve', () => {
  it('returns the requested number of points spanning [0, maxSupply]', () => {
    const pts = sampleCurve(params, FULL_SUPPLY, 10)
    expect(pts).toHaveLength(10)
    expect(pts[0]!.supply).toBe(0)
    expect(pts[pts.length - 1]!.supply).toBeCloseTo(FULL_SUPPLY, 0)
  })

  it('samples a rising price across the range', () => {
    const pts = sampleCurve(params, FULL_SUPPLY, 10)
    expect(pts[pts.length - 1]!.price).toBeGreaterThan(pts[0]!.price * 20)
  })

  it('clamps to at least 2 points', () => {
    expect(sampleCurve(params, FULL_SUPPLY, 1)).toHaveLength(2)
  })
})
