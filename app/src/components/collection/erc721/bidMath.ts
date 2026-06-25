/**
 * ERC721 auction bid math (W-B3) — pure helpers, separated from the UI so the minimum-bid rule is
 * tested once. The contract requires a bid of at least `max(minBid, highBid + bidIncrement)`; the
 * `minBid` floor applies to the first bid, the increment to every subsequent one.
 */

export interface BidInputs {
  minBid: bigint
  highBid: bigint
  highBidder: `0x${string}`
  bidIncrement: bigint
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** The minimum acceptable next bid for an auction (wei). */
export function minNextBid(a: BidInputs): bigint {
  const hasBid = a.highBidder.toLowerCase() !== ZERO_ADDRESS
  if (!hasBid) return a.minBid
  const incremented = a.highBid + a.bidIncrement
  return incremented > a.minBid ? incremented : a.minBid
}
