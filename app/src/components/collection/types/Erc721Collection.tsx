/**
 * ERC721 auction surface (W-B1 shell, filled in by W-B3). Routing target for
 * `contractType === 'ERC721'`. Delegates the multi-line auction UI — active auctions, bid form,
 * settle/reclaim, bid history — to `Erc721AuctionSurface`, built on the pure `deriveAuctionState`
 * machine in `../erc721/auctionState`.
 */
import { Erc721AdminPanel } from '../erc721/Erc721AdminPanel'
import { Erc721AuctionSurface } from '../erc721/Erc721AuctionSurface'
import { Erc721PieceGallery } from '../erc721/Erc721PieceGallery'
import styles from './TypeSection.module.css'

export interface Erc721CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc721Collection({ instance }: Erc721CollectionProps) {
  return (
    <section className={styles.section} data-testid="erc721-collection">
      <h2 className={styles.title}>AUCTIONS</h2>
      <Erc721AuctionSurface instance={instance} />
      {/* W-E/B: creator admin incl. queuePiece (add a piece) — self-hides unless owner. */}
      <Erc721AdminPanel instance={instance} />
      {/* W-D3: the full piece gallery (every minted/queued token + state badge → token page). */}
      <Erc721PieceGallery instance={instance} />
    </section>
  )
}
