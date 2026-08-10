import { describe, expect, it } from 'vitest'
import { bandOf, coinHoldings, escrowBehind, type TierBand } from './tierPosition'

const UNIT = 1_000_000_000_000_000_000n // 1e18 coin per whole NFT
const idLimit = 1000n

const tierOne: TierBand = { idStart: 1001n, idEnd: 1010n, weight: 2n }
const tierTwo: TierBand = { idStart: 1011n, idEnd: 1015n, weight: 5n }
const ladder = [tierOne, tierTwo]

describe('bandOf', () => {
  it('treats an id exactly at idLimit as ordinary, not a band — the boundary is strict', () => {
    expect(bandOf(1000n, ladder, idLimit)).toBeNull()
  })

  it('classifies the first id of a band', () => {
    expect(bandOf(1001n, ladder, idLimit)).toEqual({ isBand: true, tierN: 1, weight: 2n })
  })

  it('classifies the last id of a band', () => {
    expect(bandOf(1010n, ladder, idLimit)).toEqual({ isBand: true, tierN: 1, weight: 2n })
  })

  it('classifies an id in a second, higher-weight tier', () => {
    expect(bandOf(1013n, ladder, idLimit)).toEqual({ isBand: true, tierN: 2, weight: 5n })
  })

  it('returns null for an id between two bands (no gap should exist in a sealed ladder, but the walk does not assume it)', () => {
    const gappedLadder: TierBand[] = [
      { idStart: 1001n, idEnd: 1005n, weight: 2n },
      { idStart: 1010n, idEnd: 1015n, weight: 3n },
    ]
    expect(bandOf(1007n, gappedLadder, idLimit)).toBeNull()
  })

  it('returns null for an untiered holder (empty ladder)', () => {
    expect(bandOf(5000n, [], idLimit)).toBeNull()
  })
})

describe('escrowBehind', () => {
  it('is zero at the minimum legal weight of 2 minus the piece itself: (2 - 1) * unit', () => {
    expect(escrowBehind(2n, UNIT)).toBe(UNIT)
  })

  it('scales with weight for a higher tier', () => {
    expect(escrowBehind(5n, UNIT)).toBe(4n * UNIT)
  })
})

describe('coinHoldings', () => {
  it('equals plain balance when the holder owns no band pieces', () => {
    expect(coinHoldings(3n * UNIT, [], UNIT)).toBe(3n * UNIT)
  })

  it('sums balance plus escrow across band pieces from two different tiers', () => {
    const bandPieces = [{ weight: 2n }, { weight: 5n }]
    // balance (1 unit) + escrow(2) [1 unit] + escrow(5) [4 units] = 6 units
    expect(coinHoldings(1n * UNIT, bandPieces, UNIT)).toBe(6n * UNIT)
  })
})
