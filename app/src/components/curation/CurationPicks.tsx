import { useMemo } from 'react'
import { Link } from 'wouter'
import { CollectionCard } from '../CollectionCard'
import { IpfsImage } from '../ui/IpfsImage'
import { StateBlock } from '../ui/StateBlock'
import { useCollectionMetadata } from '../useCollectionMetadata'
import { useProjectCards, type ProjectCard } from '../../lib/discovery'
import { cardsByInstance, curationItemHref } from '../../lib/curation'
import { curationItemKey, type CurationItem } from '../../lib/metadata'
import { forkChainId } from '../../lib/addresses'
import { truncateAddress } from '../../lib/format'
import { activeNetworkName } from '../../lib/network'
import styles from './CurationPicks.module.css'

/**
 * A curation's picks, hung in the curator's own order.
 *
 * A whole-collection pick renders as the ordinary collection card, so a curated collection looks
 * exactly like the same collection anywhere else on the site — a curation borrows attention, it
 * does not restyle the work. A piece pick renders as a sibling tile that names which piece and
 * links to it; it shows the COLLECTION's art rather than the token's, because per-token art costs
 * a metadata read per pick and the tile would otherwise be blank while they all resolved. The tile
 * says which piece in words, so nothing about it is a guess.
 *
 * Each pick carries the curator's note beneath it when there is one. That note is the curation.
 */
export function CurationPicks({ items }: { items: readonly CurationItem[] }) {
  const instances = useMemo(() => items.map((i) => i.instance), [items])
  const { data: cards, isPending, isError } = useProjectCards(instances)
  const byInstance = useMemo(() => cardsByInstance(cards), [cards])

  if (items.length === 0) {
    return (
      <StateBlock variant="empty" boxed testId="curation-empty">
        <span className="big">Nothing hung yet</span>
        <span className="cap">The curator named this set but has not filled it.</span>
      </StateBlock>
    )
  }

  if (isPending) return <StateBlock variant="loading">hanging the picks…</StateBlock>
  if (isError)
    return (
      <StateBlock variant="error">discovery unreachable — no response from the network.</StateBlock>
    )

  return (
    <ol className={styles.grid}>
      {items.map((item) => {
        const card = byInstance.get(item.instance)
        const href = curationItemHref(forkChainId, item, byInstance)
        return (
          <li key={curationItemKey(item)} className={styles.pick}>
            {card === undefined ? (
              <UnresolvedPick item={item} />
            ) : item.tokenId === '' ? (
              <CollectionCard card={card} />
            ) : (
              <PiecePick card={card} tokenId={item.tokenId} href={href ?? ''} />
            )}
            {item.note !== '' && <p className={styles.note}>{item.note}</p>}
          </li>
        )
      })}
    </ol>
  )
}

/** One piece inside a collection, as a card: the collection's art, the piece's number. */
function PiecePick({ card, tokenId, href }: { card: ProjectCard; tokenId: string; href: string }) {
  const metadata = useCollectionMetadata(card.metadataURI)
  const title = metadata?.name || card.name

  return (
    <Link
      href={href}
      className="noesis-card"
      data-testid={`curation-piece-${card.instance}-${tokenId}`}
    >
      <div className={`art ${styles.art}`}>
        <IpfsImage
          uri={metadata?.image ?? ''}
          alt={title}
          className={styles.artImg}
          fallback={
            <span className={styles.artFallback} aria-hidden>
              #{tokenId}
            </span>
          }
        />
        <span className="st">#{tokenId}</span>
      </div>
      <div className="lab">
        <div className={styles.labMain}>
          <span className="nm">
            {title} #{tokenId}
          </span>
          <span className="by">in {title}</span>
        </div>
        <span className="px">piece</span>
      </div>
    </Link>
  )
}

/**
 * A pick whose address no collection on this chain answers to. It is shown, not dropped: the
 * curator put it there deliberately, and silently swallowing it would make the set the visitor
 * sees differ from the set the curator published without either of them being told.
 */
function UnresolvedPick({ item }: { item: CurationItem }) {
  return (
    <div
      className={`noesis-card ${styles.unresolved}`}
      data-testid={`curation-unresolved-${item.instance}`}
    >
      <div className={`art ${styles.art}`}>
        <span className={styles.artFallback} aria-hidden>
          ?
        </span>
      </div>
      <div className="lab">
        <div className={styles.labMain}>
          <span className="nm">{truncateAddress(item.instance)}</span>
          <span className="by">not on {activeNetworkName}</span>
        </div>
        <span className="px">—</span>
      </div>
    </div>
  )
}
