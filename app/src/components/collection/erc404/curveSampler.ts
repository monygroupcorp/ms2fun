/**
 * Pure sampler for the ERC404 bonding price curve (W-B5 curve view).
 *
 * The on-chain integral `BondingCurveMath._calculateIntegralFromZero` is the area under the marginal
 * price function. Differentiating that integral w.r.t. supply gives the marginal PRICE the curve
 * charges at a given supply:
 *
 *   let s = supply / normalizationFactor        (WAD-normalized supply, "scaledSupplyWad")
 *   P(S) = initialPrice
 *        + quadraticCoeff · s^2
 *        + cubicCoeff     · s^3
 *        + quarticCoeff   · s^4
 *
 * Each coefficient is WAD-scaled and applied via `mulWad` on-chain, i.e. one division by 1e18 per
 * `mulWad`. In WAD float terms, with `s` expressed in whole (un-WAD) units, the coefficient already
 * carries its own WAD scaling, so we evaluate the polynomial directly on the un-WAD `s` and the
 * coefficients normalized out of WAD. This reproduces the curve SHAPE exactly (the dot we plot uses
 * the same formula at the live supply), which is all the chart needs — exact cost quotes still come
 * from the on-chain `calculateCost` in SwapPanel.
 *
 * We work in floats: curve params can be astronomically large WAD integers, so bigint arithmetic of
 * s^4 would overflow Number only after normalization anyway. We normalize first, then evaluate.
 */

const WAD = 1e18

export interface CurveParams {
  initialPrice: bigint
  quarticCoeff: bigint
  cubicCoeff: bigint
  quadraticCoeff: bigint
  normalizationFactor: bigint
}

export interface CurvePoint {
  /** Token supply at this sample (base units, as a float). */
  supply: number
  /** Marginal price in ETH per token at this supply. */
  price: number
}

/** Build a `CurveParams` from the raw 5-tuple `curveParams()` returns. */
export function curveParamsFromTuple(
  tuple: readonly [bigint, bigint, bigint, bigint, bigint],
): CurveParams {
  return {
    initialPrice: tuple[0],
    quarticCoeff: tuple[1],
    cubicCoeff: tuple[2],
    quadraticCoeff: tuple[3],
    normalizationFactor: tuple[4],
  }
}

/**
 * Marginal price (ETH/token) at `supply` (token base units), derived from the curve coefficients.
 * Returns 0 when normalizationFactor is 0 (misconfigured instance).
 */
export function curvePriceAt(params: CurveParams, supply: number): number {
  const norm = Number(params.normalizationFactor)
  if (norm === 0) return 0

  // s = scaledSupplyWad as a whole number (the on-chain code floors supply/norm; we keep the
  // fractional part for a smooth curve, the shape is identical).
  const s = supply / norm

  const base = Number(params.initialPrice) / WAD
  // Each term: coeff (WAD) · s^k, with one WAD division to undo the coefficient's WAD scaling,
  // then a final /WAD to express the price in ETH (initialPrice is in wei/WAD ETH units).
  const quad = (Number(params.quadraticCoeff) / WAD) * s * s
  const cubic = (Number(params.cubicCoeff) / WAD) * s * s * s
  const quartic = (Number(params.quarticCoeff) / WAD) * s * s * s * s

  return base + (quad + cubic + quartic) / WAD
}

/**
 * Sample the curve at `samples` evenly spaced supplies across [0, maxSupply].
 * `maxSupply` is in token base units (float). Returns `samples` points (>= 2).
 */
export function sampleCurve(params: CurveParams, maxSupply: number, samples: number): CurvePoint[] {
  const n = Math.max(2, samples)
  const top = maxSupply > 0 ? maxSupply : Number(params.normalizationFactor) || 1
  const out: CurvePoint[] = []
  for (let i = 0; i < n; i++) {
    const supply = (top * i) / (n - 1)
    out.push({ supply, price: curvePriceAt(params, supply) })
  }
  return out
}
