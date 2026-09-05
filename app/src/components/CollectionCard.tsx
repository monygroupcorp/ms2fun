import type { ContractFunctionReturnType } from 'viem'
import { Link } from 'wouter'
import { queryAggregatorAbi } from '../generated/contracts'
import { IpfsImage } from './ui/IpfsImage'
import { formatPrice, formatPriceTitle, truncateAddress } from '../lib/format'
import { forkChainId } from '../lib/addresses'
import { cardStatus } from '../lib/cardStatus'
import { useCollectionMetadata } from './useCollectionMetadata'
import styles from './CollectionCard.module.css'

/**
 * Element type of the cards array returned by `QueryAggregator.getProjectCardsBatch`.
 * Both `getHomePageData` and `getProjectCardsBatch` return the same `ProjectCard` struct,
 * so this type is structurally compatible with both call sites.
 */
export type HomePageCard = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getProjectCardsBatch'
>[number]

/**
 * The NOESIS collection card — one component at two grid scales (the registry list row is the
 * same data in a different device, owned by the browse list-toggle). `lead` is the Home/featured
 * hero size; the default is the browse contact-sheet tile. Visual layer is the `.noesis-card`
 * device (vendored signature.css): art fills, a top-left status chip when there is one to draw
 * (see `cardStatus` — a finished collection gets none), and a bottom name·creator·
 * price plate — the three corner data points, never more. The art is the collection's own
 * `metadata.image` (`resolveUri`), with a mono glyph fallback. Routing/reads are unchanged.
 */
interface CollectionCardProps {
  card: HomePageCard
  variant?: 'card' | 'lead'
}

export function CollectionCard({ card, variant = 'card' }: CollectionCardProps) {
  const metadata = useCollectionMetadata(card.metadataURI)
  const status = cardStatus(card)
  const title = metadata?.name || card.name
  const fallbackGlyph = card.name.slice(0, 1).toUpperCase() || '✦'

  return (
    <Link
      href={`/${forkChainId}/${card.name.toLowerCase()}`}
      className={variant === 'lead' ? 'noesis-card lead' : 'noesis-card'}
    >
      <div className={`art ${styles.art}`}>
        <IpfsImage
          uri={metadata?.image ?? ''}
          alt={title}
          className={styles.artImg}
          fallback={
            <span className={styles.artFallback} aria-hidden>
              {fallbackGlyph}
            </span>
          }
        />
        {status && <span className="st">{status}</span>}
      </div>
      <div className="lab">
        <div className={styles.labMain}>
          <span className="nm">{title}</span>
          <span className="by">by {truncateAddress(card.creator)}</span>
        </div>
        <span className="px" title={formatPriceTitle(card.currentPrice)}>
          {formatPrice(card.currentPrice)}
        </span>
      </div>
    </Link>
  )
}
