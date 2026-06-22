import { Link } from 'wouter'
import { HelloChain } from '../components/HelloChain'
import styles from './HomePage.module.css'

export function HomePage() {
  return (
    <section className={styles.home}>
      <h1 className={styles.title}>ms2.fun</h1>
      <p className={styles.tagline}>the opinionated boutique launchpad</p>
      <HelloChain />
      <p className={styles.links}>
        <Link href="/collections" className={styles.link} data-testid="collections-link">
          → COLLECTIONS
        </Link>
        <Link href="/exec404" className={styles.link} data-testid="exec404-link">
          → CULT EXECUTIVES
        </Link>
      </p>
    </section>
  )
}
