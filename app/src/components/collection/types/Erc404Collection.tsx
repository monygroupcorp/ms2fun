/**
 * ERC404 collection surfaces (W-B1), split into the three page regions CollectionPage composes:
 *   Primary — the phase-aware trading UI (buy/sell / free-mint / reroll / graduate, or the embedded
 *             graduated swap). Lives in the shell's "works" column.
 *   Gallery — the DN404 mirror art (a 404 is also an NFT collection) as a grid below the shell.
 *   Admin   — creator admin (bonding lifecycle, style, vault, delegation); self-hides unless owner.
 * See `collectionSurfaces` for how the page picks these by contractType.
 */
import { BondingSurface } from '../erc404/BondingSurface'
import { Erc404Charts } from '../erc404/Erc404Charts'
import { Erc404Portfolio } from '../erc404/Erc404Portfolio'
import { Erc404AdminPanel } from '../erc404/Erc404AdminPanel'
import { Erc404NftGallery } from '../erc404/Erc404NftGallery'
import styles from './TypeSection.module.css'

export interface Erc404SurfaceProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc404Primary({ instance }: Erc404SurfaceProps) {
  return (
    <section className={styles.section} data-testid="erc404-collection">
      <h2 className={styles.title}>BONDING</h2>
      <BondingSurface instance={instance} />
    </section>
  )
}

export function Erc404ChartsSection({ instance }: Erc404SurfaceProps) {
  return (
    <section className={styles.section} data-testid="erc404-charts-section">
      <h2 className={styles.title}>CURVE</h2>
      <Erc404Charts instance={instance} />
    </section>
  )
}

export function Erc404PortfolioSection({ instance }: Erc404SurfaceProps) {
  // Self-hides when disconnected / holds no pieces.
  return <Erc404Portfolio instance={instance} />
}

export function Erc404Gallery({ instance }: Erc404SurfaceProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>PIECES</h2>
      <Erc404NftGallery instance={instance} />
    </section>
  )
}

export function Erc404Admin({ instance }: Erc404SurfaceProps) {
  return <Erc404AdminPanel instance={instance} />
}
