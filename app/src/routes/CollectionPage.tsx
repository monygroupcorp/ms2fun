import { useEffect, useState } from 'react'
import { Link, useParams } from 'wouter'
import { formatGwei } from 'viem'
import { useCollection } from '../components/useCollection'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { MessageFeed } from '../components/MessageFeed'
import { VaultPanel } from '../components/collection/VaultPanel'
import { FeaturedPanel } from '../components/featured/FeaturedPanel'
import { Erc1155Collection } from '../components/collection/types/Erc1155Collection'
import { Erc721Collection } from '../components/collection/types/Erc721Collection'
import { Erc404Collection } from '../components/collection/types/Erc404Collection'
import { ProjectStyle } from '../components/collection/ProjectStyle'
import { resolveUri } from '../lib/metadata'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
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

  // Reset the broken-image fallback when navigating to a different collection (the route component
  // is reused across `/collection/:instance` params, so local state would otherwise persist).
  const [imgError, setImgError] = useState(false)
  useEffect(() => {
    setImgError(false)
  }, [instance])

  if (!instance) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <h1 className={`${styles.title} text-chromatic-medium`}>COLLECTION</h1>
        <StateBlock variant="empty">invalid collection address</StateBlock>
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

      {isPending && <StateBlock variant="loading">loading collection…</StateBlock>}
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

          {/* Primary action first — the trading surface (buy / mint / swap) leads, above
              the secondary panels below. */}
          {card.contractType === 'ERC1155' && (
            <Erc1155Collection instance={instance} creator={card.creator} />
          )}
          {card.contractType === 'ERC721' && (
            <Erc721Collection instance={instance} creator={card.creator} />
          )}
          {card.contractType === 'ERC404' && (
            <Erc404Collection instance={instance} creator={card.creator} />
          )}

          {/* Secondary, demoted below the CTA and collapsed by default (self-rendered as
              <Disclosure> inside each panel, so a null vault doesn't leave an empty box). */}
          {instance && <VaultPanel vault={card.vault} benefactor={instance} />}
          {/* W-H: user-facing featured-queue economics (rent / boost / renew / prune). */}
          <FeaturedPanel instance={instance} />

          <MessageFeed filter={{ instance }} />
        </>
      )}
    </div>
  )
}
