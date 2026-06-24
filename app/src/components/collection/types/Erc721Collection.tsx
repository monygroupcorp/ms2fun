/**
 * ERC721 auction surface (W-B1 shell). Routing target for `contractType === 'ERC721'`. The auction
 * UI — active/past auctions, bid form, settle/reclaim, bid history, multi-line queues — lands in
 * W-B3, built on the pure `deriveAuctionState` machine in `../erc721/auctionState`.
 */
import styles from './TypeSection.module.css'

export interface Erc721CollectionProps {
  instance: `0x${string}`
  creator: `0x${string}`
}

export function Erc721Collection(_props: Erc721CollectionProps) {
  return (
    <section className={styles.section} data-testid="erc721-collection">
      <h2 className={styles.title}>AUCTIONS</h2>
      <p className={styles.note}>auction interface coming up (W-B3)</p>
    </section>
  )
}
