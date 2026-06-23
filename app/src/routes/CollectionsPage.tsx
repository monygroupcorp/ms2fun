import { Link } from 'wouter'
import { CollectionsBrowse } from '../components/CollectionsBrowse'
import styles from './CollectionsPage.module.css'

/**
 * Discovery surface — featured collections via the platform's own aggregator read
 * (`getHomePageData` → FeaturedQueueManager). Read-only; independent of the gated create/wizard
 * path (see docs/HUMAN_GATES.md G-C). Ported from the project-discovery demo.
 */
export function CollectionsPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <h1 className={`${styles.title} text-chromatic-medium`}>FEATURED</h1>
      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount}>featured collections · live read</span>
      </div>
      <CollectionsBrowse />
    </div>
  )
}
