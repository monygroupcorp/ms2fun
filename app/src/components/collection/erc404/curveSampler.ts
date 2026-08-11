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
 * Sample the curve at `samples` evenly spaced supplies across [0, maxSupply].
 * `maxSupply` is in token base units (float). Returns `samples` points (>= 2).
 */
export function sampleCurve(params: CurveParams, maxSupply: number, samples: number): CurvePoint[] {
  const n = Math.max(2, samples)
  const top = maxSupply > 0 ? maxSupply : Number(params.normalizationFactor) * WAD
  const out: CurvePoint[] = []
  for (let i = 0; i < n; i++) {
    const supply = (top * i) / (n - 1)
    out.push({ supply, price: curvePriceAt(params, supply) })
  }
  return out
}
