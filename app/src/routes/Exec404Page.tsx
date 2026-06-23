import { Link } from 'wouter'
import { Exec404Stats } from '../components/Exec404Stats'
import { Exec404TradeLink } from '../components/Exec404TradeLink'
import styles from './Exec404Page.module.css'

/**
 * The fossil slice: view EXEC404 / CULT EXECUTIVES against real on-chain state on the anvil
 * mainnet-fork (live market price from its graduated Uniswap V2 pool). The fossil's bonding curve
 * is closed, so trading links out to Uniswap (read-only page — see docs/HUMAN_GATES.md G-D).
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
        <Exec404TradeLink />
      </div>
    </section>
  )
}
