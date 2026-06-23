import { Link } from 'wouter'
import { CollectionsBrowse } from '../components/CollectionsBrowse'
import styles from './CollectionsPage.module.css'

/**
 * Discovery surface — featured collections via the platform's own aggregator read
 * (`getHomePageData` → FeaturedQueueManager). Read-only; independent of the gated create/wizard
 * path (see docs/HUMAN_GATES.md G-C). Full registry browse needs the indexed domain layer (P2/3).
 */
export function CollectionsPage() {
  return (
    <section className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <header className={styles.header}>
        <h1 className={styles.title}>FEATURED</h1>
        <p className={styles.kicker}>featured collections · live read</p>
      </header>
      <CollectionsBrowse />
    </section>
  )
}
