/**
 * ERC721 auction collection surfaces (W-B1 shell, W-B3), split into the three page regions
 * CollectionPage composes:
 *   Primary — the live auction: active auctions, bid form, settle/reclaim, bid history. Shell column.
 *   Gallery — every minted/queued token (art + state badge → token page) as a grid below the shell.
 *   Admin   — creator admin incl. queuePiece; self-hides unless owner.
 */
import { Erc721AdminPanel } from '../erc721/Erc721AdminPanel'
import { Erc721AuctionSurface } from '../erc721/Erc721AuctionSurface'
import { Erc721PieceGallery } from '../erc721/Erc721PieceGallery'
import styles from './TypeSection.module.css'

export interface Erc721SurfaceProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc721Primary({ instance }: Erc721SurfaceProps) {
  return (
    <section className={styles.section} data-testid="erc721-collection">
      <h2 className={styles.title}>AUCTIONS</h2>
      <Erc721AuctionSurface instance={instance} />
    </section>
  )
}

export function Erc721Gallery({ instance }: Erc721SurfaceProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>PIECES</h2>
      <Erc721PieceGallery instance={instance} />
    </section>
  )
}

export function Erc721Admin({ instance }: Erc721SurfaceProps) {
  return <Erc721AdminPanel instance={instance} />
}
