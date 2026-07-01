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
        <p className={styles.kicker}>Collections</p>
        <h1 className={styles.title}>Collection</h1>
        <StateBlock variant="empty">invalid collection address</StateBlock>
      </div>
    )
  }

  const title = metadata?.name || card?.name || truncateAddress(instance)
  const fallbackGlyph = card?.name?.slice(0, 1).toUpperCase() || '✦'

  const isNotFound = !isPending && !isError && (!card || card.instance === ZERO_ADDRESS)

  // Mint-state readout. The working mint/buy controls live in the type-specific component (the
  // "works" column); this rail block is the honest readout — how far the drop has gone.
  const minted = card?.totalSupply ?? 0n
  const cap = card?.maxSupply ?? 0n
  const meterPct = cap > 0n ? Math.min(100, Number((minted * 100n) / cap)) : 0
  const hasVault = !!card && card.vault !== ZERO_ADDRESS
  const vaultLabel = card?.vaultName || 'Alignment'

  return (
    <div className={styles.page} data-testid="collection-detail">
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
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
              Transparency-forward — the mechanic is read before you acquire. */}
          <div className={styles.shell}>
            <aside className={styles.specimen}>
              <p className={styles.kicker}>
                Collections / {card.isActive ? 'Live' : 'Ended'} · Ethereum
              </p>
              <h1 className={styles.title}>{title}</h1>
              <p className={styles.by}>
                by{' '}
                <Link href={`/profile/${card.creator}`} className={styles.byLink}>
                  {truncateAddress(card.creator)}
                </Link>
              </p>
              {metadata?.description && <p className={styles.desc}>{metadata.description}</p>}

              <div className={styles.mintstate}>
                <div className={styles.mintTop}>
                  <span className={styles.price}>{formatGwei(card.currentPrice)} gwei</span>
                  <span className={styles.count}>
                    {minted.toString()}
                    {cap > 0n ? ` / ${cap.toString()}` : ''}
                    {cap > 0n && <small>{(cap - minted).toString()} remaining</small>}
                  </span>
                </div>
                {cap > 0n && (
                  <div className={styles.meter}>
                    <i style={{ width: `${meterPct}%` }} />
                  </div>
                )}
              </div>

              {hasVault && (
                <div className={styles.alignment}>
                  <div className={styles.alignHead}>
                    <span>Alignment</span>
                    <span>Contract-enforced</span>
                  </div>
                  <div className="noesis-bind">
                    <div className="cell">
                      your mint fee<b>fees</b>
                    </div>
                    <div className="arrow">→</div>
                    <div className="cell vault">
                      {vaultLabel} vault<b>~20%</b>
                    </div>
                  </div>
                  <p className={styles.who}>
                    Aligned to <b>{vaultLabel}</b> — ~20% of fees bind to its vault on every mint,
                    forever. <b>The creator can&rsquo;t walk.</b>
                  </p>
                </div>
              )}

              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Standard</dt>
                  <dd>{card.contractType}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Contract</dt>
                  <dd>{truncateAddress(instance)}</dd>
                </div>
                {hasVault && (
                  <div className={styles.fact}>
                    <dt>Vault</dt>
                    <dd>{truncateAddress(card.vault)}</dd>
                  </div>
                )}
                {card.factoryTitle && (
                  <div className={styles.fact}>
                    <dt>Factory</dt>
                    <dd>{card.factoryTitle}</dd>
                  </div>
                )}
              </dl>
            </aside>

            <section className={styles.works} id="mint">
              <div className={styles.ghead}>The collection</div>
              {/* The cover stands in as the lead piece when present; the type component renders the
                  actual works + the working mint/buy/swap controls. */}
              {metadata?.image && !imgError ? (
                <div className={`noesis-piece ${styles.cover}`}>
                  <img
                    src={resolveUri(metadata.image)}
                    alt={title}
                    className="noesis-art"
                    onError={() => setImgError(true)}
                  />
                </div>
              ) : (
                <div className={`noesis-piece ${styles.cover}`}>
                  <span className={styles.coverGlyph} aria-hidden>
                    {fallbackGlyph}
                  </span>
                </div>
              )}

              {card.contractType === 'ERC1155' && (
                <Erc1155Collection instance={instance} creator={card.creator} />
              )}
              {card.contractType === 'ERC721' && (
                <Erc721Collection instance={instance} creator={card.creator} />
              )}
              {card.contractType === 'ERC404' && (
                <Erc404Collection instance={instance} creator={card.creator} />
              )}
            </section>
          </div>

          {/* Secondary, demoted below the hang and collapsed by default (self-rendered as
              <Disclosure> inside each panel, so a null vault doesn't leave an empty box). */}
          {instance && <VaultPanel vault={card.vault} benefactor={instance} />}
          {/* W-H: user-facing featured-queue economics (rent / boost / renew / prune). */}
          <FeaturedPanel instance={instance} />

          <MessageFeed filter={{ instance }} />

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
