import { formatGwei } from 'viem'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './CollectionsBrowse.module.css'

/**
 * Featured-collections read — `QueryAggregator.getHomePageData` returns the currently-active
 * FEATURED instances (from FeaturedQueueManager), hydrated with live state, in one call. It is NOT
 * a full registry enumeration: there is no "all instances" getter, so a complete browse needs
 * event indexing (`CreatorInstanceAdded`) — deferred to the Phase 2/3 domain layer. Read-only and
 * independent of the gated create path. Empty on a fresh fork (nothing featured yet).
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
        nothing featured yet — featured placements appear here (full browse needs the indexed domain
        layer, Phase 2/3).
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
              <dd className={styles.metaValue}>{`${formatGwei(c.currentPrice)} gwei`}</dd>
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
