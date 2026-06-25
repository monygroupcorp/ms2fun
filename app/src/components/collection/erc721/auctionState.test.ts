import { describe, expect, it } from 'vitest'
import { type AuctionView, deriveAuctionState, hasBids } from './auctionState'

const ZERO = '0x0000000000000000000000000000000000000000' as const
const BIDDER = '0x1111111111111111111111111111111111111111' as const

function auction(over: Partial<AuctionView> = {}): AuctionView {
  return { startTime: 100n, endTime: 200n, highBidder: ZERO, settled: false, ...over }
}

describe('hasBids', () => {
  it('is false for the zero address', () => {
    expect(hasBids({ highBidder: ZERO })).toBe(false)
  })
  it('is true for a real bidder', () => {
    expect(hasBids({ highBidder: BIDDER })).toBe(true)
  })
  it('is case-insensitive on the zero address', () => {
    expect(hasBids({ highBidder: '0x0000000000000000000000000000000000000000' })).toBe(false)
  })
})

describe('deriveAuctionState', () => {
  it('settled is terminal — wins even past endTime with bids', () => {
    expect(deriveAuctionState(auction({ settled: true, highBidder: BIDDER }), 999n)).toBe('settled')
  })

  it('empty slot (endTime 0) is notStarted', () => {
    expect(deriveAuctionState(auction({ startTime: 0n, endTime: 0n }), 50n)).toBe('notStarted')
  })

  it('before startTime is notStarted', () => {
    expect(deriveAuctionState(auction({ startTime: 100n }), 50n)).toBe('notStarted')
  })

  it('between start and end is active', () => {
    expect(deriveAuctionState(auction(), 150n)).toBe('active')
  })

  it('exactly at startTime is active (boundary)', () => {
    expect(deriveAuctionState(auction({ startTime: 100n }), 100n)).toBe('active')
  })

  it('exactly at endTime is ended (boundary, not active)', () => {
    expect(deriveAuctionState(auction({ highBidder: BIDDER }), 200n)).toBe('endedWithBids')
  })

  it('past endTime with a bidder is endedWithBids', () => {
    expect(deriveAuctionState(auction({ highBidder: BIDDER }), 300n)).toBe('endedWithBids')
  })

  it('past endTime with no bidder is endedNoBids', () => {
    expect(deriveAuctionState(auction({ highBidder: ZERO }), 300n)).toBe('endedNoBids')
  })
})
