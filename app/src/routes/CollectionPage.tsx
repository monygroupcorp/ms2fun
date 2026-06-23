import { useState } from 'react'
import { Link, useParams } from 'wouter'
import { formatGwei } from 'viem'
import { useCollection } from '../components/useCollection'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { MessageFeed } from '../components/MessageFeed'
import { resolveUri } from '../lib/metadata'
import styles from './CollectionPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw as `0x${string}`
  return undefined
}

function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function CollectionPage() {
  const params = useParams<{ instance?: string }>()
  const instance = toAddress(params.instance)

  const { data: card, isPending, isError } = useCollection(instance)
  const metadata = useCollectionMetadata(card?.metadataURI)

  const [imgError, setImgError] = useState(false)

  if (!instance || (params.instance !== undefined && instance === undefined)) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <h1 className={`${styles.title} text-chromatic-medium`}>COLLECTION</h1>
        <p className={styles.note}>invalid collection address</p>
      </div>
    )
  }

  const title = metadata?.name || card?.name || truncateAddress(instance)
  const fallbackGlyph = card?.name?.slice(0, 1).toUpperCase() || '✦'

  const isNotFound = !isPending && !isError && (!card || card.instance === ZERO_ADDRESS)

  return (
    <div className={styles.page} data-testid="collection-detail">
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <h1 className={`${styles.title} text-chromatic-medium`}>{title}</h1>

      {isPending && <p className={styles.note}>loading collection…</p>}
      {isError && <p className={styles.note}>couldn't load collection — is the fork up?</p>}

      {isNotFound && <p className={styles.note}>collection not found</p>}

      {!isPending && !isError && card && card.instance !== ZERO_ADDRESS && (
        <>
          {metadata?.image && !imgError ? (
            <img
              src={resolveUri(metadata.image)}
              alt={title}
              className={styles.banner}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className={styles.imageGlyph}>{fallbackGlyph}</div>
          )}

          {metadata?.description && <p className={styles.description}>{metadata.description}</p>}

          <div className={styles.stats}>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>type</span>
              <span className="badge">{card.contractType}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>price</span>
              <span className={styles.statValue}>{formatGwei(card.currentPrice)} gwei</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>supply</span>
              <span className={styles.statValue}>{card.totalSupply.toString()}</span>
            </div>
            {card.maxSupply > 0n && (
              <div className={styles.statRow}>
                <span className={styles.statLabel}>max supply</span>
                <span className={styles.statValue}>{card.maxSupply.toString()}</span>
              </div>
            )}
            <div className={styles.statRow}>
              <span className={styles.statLabel}>status</span>
              <span className={`badge ${card.isActive ? 'badge-solid' : ''}`}>
                {card.isActive ? 'active' : 'inactive'}
              </span>
            </div>
            {card.vaultName && (
              <div className={styles.statRow}>
                <span className={styles.statLabel}>vault</span>
                <span className={styles.statValue}>{card.vaultName}</span>
              </div>
            )}
            {card.factoryTitle && (
              <div className={styles.statRow}>
                <span className={styles.statLabel}>factory</span>
                <span className={styles.statValue}>{card.factoryTitle}</span>
              </div>
            )}
          </div>

          <div className={styles.creatorSection}>
            <span className={styles.creatorLabel}>by </span>
            <Link href={`/profile/${card.creator}`} className={styles.creatorLink}>
              {truncateAddress(card.creator)}
            </Link>
          </div>

          <MessageFeed filter={{ instance }} />
        </>
      )}
    </div>
  )
}
