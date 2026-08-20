/**
 * The min-out floor the zRouter swap panels sign (`GraduatedSwapPanel`, `Exec404SwapPanel`).
 *
 * Both panels read a free-text "slippage %" box, convert it to bps, and pass that straight to
 * `applySellSlippage` as the on-chain `amountLimit`. The box accepts any number, so the values that
 * reach the helper include the out-of-range ones: a tolerance at or above 100% must land on a
 * defined, non-negative floor rather than on a zero-or-negative `uint256` argument. These cases pin
 * that clamp for the panel path.
 */
import { describe, expect, it } from 'vitest'
import { applySellSlippage } from './bondingFormat'

/** A quoted output amount; any positive value works — the assertions are about the clamp. */
const QUOTE = 1_000_000n

/** Mirrors the panels' derivation of bps from the slippage input box. */
function panelBps(slippagePct: string): number {
  return Math.round((Number(slippagePct) || 0) * 100)
}

describe('swap panel min-out floor', () => {
  it('a 100% tolerance floors at zero', () => {
    expect(panelBps('100')).toBe(10_000)
    expect(applySellSlippage(QUOTE, 10_000)).toBe(0n)
  })

  it('a tolerance above 100% floors at zero rather than going negative', () => {
    expect(panelBps('150')).toBe(15_000)
    expect(applySellSlippage(QUOTE, 15_000)).toBe(0n)
    expect(applySellSlippage(QUOTE, 15_000) >= 0n).toBe(true)
  })

  it('every tolerance the input box can produce yields a floor within [0, quote]', () => {
    for (const pct of ['0', '1', '6', '99.99', '100', '150', '1e6', '-5', 'abc', '']) {
      const floor = applySellSlippage(QUOTE, panelBps(pct))
      expect(floor >= 0n).toBe(true)
      expect(floor <= QUOTE).toBe(true)
    }
  })

  it('a non-finite or non-positive tolerance is treated as zero tolerance (exact-quote floor)', () => {
    expect(applySellSlippage(QUOTE, Number.NaN)).toBe(QUOTE)
    expect(applySellSlippage(QUOTE, Number.POSITIVE_INFINITY)).toBe(QUOTE)
    expect(applySellSlippage(QUOTE, -5)).toBe(QUOTE)
  })

  it('an in-range tolerance still applies normally', () => {
    expect(panelBps('1')).toBe(100)
    expect(applySellSlippage(QUOTE, 100)).toBe(990_000n)
  })
})
