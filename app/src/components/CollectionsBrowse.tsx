import { formatGwei } from 'viem'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './CollectionsBrowse.module.css'

/**
 * Featured-collections read — `QueryAggregator.getHomePageData` returns the currently-active
 * FEATURED instances (from FeaturedQueueManager), hydrated with live state, in one call. It is NOT
 * a full registry enumeration: there is no "all instances" getter, so a complete browse needs
 * event indexing (`CreatorInstanceAdded`) — deferred to the Phase 2/3 domain layer. Rendered as the
 * project-discovery card grid. Empty on a fresh fork (nothing featured yet).
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
    <div className={styles.grid} data-testid="collections-list">
      {cards.map((c) => (
        <article key={c.instance} className={styles.card}>
          <div className={styles.cardImage}>{c.name.slice(0, 1).toUpperCase() || '✦'}</div>
          <div className={styles.cardContent}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>{c.name}</h3>
              <span className="badge">{c.contractType}</span>
            </div>
            <div className={styles.cardStats}>
              <span className={styles.statSecondary}>price</span>
              <span className={styles.statMono}>{formatGwei(c.currentPrice)} gwei</span>
            </div>
            <div className={styles.cardStats}>
              <span className={styles.statSecondary}>supply</span>
              <span className={styles.statMono}>{c.totalSupply.toString()}</span>
            </div>
            <span className={`badge ${c.isActive ? 'badge-solid' : ''} ${styles.state}`}>
              {c.isActive ? 'active' : 'inactive'}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}
