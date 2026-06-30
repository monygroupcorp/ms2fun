import { useMemo } from 'react'
import { Link } from 'wouter'
import { useAccount } from 'wagmi'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { useAllCollections } from '../lib/discovery'
import { CollectionCard, type HomePageCard } from '../components/CollectionCard'
import { HomeStats } from '../components/home/HomeStats'
import { ActivityPreview } from '../components/home/ActivityPreview'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './HomePage.module.css'

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
/**
 * Pre-connect splash (Surface 1, "the honest wall"): shown on `/` to a disconnected visitor — the
 * marketing hero (chromatic headline + the "how alignment works" ledger + the bind). Once a wallet
 * is connected, `/` becomes the discovery home below. The mechanic is the marketing; the chromatic
 * moment is display-only, one word.
 */
function HeroLanding() {
  return (
    <div className={styles.hero}>
      <div className={styles.heroLeft}>
        <p className="noesis-kicker">Onchain · Ethereum · No grift</p>
        <h1 className={styles.heroTitle}>
          <span className="text-chromatic-strong">alignment</span> launchpad.
        </h1>
        <p className={styles.heroSub}>
          Onchain releases that are <b>forced to align.</b> Deploy a collection and ~20% of every
          fee binds, by contract, to the work that inspired you. No promises — just commitment you
          can read onchain.
        </p>
        <div className={styles.heroActions}>
          <Link href="/launch" className={styles.heroPrimary}>
            Launch a collection
          </Link>
          <Link href="/collections" className={styles.heroSecondary}>
            Browse
          </Link>
        </div>
      </div>
      <aside className={styles.heroRight}>
        <div className="noesis-ledger">
          <div className="noesis-ledger-head">
            <span>How alignment works</span>
            <span>Ethereum · Live</span>
          </div>
          <div className="noesis-ledger-row">
            <span className="n">01</span>
            <span>
              Deploy<small>ERC404 / 1155 / 721, your terms</small>
            </span>
            <span className="v">creator</span>
          </div>
          <div className="noesis-ledger-row">
            <span className="n">02</span>
            <span>
              Fee split<small>set once, enforced forever</small>
            </span>
            <span className="v">~20%</span>
          </div>
          <div className="noesis-ledger-row">
            <span className="n">03</span>
            <span>
              Bind<small>to your stated inspiration&rsquo;s vault</small>
            </span>
            <span className="v">on-mint</span>
          </div>
        </div>
        <div className={`noesis-bind ${styles.heroBind}`}>
          <div className="cell">
            your launch<b>fees</b>
          </div>
          <div className="arrow">→</div>
          <div className="cell vault">
            alignment vault<b>~20%</b>
          </div>
        </div>
        <p className={styles.heroFoot}>▪ contract-enforced · no promises, just commitment</p>
      </aside>
    </div>
  )
}

export function HomePage() {
  const { address: connected } = useAccount()
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

  // Pre-connect: the marketing hero leads. Connected: the discovery home (below).
  if (!connected) {
    return (
      <div className={styles.page}>
        <HeroLanding />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* No bespoke hero — Home reuses the discovery grammar (collections-spec). The vital-signs
          bar leads; the work, not a banner, carries the page. */}
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

      <div className={styles.body}>
        <section className={styles.featured}>
          <div className={styles.featuredHeader}>
            <h2 className={styles.sectionTitle}>Featured</h2>
            <span className={styles.paidLabel}>· paid placement, labelled — not an endorsement</span>
            <Link href="/collections" className={styles.browseLink} data-testid="collections-link">
              Browse all collections →
            </Link>
          </div>

          {isPending && (
            <StateBlock variant="loading" boxed>
              hanging the work…
            </StateBlock>
          )}
          {isError && (
            <StateBlock variant="error" boxed>
              discovery unreachable — is the fork up?
            </StateBlock>
          )}

          {!isPending && !isError && (
            <div className={styles.featuredGrid}>
              {/* EXEC404 / CULT EXECUTIVES — grandfathered fossil, always pinned first.
                  Read-only specimen; trading lives on Uniswap (its full surface is the fossil page). */}
              <Link href="/exec404" className="noesis-card" data-testid="exec404-link">
                <div className={`art ${styles.execArt}`}>
                  <span className={styles.execGlyph} aria-hidden>
                    ✕
                  </span>
                  <span className="st">Fossil</span>
                </div>
                <div className="lab">
                  <div className={styles.execLabMain}>
                    <span className="nm">CULT EXECUTIVES</span>
                    <span className="by">EXEC · grandfathered</span>
                  </div>
                  <span className="px">Uniswap ↗</span>
                </div>
              </Link>

              {featuredCards !== null && featuredCards.length === 0 && (
                <StateBlock
                  variant="empty"
                  boxed
                  testId="collections-empty"
                  className={styles.gridSpan}
                >
                  this wall is empty — run the seed script to populate.
                </StateBlock>
              )}

              {featuredCards !== null &&
                featuredCards.map((c, i) => (
                  <CollectionCard key={c.instance} card={c} variant={i === 0 ? 'lead' : 'card'} />
                ))}
            </div>
          )}
        </section>

        <aside className={styles.rail}>
          <ActivityPreview />
        </aside>
      </div>
    </div>
  )
}
