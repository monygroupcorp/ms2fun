import { Link } from 'wouter'
import { Exec404Stats } from '../components/Exec404Stats'
import { Exec404TradeLink } from '../components/Exec404TradeLink'
import styles from './Exec404Page.module.css'

/**
 * The fossil: view EXEC404 / CULT EXECUTIVES against real on-chain state on the anvil mainnet-fork
 * (live market price from its graduated Uniswap V2 pool). Read-only — the bonding curve is closed,
 * so trading links out to Uniswap (see docs/HUMAN_GATES.md G-D). Ported from the project-erc404 demo.
 */
export function Exec404Page() {
  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <header className={styles.header}>
        <p className={styles.kicker}>The fossil · the origin specimen · past tense</p>
        <div className={styles.icon} aria-hidden>
          ✕
        </div>
        <h1 className={styles.title}>
          CULT EXECUTIVES <span className={styles.ticker}>EXEC</span>
        </h1>
        <div className={styles.meta}>
          <span>DN404 genesis</span>
          <span>grandfathered fossil</span>
          <span>graduated → Uniswap V2</span>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <Exec404Stats />
        </div>
        <aside className={styles.sidebar}>
          <Exec404TradeLink />
        </aside>
      </div>
    </div>
  )
}
