import type { ContractFunctionReturnType } from 'viem'
import { formatGwei } from 'viem'
import { Link } from 'wouter'
import { queryAggregatorAbi } from '../generated/contracts'
import { resolveUri } from '../lib/metadata'
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

interface CollectionCardProps {
  card: HomePageCard
}

function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function CollectionCard({ card }: CollectionCardProps) {
  const metadata = useCollectionMetadata(card.metadataURI)

  const title = metadata?.name || card.name
  const fallbackGlyph = card.name.slice(0, 1).toUpperCase() || '✦'

  return (
    <article className={styles.card}>
      <Link href={`/collection/${card.instance}`} className={styles.cardLink}>
        <div className={styles.cardImage}>
          {metadata?.image ? (
            <img src={resolveUri(metadata.image)} alt={title} className={styles.cardImg} />
          ) : (
            fallbackGlyph
          )}
        </div>
        <div className={styles.cardContent}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>{title}</h3>
            <span className="badge">{card.contractType}</span>
          </div>
          {metadata?.description && (
            <p className={styles.cardDescription}>{metadata.description}</p>
          )}
          <div className={styles.cardStats}>
            <span className={styles.statSecondary}>price</span>
            <span className={styles.statMono}>{formatGwei(card.currentPrice)} gwei</span>
          </div>
          <div className={styles.cardStats}>
            <span className={styles.statSecondary}>supply</span>
            <span className={styles.statMono}>{card.totalSupply.toString()}</span>
          </div>
          <span className={`badge ${card.isActive ? 'badge-solid' : ''} ${styles.state}`}>
            {card.isActive ? 'active' : 'inactive'}
          </span>
        </div>
      </Link>
      <div className={styles.cardCreator}>
        <span className={styles.statSecondary}>by</span>{' '}
        <Link href={`/profile/${card.creator}`} className={styles.creatorLink}>
          {truncateAddress(card.creator)}
        </Link>
      </div>
    </article>
  )
}
