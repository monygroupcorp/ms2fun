import { Link } from 'wouter'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { CollectionCard } from '../components/CollectionCard'
import styles from './HomePage.module.css'
import browseStyles from '../components/CollectionsBrowse.module.css'

/**
 * Landing page — shows the featured collection grid with EXEC404 / CULT EXECUTIVES pinned first,
 * plus a link to the full collections browse. Read path only; no wallet required.
 */
export function HomePage() {
  const { data, isPending, isError } = useReadQueryAggregatorGetHomePageData({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [0n, 24n],
  })

  const featuredCards = data?.[0] ?? null

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={`${styles.title} text-chromatic-strong`}>ms2.fun</h1>
        <p className={styles.tagline}>the opinionated boutique launchpad</p>
      </section>

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
    </div>
  )
}
