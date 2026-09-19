/**
 * The dollar figure that rides beside an ETH one, at the three places money is actually asked for:
 * a mint price, a bonding-curve quote, an auction bid.
 *
 * It renders NOTHING whenever the rate is unavailable — no feed on this chain, a failed read, a
 * broken answer, a round older than the ceiling (`lib/fiat.ts`). The surrounding surface is then
 * exactly what it was before this existed: the ETH figure, alone and correct. That is the intended
 * failure mode, not a gap to fill with a fallback rate.
 *
 * The provenance travels with the number as its `title`: which feed, what it resolved to per ETH,
 * and how old that round is. A dollar figure the reader cannot trace is one they cannot check.
 */
import type { SupportedChainId } from '../../lib/addresses'
import { describeRate, formatUsdFromWei } from '../../lib/fiat'
import { useEthUsdRate } from '../../lib/useEthUsd'
import styles from './FiatAmount.module.css'

export interface FiatAmountProps {
  /** The ETH amount to convert. `undefined` (a quote that has not resolved) renders nothing. */
  wei: bigint | undefined
  /** The chain the price is denominated on — the same one the surface reads its figures from. */
  chainId: SupportedChainId
  className?: string
  'data-testid'?: string
}

export function FiatAmount({ wei, chainId, className, 'data-testid': testId }: FiatAmountProps) {
  const rate = useEthUsdRate(chainId)
  if (wei === undefined || rate.status !== 'live') return null
  return (
    <span
      className={className ? `${styles.fiat} ${className}` : styles.fiat}
      title={describeRate(rate)}
      data-testid={testId}
    >
      {formatUsdFromWei(wei, rate)}
    </span>
  )
}
