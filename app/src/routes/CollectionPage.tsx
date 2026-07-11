import { Link, useParams } from 'wouter'
import { formatGwei } from 'viem'
import { useAccount } from 'wagmi'
import { useCollection } from '../components/useCollection'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { MessageComposer } from '../components/MessageComposer'
import { MessageFeed } from '../components/MessageFeed'
import { VaultPanel } from '../components/collection/VaultPanel'
import { FeaturedPanel } from '../components/featured/FeaturedPanel'
import { resolveCollectionSurfaces } from '../components/collection/types/collectionSurfaces'
import { ProjectStyle } from '../components/collection/ProjectStyle'
import { CollectionHero } from '../components/collection/CollectionHero'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
import { MintBar } from '../components/ui/MintBar'
import styles from './CollectionPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw as `0x${string}`
  return undefined
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function CollectionPage() {
  const params = useParams<{ instance?: string }>()
  const instance = toAddress(params.instance)

  const { data: card, isPending, isError } = useCollection(instance)
  const metadata = useCollectionMetadata(card?.metadataURI)
  const { address: connected } = useAccount()

  if (!instance) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← noesis
          </Link>
        </nav>
        <p className={styles.kicker}>Collections</p>
        <h1 className={styles.title}>Collection</h1>
        <StateBlock variant="empty">invalid collection address</StateBlock>
      </div>
    )
  }

  const isNotFound = !isPending && !isError && (!card || card.instance === ZERO_ADDRESS)

  // Mint-state readout for the mobile MintBar (the hero owns the desktop readout).
  const minted = card?.totalSupply ?? 0n
  const cap = card?.maxSupply ?? 0n

  // Per-type surfaces, split across the page's three regions: Primary (in the shell), Gallery
  // (pieces grid below the shell, N10), Admin (below the featured queue, N5).
  const surfaces = card ? resolveCollectionSurfaces(card.contractType) : undefined

  return (
    <div className={styles.page} data-testid="collection-detail">
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
        </Link>
      </nav>

      {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}
      {isError && (
        <StateBlock variant="error">couldn't load collection — is the fork up?</StateBlock>
      )}

      {isNotFound && <StateBlock variant="empty">collection not found</StateBlock>}

      {!isPending && !isError && card && card.instance !== ZERO_ADDRESS && (
        <>
          {/* Creator-supplied page CSS (ERC1155 + ERC404 carry styleUri). Renders nothing; injects
              scoped CSS + the `has-project-style` body flag while this page is mounted. */}
          {(card.contractType === 'ERC1155' || card.contractType === 'ERC404') && (
            <ProjectStyle instance={instance} />
          )}

          {/* The gallery hang: a specimen rail (the disclosure) beside the works (the goods).
              Transparency-forward — the mechanic is read before you acquire. Extracted to
              CollectionHero so the launch-wizard style preview renders the SAME markup with mock
              data. The type-specific primary action (buy/sell for 404, bid for 721) is slotted in;
              the 1155 has none — minting is per-edition down in the gallery. */}
          <CollectionHero
            instance={instance}
            card={card}
            metadata={metadata}
            primary={
              surfaces?.Primary ? (
                <surfaces.Primary instance={instance} creator={card.creator} />
              ) : undefined
            }
          />

          {/* ERC404 curve + candles, full-width below the shell (they made the trading column tower
              over the specimen rail). Above the gallery. */}
          {surfaces?.Charts && (
            <div className={styles.chartSlot}>
              <surfaces.Charts instance={instance} creator={card.creator} />
            </div>
          )}

          {/* Holder portfolio: your own pieces + reroll (multiselect keep), above the full gallery.
              Renders with no wrapper — it self-hides (returns null) when disconnected / you hold none,
              so there's no empty spacer; the card owns its own top margin. */}
          {surfaces?.Portfolio && (
            <surfaces.Portfolio instance={instance} creator={card.creator} />
          )}

          {/* N10: the pieces as a uniform grid, full-width below the shell (global treatment).
              Given generous head/tail space so the work breathes before the secondary panels. */}
          {surfaces?.Gallery && (
            <div className={styles.gallerySlot}>
              <surfaces.Gallery instance={instance} creator={card.creator} />
            </div>
          )}

          {/* Secondary, demoted below the hang and collapsed by default (self-rendered as
              <Disclosure> inside each panel, so a null vault doesn't leave an empty box). */}
          {instance && <VaultPanel vault={card.vault} benefactor={instance} />}
          {/* W-H: user-facing featured-queue economics (rent / boost / renew / prune). */}
          <FeaturedPanel instance={instance} />

          {/* N5: creator admin, below the featured queue and outside the shell. Self-hides unless
              the connected wallet owns the instance. */}
          {surfaces?.Admin && <surfaces.Admin instance={instance} creator={card.creator} />}

          {/* N11: the "write something" composer lives INSIDE the activity section (as its footer),
              so an empty "no activity yet" reads directly above it. B6: posts to THIS collection's
              channel (channel = instance address); attributed on-chain, gated on a connected wallet. */}
          <MessageFeed
            filter={{ instance }}
            footer={
              connected !== undefined ? (
                <section className={styles.composeSection}>
                  <MessageComposer channel={instance} />
                  <p className={styles.composeNote}>
                    signed by {truncateAddress(connected)} · posts to this collection's activity
                  </p>
                </section>
              ) : (
                <StateBlock variant="empty" boxed>
                  connect your wallet to post to this collection's activity.
                </StateBlock>
              )
            }
          />

          {/* Mobile: the mint moment stays in thumb reach (the rail's job on desktop). */}
          {/* ERC721 collections are auctions — the action is a bid, not a mint (the same #mint
              section wraps the auction surface, so the anchor is still correct). */}
          <MintBar
            price={`${formatGwei(card.currentPrice)} gwei`}
            sub={cap > 0n ? `${(cap - minted).toString()} left` : card.isActive ? 'open' : 'ended'}
            action={<a href="#mint">{card.contractType === 'ERC721' ? 'Bid' : 'Mint'}</a>}
          />
        </>
      )}
    </div>
  )
}
