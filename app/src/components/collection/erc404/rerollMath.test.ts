import { describe, expect, it } from 'vitest'
import { planReroll, type RerollPiece } from './rerollMath'

const UNIT = 1_000_000_000_000_000_000n // 1e18 coin per whole NFT

const ordinary = (id: bigint): RerollPiece => ({ id, isTier: false })
const tier = (id: bigint): RerollPiece => ({ id, isTier: true })

describe('planReroll — the app-side mirror of rerollSelectedNFTs', () => {
  it('rerolls every requested unit when the holder owns no tier NFT and keeps nothing', () => {
    const plan = planReroll({
      amount: 3n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), ordinary(3n)],
      keptIds: [],
    })
    expect(plan.exemptCount).toBe(0)
    expect(plan.effectiveCount).toBe(3)
    expect(plan.canReroll).toBe(true)
  })

  it('charges an auto-exempted tier NFT against the amount: 3 units, one tier NFT, 2 rerolled', () => {
    const plan = planReroll({
      amount: 3n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), ordinary(3n), tier(9001n)],
      keptIds: [],
    })
    expect(plan.exemptCount).toBe(1)
    expect(plan.exemptedIds).toEqual([9001n])
    expect(plan.effectiveCount).toBe(2)
    expect(plan.canReroll).toBe(true)
  })

  it('does not double-count a tier NFT the holder also selected explicitly', () => {
    const both = planReroll({
      amount: 3n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), ordinary(3n), tier(9001n)],
      keptIds: [9001n],
    })
    expect(both.exemptCount).toBe(1)
    expect(both.exemptedIds).toEqual([9001n])
    expect(both.effectiveCount).toBe(2)

    // Byte-identical to not naming it at all — the contract dedupes the same way.
    const auto = planReroll({
      amount: 3n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), ordinary(3n), tier(9001n)],
      keptIds: [],
    })
    expect(both.effectiveCount).toBe(auto.effectiveCount)
    expect(both.exemptCount).toBe(auto.exemptCount)
  })

  it('blocks an amount smaller than the exempt cost (contract: tokenAmount < exemptCount * unit)', () => {
    const plan = planReroll({
      amount: 1n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), tier(9001n), tier(9002n)],
      keptIds: [],
    })
    expect(plan.exemptCount).toBe(2)
    expect(plan.effectiveCount).toBe(0)
    expect(plan.canReroll).toBe(false)
    expect(plan.blockReason).toBe('amount-below-exempt-cost')
  })

  it('blocks when the exemptions consume the whole amount (contract: rerollAmount / unit == 0)', () => {
    const plan = planReroll({
      amount: 2n * UNIT,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), tier(9001n)],
      keptIds: [2n],
    })
    expect(plan.exemptCount).toBe(2)
    expect(plan.effectiveCount).toBe(0)
    expect(plan.canReroll).toBe(false)
    expect(plan.blockReason).toBe('nothing-left-to-reroll')
  })

  it('blocks a position that is entirely tier NFTs, before any amount is entered', () => {
    const plan = planReroll({
      amount: undefined,
      unit: UNIT,
      pieces: [tier(9001n), tier(9002n)],
      keptIds: [],
    })
    expect(plan.canReroll).toBe(false)
    expect(plan.blockReason).toBe('all-tier-position')
    expect(plan.effectiveCount).toBe(0)
  })

  it('rounds the effective count down, as the contract does', () => {
    const plan = planReroll({
      amount: 2n * UNIT + UNIT / 2n,
      unit: UNIT,
      pieces: [ordinary(1n), ordinary(2n), ordinary(3n)],
      keptIds: [],
    })
    expect(plan.effectiveCount).toBe(2)
    expect(plan.canReroll).toBe(true)
  })

  it('reports no block reason before an amount or the unit read lands', () => {
    const plan = planReroll({
      amount: undefined,
      unit: undefined,
      pieces: [ordinary(1n)],
      keptIds: [],
    })
    expect(plan.canReroll).toBe(false)
    expect(plan.blockReason).toBeUndefined()
  })
})
