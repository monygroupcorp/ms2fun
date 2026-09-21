import { describe, expect, it } from 'vitest'
import { MAX_ROYALTY_PERCENT, royaltyBpsFromPercent } from './royalty'

describe('royaltyBpsFromPercent', () => {
  it('converts what a creator types into basis points', () => {
    expect(royaltyBpsFromPercent('5')).toBe(500)
    expect(royaltyBpsFromPercent('2.5')).toBe(250)
    expect(royaltyBpsFromPercent(7.5)).toBe(750)
  })

  it('treats blank, garbage and negative as asking for no royalty', () => {
    expect(royaltyBpsFromPercent('')).toBe(0)
    expect(royaltyBpsFromPercent(undefined)).toBe(0)
    expect(royaltyBpsFromPercent('  ')).toBe(0)
    expect(royaltyBpsFromPercent('not a number')).toBe(0)
    expect(royaltyBpsFromPercent('-5')).toBe(0)
    expect(royaltyBpsFromPercent('0')).toBe(0)
  })

  it('rounds to the nearest basis point rather than truncating', () => {
    expect(royaltyBpsFromPercent('0.125')).toBe(13)
    expect(royaltyBpsFromPercent('1.004')).toBe(100)
  })

  // The field's own `max` is what a creator sees; this is the backstop, and it clamps rather than
  // throwing so a bug in this app cannot turn into a reverted deploy a creator cannot diagnose.
  it('clamps above the cap instead of producing a transaction the factory will refuse', () => {
    expect(royaltyBpsFromPercent('50')).toBe(MAX_ROYALTY_PERCENT * 100)
    expect(royaltyBpsFromPercent('100')).toBe(1000)
    expect(royaltyBpsFromPercent(MAX_ROYALTY_PERCENT)).toBe(1000)
  })

  it('agrees with the contract cap', () => {
    // RoyaltyLib.MAX_ROYALTY_BPS is 1000. If that constant moves, this is what catches the drift.
    expect(MAX_ROYALTY_PERCENT * 100).toBe(1000)
  })
})
