import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { formatGwei } from 'viem'
import { IpfsImage } from '../ui/IpfsImage'
import { truncateAddress } from '../../lib/format'
import type { ProjectCard } from '../useCreatorCollections'
import type { CollectionMetadata } from '../../lib/metadata'
import styles from '../../routes/CollectionPage.module.css'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Just the card fields the hero renders — so a preview can pass a small mock, not a full ABI struct. */
export type CollectionHeroCard = Pick<
  ProjectCard,
  | 'name'
  | 'creator'
  | 'isActive'
  | 'currentPrice'
  | 'totalSupply'
  | 'maxSupply'
  | 'vault'
  | 'vaultName'
  | 'contractType'
  | 'factoryTitle'
>

export interface CollectionHeroProps {
  instance: `0x${string}`
  card: CollectionHeroCard
  metadata: CollectionMetadata | undefined
  /** The type-specific primary action surface (buy/sell/bid). Omitted in previews. */
  primary?: ReactNode
}

/**
 * The collection page's specimen rail + cover — its visual identity and the surface a `styleUri`
 * themes. Extracted from CollectionPage so the launch-wizard style preview can render the SAME markup
 * (same CSS-module classes) with mock data for a pixel-accurate preview. Presentational: no chain
 * reads; all data arrives via props.
 */
export function CollectionHero({ instance, card, metadata, primary }: CollectionHeroProps) {
  const title = metadata?.name || card.name || truncateAddress(instance)
  const fallbackGlyph = card.name?.slice(0, 1).toUpperCase() || '✦'
  const minted = card.totalSupply ?? 0n
  const cap = card.maxSupply ?? 0n
  const meterPct = cap > 0n ? Math.min(100, Number((minted * 100n) / cap)) : 0
  const hasVault = card.vault !== ZERO_ADDRESS
  const vaultLabel = card.vaultName || 'Alignment'

  return (
    <div className={styles.shell}>
      <aside className={styles.specimen}>
        <p className={styles.kicker}>Collections / {card.isActive ? 'Live' : 'Ended'} · Ethereum</p>
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
              Aligned to <b>{vaultLabel}</b> — ~20% of fees bind to its vault on every mint, forever.{' '}
              <b>The creator can&rsquo;t walk.</b>
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
        <figure className={styles.coverFigure}>
          <div className={`noesis-piece ${styles.cover}`}>
            <IpfsImage
              uri={metadata?.image ?? ''}
              alt={`${title} cover`}
              className="noesis-art"
              loading="eager"
              fallback={
                <span className={styles.coverGlyph} aria-hidden>
                  {fallbackGlyph}
                </span>
              }
            />
          </div>
          <figcaption className={styles.coverCaption}>
            Collection cover — scroll for the{' '}
            {card.contractType === 'ERC721' ? 'auction' : 'mintable pieces'} below
          </figcaption>
        </figure>

        {primary}
      </section>
    </div>
  )
}
