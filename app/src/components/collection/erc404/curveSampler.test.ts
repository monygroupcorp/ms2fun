import { describe, expect, it } from 'vitest'
import {
  type CurveParams,
  VIEWPORT_SPAN,
  bondingCap,
  computeViewport,
  curveParamsFromTuple,
  curvePriceAt,
  sampleCurve,
} from './curveSampler'

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
  it('returns the requested number of points spanning [0, bondingCap]', () => {
    const pts = sampleCurve(params, 10)
    expect(pts).toHaveLength(10)
    expect(pts[0]!.supply).toBe(0)
    expect(pts[pts.length - 1]!.supply).toBeCloseTo(bondingCap(params), 0)
  })

  it('samples a rising price across the range', () => {
    const pts = sampleCurve(params, 10)
    expect(pts[pts.length - 1]!.price).toBeGreaterThan(pts[0]!.price * 20)
  })

  it('clamps to at least 2 points', () => {
    expect(sampleCurve(params, 1)).toHaveLength(2)
  })

  // Test #1/#2 (noesis-208): the shipped defect was sampling [0, maxSupply] — the token's full
  // supply, which sits past `poleWad` — instead of [0, bondingCap]. maxSupply is no longer even a
  // sampler input; assert the domain it derives is the bonding range, never touching/crossing the
  // pole, for a params set shaped like the vapor-mid defect report (maxSupply > poleWad * norm).
  it('never samples at or beyond the pole, and never returns price 0, for the vapor-mid shape', () => {
    const pts = sampleCurve(params, 80)
    const poleSupply = (Number(POLE) / 1e18) * FULL_SUPPLY
    for (const p of pts) {
      expect(p.supply).toBeLessThan(poleSupply)
      expect(p.price).toBeGreaterThan(0)
    }
  })

  it('the sampled domain ends at the bonding cap, not at maxSupply', () => {
    const pts = sampleCurve(params, 80)
    const last = pts[pts.length - 1]!
    expect(last.supply).toBeCloseTo(bondingCap(params), 0)
    // The cap is strictly inside the pole (never equal/beyond) — this is the invariant the defect broke.
    const poleSupply = (Number(POLE) / 1e18) * FULL_SUPPLY
    expect(last.supply).toBeLessThan(poleSupply)
  })
})

describe('computeViewport', () => {
  const cap = bondingCap(params)
  const capPrice = curvePriceAt(params, cap)
  const p0 = curvePriceAt(params, 0)

  // Test #3: y-span is min(SPAN, R) at each position — the regression guard for the flat-chart
  // defect (a span blown out by a near-pole sample) and for the rejected position-driven rule's
  // mid-range blowout.
  it.each([0.02, 0.17, 0.5, 0.75, 0.9, 0.99])('y-span is min(SPAN, R) at %s sold', (frac) => {
    const vp = computeViewport(params, frac * cap)
    const r = capPrice / p0
    expect(vp.hiPrice / vp.loPrice).toBeCloseTo(Math.min(VIEWPORT_SPAN, r), 3)
  })

  // Correction #4: MAX_POLE_WAD = 2e18 puts R as low as 2.0, below SPAN = 3.0. There both pins fire
  // and the window is the whole curve — span compresses to R, not SPAN.
  it('compresses the span to R when R < SPAN (low-pole params)', () => {
    const lowR: CurveParams = { ...params, poleWad: 2n * WAD } // R = pole/(pole-1) = 2.0
    const lowCap = bondingCap(lowR)
    const lowCapPrice = curvePriceAt(lowR, lowCap)
    const lowP0 = curvePriceAt(lowR, 0)
    const r = lowCapPrice / lowP0
    expect(r).toBeLessThan(VIEWPORT_SPAN)

    const vp = computeViewport(lowR, 0.5 * lowCap)
    expect(vp.loSupply).toBe(0)
    expect(vp.hiSupply).toBeCloseTo(lowCap, 0)
    expect(vp.hiPrice / vp.loPrice).toBeCloseTo(r, 3)
  })

  // Test #4: the viewport always contains `here`, and never leaves the bonding domain.
  it.each([0.001, 0.02, 0.5, 0.9, 0.999])('always contains `here` and stays within [0, cap] at %s sold', (frac) => {
    const here = frac * cap
    const vp = computeViewport(params, here)
    expect(vp.loSupply).toBeGreaterThanOrEqual(0)
    expect(vp.hiSupply).toBeLessThanOrEqual(cap)
    expect(vp.loSupply).toBeLessThanOrEqual(here)
    expect(vp.hiSupply).toBeGreaterThanOrEqual(here)
  })

  // Test #5: graduation price is always reported, so the caller's edge label can't silently vanish
  // when graduation is off-window (early in the sale, per the left-pin regime below).
  it('reports graduationPrice even when graduation is not in view', () => {
    const vp = computeViewport(params, 0.02 * cap)
    expect(vp.graduationInView).toBe(false)
    expect(vp.graduationPrice).toBeCloseTo(capPrice, 6)
    expect(vp.graduationPrice).toBeGreaterThan(0)
  })

  it('marks graduation in view once the right edge pins to it', () => {
    const vp = computeViewport(params, 0.99 * cap)
    expect(vp.graduationInView).toBe(true)
    expect(vp.hiSupply).toBeCloseTo(cap, 0)
  })

  // Test #6 (ruling-(a) acceptance criterion, noesis-208): early in the sale the window is pinned to
  // the left edge (`[P(0), 3*P(0)]`), so the dot's height is `(P(here)/P(0) - 1) / (SPAN - 1)` — a
  // LOW dot early is the specified behaviour (rth ruled early should read as visibly early), not a
  // defect. This is what makes a future "fix" that lifts the dot toward the mid-window position fail
  // loudly instead of landing as an improvement.
  it.each([
    [0.02, 0.01],
    [0.05, 0.025],
    [0.17, 0.095],
  ])('dot height at %s sold is ~%s (left-pin regime)', (frac, expected) => {
    const here = frac * cap
    const vp = computeViewport(params, here)
    expect(vp.loSupply).toBe(0) // confirms we're in the left-pin regime for this params/fraction
    const herePrice = curvePriceAt(params, here)
    const dotHeight = (herePrice / p0 - 1) / (VIEWPORT_SPAN - 1)
    expect(dotHeight).toBeCloseTo(expected, 2)
  })
})
