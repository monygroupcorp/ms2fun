/**
 * ERC404 bonding surface (W-B1 shell, filled in by W-B4). Routing target for
 * `contractType === 'ERC404'`. Delegates the whole phase-aware trading UI — buy/sell against
 * CurveParamsComputer quotes, gating/free-mint/reroll, permissionless graduate — to `BondingSurface`,
 * built on the pure `derivePhase` machine in `../erc404/bondingPhase`. The curve+candle chart (W-B5)
 * and staking (W-B7) mount inside `BondingSurface` at their marked seams.
 */
import { BondingSurface } from '../erc404/BondingSurface'
import { Erc404AdminPanel } from '../erc404/Erc404AdminPanel'
import { Erc404NftGallery } from '../erc404/Erc404NftGallery'
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
      {/* W-D3: a DN404 is also an NFT collection — the mirror art (→ token page). Kept directly under
          the bonding surface (above the collapsed admin) so the work leads, especially post-graduation
          when the trading surface is just the link-out + history. */}
      <Erc404NftGallery instance={instance} />
      {/* W-E: creator admin (bonding lifecycle, style, vault, delegation) — self-hides unless owner. */}
      <Erc404AdminPanel instance={instance} />
    </section>
  )
}
