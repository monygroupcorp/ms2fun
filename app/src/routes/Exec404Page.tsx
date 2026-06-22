import { Link } from 'wouter'
import { Exec404Stats } from '../components/Exec404Stats'
import { Exec404Trade } from '../components/Exec404Trade'
import styles from './Exec404Page.module.css'

/**
 * The fossil slice: view + trade EXEC404 / CULT EXECUTIVES against real on-chain state on the
 * anvil mainnet-fork. First vertical proving wallet → typed read → typed write → brutalist UI.
 */
export function Exec404Page() {
  return (
    <section className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <header className={styles.header}>
        <h1 className={styles.title}>CULT EXECUTIVES</h1>
        <p className={styles.kicker}>the fossil · grandfathered forever</p>
      </header>
      <div className={styles.layout}>
        <Exec404Stats />
        <Exec404Trade />
      </div>
    </section>
  )
}
