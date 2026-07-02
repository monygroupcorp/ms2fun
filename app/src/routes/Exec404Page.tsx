import { Link } from 'wouter'
import { Exec404Activity } from '../components/Exec404Activity'
import { Exec404Portfolio } from '../components/exec404/Exec404Portfolio'
import { Exec404Stats } from '../components/Exec404Stats'
import { Exec404SwapPanel } from '../components/Exec404SwapPanel'
import styles from './Exec404Page.module.css'

/**
 * The fossil: view EXEC404 / CULT EXECUTIVES against real on-chain state on the anvil mainnet-fork
 * (live market price from its graduated Uniswap V2 pool). Trading is embedded in-site (B19) — EXEC
 * swaps route through zRouter's swapV2 against the graduated pool, with a Uniswap link-out kept as a
 * secondary escape hatch. Ported from the project-erc404 demo.
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
          <Exec404Activity />
        </div>
        <aside className={styles.sidebar}>
          <Exec404SwapPanel />
          <Exec404Portfolio />
        </aside>
      </div>
    </div>
  )
}
