import { useMemo } from 'react'
import { Link } from 'wouter'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { useAllCollections } from '../lib/discovery'
import { CollectionCard, type HomePageCard } from '../components/CollectionCard'
import { HomeStats } from '../components/home/HomeStats'
import { ActivityPreview } from '../components/home/ActivityPreview'
import styles from './HomePage.module.css'
import browseStyles from '../components/CollectionsBrowse.module.css'

/**
 * Landing surface. Composed from:
 *  - a featured grid (fast path: `getHomePageData`) with EXEC404 / CULT EXECUTIVES pinned first,
 *    remaining featured cards ordered by on-chain `featuredRank` (lower rank = higher placement),
 *  - a stats bar (featured count from the fast path; total collections from the full-registry scan,
 *    which fills in when ready — the page never blocks on it),
 *  - a read-only recent-activity preview (shares the board's global feed cache).
 *
 * Read path only; no wallet required.
 */
export function HomePage() {
  const { data, isPending, isError } = useReadQueryAggregatorGetHomePageData({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [0n, 24n],
  })

  // Full-registry total for the stats bar. Independent query — its own loading state, so the
  // (slower) event scan never blocks the featured fast path above.
  const { total: totalCollections, isPending: totalPending } = useAllCollections()

  const featuredRaw = data?.[0] ?? null
  const totalFeatured = data?.[1]

  // Featured ordering: ascending featuredRank (the queue's effective rank; lower = higher).
  // Cards with rank 0 (unranked) sort to the end so genuinely-boosted entries lead.
  const featuredCards = useMemo((): readonly HomePageCard[] | null => {
    if (featuredRaw === null) return null
    const rankKey = (c: HomePageCard) =>
      c.featuredRank === 0n ? BigInt(Number.MAX_SAFE_INTEGER) : c.featuredRank
    return [...featuredRaw].sort((a, b) => {
      const ra = rankKey(a)
      const rb = rankKey(b)
      return ra < rb ? -1 : ra > rb ? 1 : 0
    })
  }, [featuredRaw])

  const featuredCount = totalFeatured !== undefined ? Number(totalFeatured) : featuredCards?.length

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={`${styles.title} text-chromatic-strong`}>ms2.fun</h1>
        <p className={styles.tagline}>the opinionated boutique launchpad</p>
      </section>

      <HomeStats
        stats={[
          {
            label: 'collections',
            value: String(totalCollections),
            pending: totalPending,
          },
          {
            label: 'featured',
            // +1 for the pinned EXEC404 fossil, which is not in the queue.
            value: featuredCount !== undefined ? String(featuredCount + 1) : '—',
            pending: isPending,
          },
          {
            label: 'fossil',
            value: 'EXEC404',
          },
        ]}
      />

      <section className={styles.featured}>
        <div className={styles.featuredHeader}>
          <h2 className={styles.sectionTitle}>FEATURED</h2>
          <Link href="/collections" className={styles.browseLink} data-testid="collections-link">
            Browse all collections →
          </Link>
        </div>

        {isPending && <p className={browseStyles.note}>loading collections…</p>}
        {isError && <p className={browseStyles.note}>discovery unreachable — is the fork up?</p>}

        {!isPending && !isError && (
          <div className={browseStyles.grid}>
            {/* EXEC404 / CULT EXECUTIVES — grandfathered fossil, always pinned first */}
            <article className={styles.execCard} data-testid="exec404-link">
              <Link href="/exec404" className={styles.execLink}>
                <div className={styles.execImage}>✕</div>
                <div className={styles.execContent}>
                  <div className={styles.execHead}>
                    <h3 className={styles.execTitle}>CULT EXECUTIVES</h3>
                    <span className="badge">ERC404</span>
                  </div>
                  <p className={styles.execDescription}>
                    The one live deployment, grandfathered forever. Real market price from its V2
                    pool.
                  </p>
                  <div className={styles.execMeta}>
                    <span className={styles.metaLabel}>type</span>
                    <span className={styles.metaMono}>EXEC · fossil</span>
                  </div>
                  <span className={`badge badge-solid ${styles.execState}`}>active</span>
                </div>
              </Link>
            </article>

            {featuredCards !== null && featuredCards.length === 0 && (
              <p
                className={browseStyles.note}
                data-testid="collections-empty"
                style={{ gridColumn: '1 / -1' }}
              >
                nothing featured yet — run the seed script to populate.
              </p>
            )}

            {featuredCards !== null &&
              featuredCards.map((c) => <CollectionCard key={c.instance} card={c} />)}
          </div>
        )}
      </section>

      <ActivityPreview />
    </div>
  )
}
