/**
 * ERC721 auction state machine (W-B1) — a PURE derivation of the user-facing auction state from
 * contract reads. Legacy scattered this logic across a 899-LOC page with duplicated inline checks;
 * here it is one tested function so the B3 auction UI renders state without re-deriving it.
 *
 * The five states are everything the auction STRUCT can tell us. `unsoldReclaimed` (a sixth legacy
 * state) is NOT struct-derivable — it is detected from the `UnsoldReclaimed` event in B3's history
 * layer, not here. `endedNoBids` is the live state in which the owner's `reclaimUnsold` is available.
 */

export type AuctionState =
  | 'notStarted' // queued/empty slot or startTime still in the future
  | 'active' // live: now < endTime, bids accepted
  | 'endedWithBids' // now >= endTime, has a high bidder, not yet settled → anyone can settle
  | 'endedNoBids' // now >= endTime, no bidder → owner can reclaimUnsold
  | 'settled' // terminal: settled flag set

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** The struct fields `deriveAuctionState` needs — a subset of `getAuction`, binding-order-agnostic. */
export interface AuctionView {
  startTime: bigint
  endTime: bigint
  highBidder: `0x${string}`
  settled: boolean
}

/** True when the auction has a real high bidder (non-zero address). */
export function hasBids(a: Pick<AuctionView, 'highBidder'>): boolean {
  return a.highBidder.toLowerCase() !== ZERO_ADDRESS
}

/**
 * Derive the auction state from its struct at time `nowSec` (unix seconds, bigint).
 * `settled` is terminal and checked first; an empty slot (endTime 0) reads as `notStarted`.
 */
export function deriveAuctionState(a: AuctionView, nowSec: bigint): AuctionState {
  if (a.settled) return 'settled'
  if (a.endTime === 0n || nowSec < a.startTime) return 'notStarted'
  if (nowSec < a.endTime) return 'active'
  return hasBids(a) ? 'endedWithBids' : 'endedNoBids'
}
