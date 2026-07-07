import { formatEther } from 'viem'
import type { PortfolioData } from './usePortfolio'

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
