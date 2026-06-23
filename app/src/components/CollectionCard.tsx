import type { ContractFunctionReturnType } from 'viem'
import { formatGwei } from 'viem'
import { queryAggregatorAbi } from '../generated/contracts'
import { resolveUri } from '../lib/metadata'
import { useCollectionMetadata } from './useCollectionMetadata'
import styles from './CollectionCard.module.css'

/**
 * Element type of the projects array returned by `QueryAggregator.getHomePageData`.
 * Derived via `ContractFunctionReturnType` — no `any`, no hand-written shape.
 */
type HomePageCard = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getHomePageData'
>[0][number]

interface CollectionCardProps {
  card: HomePageCard
}

export function CollectionCard({ card }: CollectionCardProps) {
  const metadata = useCollectionMetadata(card.metadataURI)

  const title = metadata?.name || card.name
  const fallbackGlyph = card.name.slice(0, 1).toUpperCase() || '✦'

  return (
    <article className={styles.card}>
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
        {metadata?.description && <p className={styles.cardDescription}>{metadata.description}</p>}
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
    </article>
  )
}
