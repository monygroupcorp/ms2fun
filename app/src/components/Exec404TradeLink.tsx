import { UNISWAP_SWAP_URL } from '../lib/exec404'
import styles from './Exec404TradeLink.module.css'

/**
 * EXEC404's bonding curve is closed (graduated) — it trades on a Uniswap V2 pool. Rather than
 * rebuild an in-app AMM swap for a grandfathered fossil, we link out to Uniswap with EXEC
 * preselected. (Decision: docs/HUMAN_GATES.md G-D — read-only + link-out.)
 */
export function Exec404TradeLink() {
  return (
    <section className={styles.panel} data-testid="exec404-tradelink">
      <p className={styles.note}>Bonding curve graduated — EXEC trades on a Uniswap V2 pool.</p>
      <a
        className={styles.link}
        href={UNISWAP_SWAP_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="exec404-uniswap-link"
      >
        TRADE ON UNISWAP ↗
      </a>
    </section>
  )
}
