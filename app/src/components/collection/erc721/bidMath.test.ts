import { describe, expect, it } from 'vitest'
import { type BidInputs, minNextBid } from './bidMath'

const ZERO = '0x0000000000000000000000000000000000000000' as const
const BIDDER = '0x1111111111111111111111111111111111111111' as const

function inputs(over: Partial<BidInputs> = {}): BidInputs {
  return { minBid: 100n, highBid: 0n, highBidder: ZERO, bidIncrement: 10n, ...over }
}

describe('minNextBid', () => {
  it('first bid must clear the minBid floor', () => {
    expect(minNextBid(inputs())).toBe(100n)
  })

  it('subsequent bid must clear highBid + increment', () => {
    expect(minNextBid(inputs({ highBidder: BIDDER, highBid: 200n }))).toBe(210n)
  })

  it('increment wins when it exceeds the floor', () => {
    expect(minNextBid(inputs({ highBidder: BIDDER, highBid: 200n, minBid: 100n }))).toBe(210n)
  })

  it('floor wins when a tiny increment would fall below it', () => {
    // edge: a high bid below the floor (possible if minBid was raised) — floor still applies
    expect(
      minNextBid(inputs({ highBidder: BIDDER, highBid: 50n, minBid: 100n, bidIncrement: 10n })),
    ).toBe(100n)
  })
})
