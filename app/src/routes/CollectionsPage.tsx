import { Link } from 'wouter'
import { CollectionsBrowse } from '../components/CollectionsBrowse'
import styles from './CollectionsPage.module.css'

/**
 * Discovery surface — browse registered collections via the platform's own aggregator read.
 * Read-only; independent of the gated create/wizard path (see docs/HUMAN_GATES.md G-C).
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
        <h1 className={styles.title}>COLLECTIONS</h1>
        <p className={styles.kicker}>registered on the platform · live read</p>
      </header>
      <CollectionsBrowse />
    </section>
  )
}
