import { describe, expect, it } from 'vitest'
import { type CurveParams, curveParamsFromTuple, curvePriceAt, sampleCurve } from './curveSampler'

const WAD = 10n ** 18n

// Shaped like real CurveParamsComputer output (see computeCurveParams): initialPrice 0.025 ETH, a
// positive quadratic, and normalizationFactor in WHOLE tokens (maxBondingSupply / 1e18), so a supply
// at the WAD scale yields scaledSupplyWad ≈ 1e18. maxBondingSupply here = 8M tokens.
const NORM = 8n * 10n ** 6n // 8e6 whole tokens
const params: CurveParams = {
  initialPrice: WAD / 40n, // 0.025 ETH
  quarticCoeff: 0n,
  cubicCoeff: 0n,
  quadraticCoeff: 2n * 10n ** 9n, // 2 gwei, the protocol quadraticWeight
  normalizationFactor: NORM,
}

// A supply equal to normFactor*1e18 gives scaledSupplyWad = 1e18 (i.e. "1.0" in WAD).
const FULL_SUPPLY = Number(NORM) * 1e18

describe('curveParamsFromTuple', () => {
  it('maps the 5-tuple in calculateCost order', () => {
    const p = curveParamsFromTuple([1n, 2n, 3n, 4n, 5n])
    expect(p.initialPrice).toBe(1n)
    expect(p.quarticCoeff).toBe(2n)
    expect(p.cubicCoeff).toBe(3n)
    expect(p.quadraticCoeff).toBe(4n)
    expect(p.normalizationFactor).toBe(5n)
  })
})

describe('curvePriceAt', () => {
  it('returns the base price at supply 0', () => {
    expect(curvePriceAt(params, 0)).toBeCloseTo(0.025, 6)
  })

  it('is monotonically increasing for a positive quadratic', () => {
    const a = curvePriceAt(params, FULL_SUPPLY)
    const b = curvePriceAt(params, 2 * FULL_SUPPLY)
    expect(b).toBeGreaterThan(a)
    expect(a).toBeGreaterThan(0.025)
  })

  it('returns 0 when normalizationFactor is 0', () => {
    expect(curvePriceAt({ ...params, normalizationFactor: 0n }, FULL_SUPPLY)).toBe(0)
  })
})

describe('sampleCurve', () => {
  it('returns the requested number of points spanning [0, maxSupply]', () => {
    const pts = sampleCurve(params, 1e25, 10)
    expect(pts).toHaveLength(10)
    expect(pts[0]!.supply).toBe(0)
    expect(pts[pts.length - 1]!.supply).toBeCloseTo(1e25, 0)
  })

  it('clamps to at least 2 points', () => {
    expect(sampleCurve(params, 1e25, 1)).toHaveLength(2)
  })
})
