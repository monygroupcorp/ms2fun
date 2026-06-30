import { useState } from 'react'
import type { ContractFunctionReturnType } from 'viem'
import { formatGwei } from 'viem'
import { Link } from 'wouter'
import { queryAggregatorAbi } from '../generated/contracts'
import { resolveUri } from '../lib/metadata'
import { truncateAddress } from '../lib/format'
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
 * device (vendored signature.css): art fills, a top-left status chip, and a bottom name·creator·
 * price plate — the three corner data points, never more. The art is the collection's own
 * `metadata.image` (`resolveUri`), with a mono glyph fallback. Routing/reads are unchanged.
 */
interface CollectionCardProps {
  card: HomePageCard
  variant?: 'card' | 'lead'
}

export function CollectionCard({ card, variant = 'card' }: CollectionCardProps) {
  const metadata = useCollectionMetadata(card.metadataURI)
  const [imgError, setImgError] = useState(false)

  const title = metadata?.name || card.name
  const fallbackGlyph = card.name.slice(0, 1).toUpperCase() || '✦'

  return (
    <Link
      href={`/collection/${card.instance}`}
      className={variant === 'lead' ? 'noesis-card lead' : 'noesis-card'}
    >
      <div className={`art ${styles.art}`}>
        {metadata?.image && !imgError ? (
          <img
            src={resolveUri(metadata.image)}
            alt={title}
            className={styles.artImg}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className={styles.artFallback} aria-hidden>
            {fallbackGlyph}
          </span>
        )}
        <span className="st">{card.isActive ? 'Live' : 'Ended'}</span>
      </div>
      <div className="lab">
        <div className={styles.labMain}>
          <span className="nm">{title}</span>
          <span className="by">by {truncateAddress(card.creator)}</span>
        </div>
        <span className="px">{formatGwei(card.currentPrice)} gwei</span>
      </div>
    </Link>
  )
}
