import { formatGwei } from 'viem'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './CollectionsBrowse.module.css'

/**
 * Discovery read — the platform's own aggregation (`QueryAggregator.getHomePageData`) returns
 * registered collections + their live state in one call, so no event indexer is needed here.
 * Read-only and independent of the (gated) create path. Empty on a fresh fork until seeds exist —
 * proves the discovery pipeline like hello-chain, one tier up.
 *
 * NOTE: uses the generated hook directly (pattern: HelloChain). The typed domain-layer wrapper
 * that NOEMA also consumes is a deliberate Phase 2 design decision — not pre-committed here.
 */
export function CollectionsBrowse() {
  const { data, isPending, isError } = useReadQueryAggregatorGetHomePageData({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [0n, 24n],
  })

  if (isPending) return <p className={styles.note}>loading collections…</p>
  if (isError) return <p className={styles.note}>discovery unreachable — is the fork up?</p>

  const [cards] = data
  if (cards.length === 0) {
    return (
      <p className={styles.note} data-testid="collections-empty">
        no collections registered yet — the fork has none until seeds land (Phase 3).
      </p>
    )
  }

  return (
    <ul className={styles.grid} data-testid="collections-list">
      {cards.map((c) => (
        <li key={c.instance} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardName}>{c.name}</span>
            <span className={styles.cardType}>{c.contractType}</span>
          </div>
          <dl className={styles.meta}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>price</dt>
              <dd className={styles.metaValue}>
                {c.currentPrice > 0n ? `${formatGwei(c.currentPrice)} gwei` : '—'}
              </dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>supply</dt>
              <dd className={styles.metaValue}>{c.totalSupply.toString()}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabel}>status</dt>
              <dd className={styles.metaValue}>{c.isActive ? 'active' : 'inactive'}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  )
}
