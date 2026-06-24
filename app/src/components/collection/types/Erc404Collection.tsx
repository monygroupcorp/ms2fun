/**
 * ERC404 bonding surface (W-B1 shell, filled in by W-B4). Routing target for
 * `contractType === 'ERC404'`. Delegates the whole phase-aware trading UI — buy/sell against
 * CurveParamsComputer quotes, gating/free-mint/reroll, permissionless graduate — to `BondingSurface`,
 * built on the pure `derivePhase` machine in `../erc404/bondingPhase`. The curve+candle chart (W-B5)
 * and staking (W-B7) mount inside `BondingSurface` at their marked seams.
 */
import { BondingSurface } from '../erc404/BondingSurface'
import styles from './TypeSection.module.css'

export interface Erc404CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc404Collection({ instance }: Erc404CollectionProps) {
  return (
    <section className={styles.section} data-testid="erc404-collection">
      <h2 className={styles.title}>BONDING</h2>
      <BondingSurface instance={instance} />
    </section>
  )
}
