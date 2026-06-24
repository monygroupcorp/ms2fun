/**
 * ERC404 bonding surface (W-B1 shell). Routing target for `contractType === 'ERC404'`. The trading
 * UI — buy/sell against CurveParamsComputer quotes, phase/gating/free-mint/reroll, the curve+candle
 * chart (W-B5) and staking (W-B7) — lands in W-B4, built on the pure `derivePhase` machine in
 * `../erc404/bondingPhase`.
 */
import styles from './TypeSection.module.css'

export interface Erc404CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc404Collection(_props: Erc404CollectionProps) {
  return (
    <section className={styles.section} data-testid="erc404-collection">
      <h2 className={styles.title}>BONDING</h2>
      <p className={styles.note}>bonding-curve trading coming up (W-B4)</p>
    </section>
  )
}
