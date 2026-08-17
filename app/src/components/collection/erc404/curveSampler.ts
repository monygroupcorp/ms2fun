/**
 * Pure sampler for the ERC404 bonding price curve (W-B5 curve view).
 *
 * The on-chain integral `BondingCurveMath._calculateIntegralFromZero` is the area under the marginal
 * price function. The family is hyperbolic:
 *
 *   let s = supply / normalizationFactor        (WAD-normalized supply, "scaledSupplyWad")
 *   I(s) = -kCoeff · ln(1 - s / poleWad)
 *   P(s) = kCoeff / (poleWad - s)
 *
 * `poleWad` is the vertical asymptote and sits strictly beyond the top of the bonding range, so the
 * denominator is always positive over the sampled domain. This reproduces the curve SHAPE exactly
 * (the dot we plot uses the same formula at the live supply), which is all the chart needs — exact
 * cost quotes still come from the on-chain `calculateCost` in SwapPanel.
 *
 * NOTE: this is a second, independent implementation of the price curve. Nothing pins it to the
 * Solidity one; see contracts/docs/spec/BONDING_CURVE_ARITHMETIC.md §14.
 *
 * We work in floats: curve params can be large WAD integers, so we normalize out of WAD first and
 * then evaluate.
 */

const WAD = 1e18

export interface CurveParams {
  kCoeff: bigint
  poleWad: bigint
  normalizationFactor: bigint
}

export interface CurvePoint {
  /** Token supply at this sample (base units, as a float). */
  supply: number
  /** Marginal price in ETH per unit of normalized supply at this supply. */
  price: number
}

/** Build a `CurveParams` from the raw 3-tuple `curveParams()` returns. */
export function curveParamsFromTuple(tuple: readonly [bigint, bigint, bigint]): CurveParams {
  return {
    kCoeff: tuple[0],
    poleWad: tuple[1],
    normalizationFactor: tuple[2],
  }
}

/**
 * Marginal price at `supply` (token base units), derived from the curve parameters.
 * Returns 0 when normalizationFactor is 0 (misconfigured instance), and 0 at or beyond the pole,
 * which the on-chain library refuses to price at all.
 */
export function curvePriceAt(params: CurveParams, supply: number): number {
  const norm = Number(params.normalizationFactor)
  if (norm === 0) return 0

  // s = scaledSupplyWad, un-WAD'd (the on-chain code floors supply/norm; we keep the fractional
  // part for a smooth curve, the shape is identical).
  const s = supply / norm / WAD
  const pole = Number(params.poleWad) / WAD
  if (s >= pole) return 0

  const k = Number(params.kCoeff) / WAD
  return k / (pole - s)
}

/**
 * The top of the BONDING range (token base units, as a float) — the supply at which the normalized
 * `s` reaches 1.0. This is strictly below `poleWad` (the pole sits beyond the top of the bonding
 * range by construction), so it is always safe to price. Callers must sample/clamp against this, not
 * against `maxSupply` — `maxSupply` is the token's full supply and can sit past the pole.
 */
export function bondingCap(params: CurveParams): number {
  return Number(params.normalizationFactor) * WAD
}

/**
 * Inverse of `curvePriceAt`: the supply (token base units, as a float) at which the marginal price
 * equals `price`. Returns 0 for a non-positive price or a misconfigured (`normalizationFactor === 0`)
 * instance.
 */
export function curveSupplyAt(params: CurveParams, price: number): number {
  const norm = Number(params.normalizationFactor)
  if (norm === 0 || price <= 0) return 0
  const pole = Number(params.poleWad) / WAD
  const k = Number(params.kCoeff) / WAD
  const s = pole - k / price
  return s * norm * WAD
}

function sampleRange(params: CurveParams, lo: number, hi: number, samples: number): CurvePoint[] {
  const n = Math.max(2, samples)
  const out: CurvePoint[] = []
  for (let i = 0; i < n; i++) {
    const supply = lo + ((hi - lo) * i) / (n - 1)
    out.push({ supply, price: curvePriceAt(params, supply) })
  }
  return out
}

/**
 * Sample the curve at `samples` evenly spaced supplies across the whole bonding range
 * `[0, bondingCap(params)]`. Never `[0, maxSupply]` — `maxSupply` can sit past the pole. Returns
 * `samples` points (>= 2).
 */
export function sampleCurve(params: CurveParams, samples: number): CurvePoint[] {
  return sampleRange(params, 0, bondingCap(params), samples)
}

/** Visible price ratio held constant across the window — the adaptive viewport's governing constant. */
export const VIEWPORT_SPAN = 3.0
/** Where `here` sits across the window, in price-ratio terms. */
const VIEWPORT_ANCHOR = 1 / 3

/**
 * The adaptive viewport around the live position `hereSupply`: a window that holds the visible price
 * span constant (`VIEWPORT_SPAN`) and slides/pins as the sale fills, rather than a fixed crop.
 *
 * `loSupply`/`hiSupply` are the CLAMPED supply-domain edges (`0 <= loSupply <= hiSupply <= cap`).
 * `loPrice`/`hiPrice` are the prices AT those clamped edges (`P(loSupply)`, `P(hiSupply)`) — not the
 * unclamped `lo`/`hi` price targets that drove the domain solve. They are equal to the targets in the
 * unpinned-middle and right-pin branches, but diverge in the left-pin branch, where the window is
 * `[P(0), 3*P(0)]` by design — a low dot early is the specified behaviour, not a bug.
 *
 * `graduationPrice` (`P(cap)`) is always returned so the caller can label the graduation edge even
 * when it is off-window. `graduationInView` is true only when the right edge is pinned to graduation
 * (the window's upper price bound is `graduationPrice`).
 */
export interface Viewport {
  loSupply: number
  hiSupply: number
  loPrice: number
  hiPrice: number
  graduationPrice: number
  graduationInView: boolean
}

export function computeViewport(params: CurveParams, hereSupply: number): Viewport {
  const cap = bondingCap(params)
  const hereClamped = Math.min(Math.max(hereSupply, 0), cap)
  const herePrice = curvePriceAt(params, hereClamped)
  const graduationPrice = curvePriceAt(params, cap)

  let lo = herePrice / Math.pow(VIEWPORT_SPAN, VIEWPORT_ANCHOR)
  let hi = lo * VIEWPORT_SPAN
  let graduationInView = false
  if (hi >= graduationPrice) {
    hi = graduationPrice
    lo = hi / VIEWPORT_SPAN
    graduationInView = true
  }

  let L = Math.max(0, curveSupplyAt(params, lo))
  let U = Math.min(cap, curveSupplyAt(params, hi))
  if (L <= 0) {
    L = 0
    U = Math.min(cap, curveSupplyAt(params, curvePriceAt(params, 0) * VIEWPORT_SPAN))
  }

  return {
    loSupply: L,
    hiSupply: U,
    loPrice: curvePriceAt(params, L),
    hiPrice: curvePriceAt(params, U),
    graduationPrice,
    graduationInView,
  }
}

/** Sample the curve across a computed `Viewport`'s clamped supply domain. */
export function sampleViewport(
  params: CurveParams,
  viewport: Viewport,
  samples: number,
): CurvePoint[] {
  return sampleRange(params, viewport.loSupply, viewport.hiSupply, samples)
}
