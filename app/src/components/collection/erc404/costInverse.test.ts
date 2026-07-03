import { describe, expect, it } from 'vitest'
import { solveBuyAmount } from './costInverse'

/** Linear cost with a minimum: amounts below `min` price to 0 (the curve's PurchaseTooSmall zone). */
const linearWithMin =
  (min: bigint) =>
  async (a: bigint): Promise<bigint> =>
    a >= min ? a : 0n

/** Quadratic cost — a stand-in for the rising bonding curve. */
const quadratic = async (a: bigint): Promise<bigint> => a * a

describe('solveBuyAmount', () => {
  it('finds the largest amount whose cost <= target (exact, tolerance off)', async () => {
    const r = await solveBuyAmount({
      targetSpend: 5000n,
      maxAmount: 1_000_000n,
      costOf: linearWithMin(1000n),
      toleranceBps: 0,
    })
    expect(r).toEqual({ amount: 5000n, cost: 5000n })
  })

  it('never records a 0-cost (too-small) amount as a buy', async () => {
    // Costs jump 0 → 1000 at amount 1000; a 500-wei budget can buy nothing real.
    const r = await solveBuyAmount({
      targetSpend: 500n,
      maxAmount: 1_000_000n,
      costOf: linearWithMin(1000n),
      toleranceBps: 0,
    })
    expect(r).toBeUndefined()
  })

  it('buys the whole buyable ceiling when the budget exceeds it', async () => {
    const r = await solveBuyAmount({
      targetSpend: 1_000_000_000n,
      maxAmount: 1000n,
      costOf: async (a) => a, // cost(1000) = 1000 <= budget
      toleranceBps: 0,
    })
    expect(r).toEqual({ amount: 1000n, cost: 1000n })
  })

  it('converges on a rising (quadratic) curve within tolerance and never overspends', async () => {
    const target = 1_000_000_000_000n // sqrt = 1e6
    const r = await solveBuyAmount({
      targetSpend: target,
      maxAmount: 1_000_000_000n,
      costOf: quadratic,
    })
    expect(r).toBeDefined()
    expect(r!.cost).toBeLessThanOrEqual(target) // never overspends
    // within 0.5% below target
    expect((target - r!.cost) * 10_000n <= target * 50n).toBe(true)
    // amount near sqrt(target) = 1e6
    expect(r!.amount).toBeGreaterThan(995_000n)
    expect(r!.amount).toBeLessThanOrEqual(1_000_000n)
  })

  it('uses the seed to bracket without changing the answer', async () => {
    const withSeed = await solveBuyAmount({
      targetSpend: 5000n,
      maxAmount: 1_000_000_000n,
      costOf: linearWithMin(1000n),
      seed: 6000n, // a close over-estimate
      toleranceBps: 0,
    })
    expect(withSeed).toEqual({ amount: 5000n, cost: 5000n })
  })

  it('returns undefined for a non-positive target or ceiling', async () => {
    expect(await solveBuyAmount({ targetSpend: 0n, maxAmount: 100n, costOf: quadratic })).toBeUndefined()
    expect(await solveBuyAmount({ targetSpend: 100n, maxAmount: 0n, costOf: quadratic })).toBeUndefined()
  })

  it('bails when the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const r = await solveBuyAmount({
      targetSpend: 5000n,
      maxAmount: 1_000_000n,
      costOf: quadratic,
      signal: ctrl.signal,
    })
    expect(r).toBeUndefined()
  })
})
