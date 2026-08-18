import { formatEther } from 'viem'
import type { AuctionPosition, PortfolioData } from './usePortfolio'

/** Format a wei value to a trimmed ETH string (drops trailing zeros, e.g. "1.5", "0"). */
export function fmtEth(wei: bigint): string {
  const s = formatEther(wei)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Count of collections with any non-zero holding — the plate's "held" standing figure. */
export function heldCount(data: PortfolioData | undefined): number {
  if (!data) return 0
  const [erc404, erc1155] = data
  const a = erc404.filter(
    (h) =>
      h.tokenBalance > 0n || h.nftBalance > 0n || h.stakedBalance > 0n || h.pendingRewards > 0n,
  ).length
  const b = erc1155.filter((h) => h.balances.some((x) => x > 0n)).length
  return a + b
}

/** Auction end timestamp (unix seconds) as a fixed UTC stamp — `YYYY-MM-DD HH:MM UTC`. */
export function fmtEndTime(endTime: bigint): string {
  if (endTime === 0n) return '—'
  const iso = new Date(Number(endTime) * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/**
 * Why the ETH is held, and what act releases it. Escrow is not withdrawable, so the copy must never
 * read as a claimable balance — it names the auction act instead.
 */
export function escrowNote(p: AuctionPosition): string {
  if (p.isCreatorDeposit) {
    if (p.reclaimable) return 'ended with no bids — reclaiming the piece returns this deposit'
    if (p.settleable) return 'ended with bids — settling the auction returns this deposit'
    return 'held by the auction until it settles or is reclaimed'
  }
  if (p.settleable) return 'you won — settling the auction mints the piece and releases the bid'
  return 'held while you are the high bidder; an outbid refunds you immediately'
}
