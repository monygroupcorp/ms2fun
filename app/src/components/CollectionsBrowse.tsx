import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { CollectionCard } from './CollectionCard'
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
        <CollectionCard key={c.instance} card={c} />
      ))}
    </div>
  )
}
