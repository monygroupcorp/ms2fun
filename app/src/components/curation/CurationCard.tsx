import { Link } from 'wouter'
import { IpfsImage } from '../ui/IpfsImage'
import { truncateAddress } from '../../lib/format'
import { useCurationMetadata, type IdentifiedCuration } from './useCurations'
import styles from './CurationCard.module.css'

/**
 * One curation as a grid tile — the same `.noesis-card` device the collection grid uses, so a
 * curation sits beside a collection without asking for a second visual language.
 *
 * What the plate says is deliberately narrow: the title, who assembled it, and how many picks are
 * in it. There is no price corner, because nothing here is for sale, and no rank, because nothing
 * here was paid for. The status chip says `Curation` so a visitor scanning a mixed grid can tell at
 * a glance which tiles are somebody's selection rather than somebody's release.
 */
export function CurationCard({
  id,
  curation,
  variant = 'card',
}: IdentifiedCuration & { variant?: 'card' | 'lead' }) {
  const metadata = useCurationMetadata(curation.uri)
  const title = metadata?.name || `Curation #${id}`
  const count = metadata?.items.length
  const fallbackGlyph = (metadata?.name.slice(0, 1) || '◻').toUpperCase()

  return (
    <Link
      href={`/curation/${id}`}
      className={variant === 'lead' ? 'noesis-card lead' : 'noesis-card'}
      data-testid={`curation-card-${id}`}
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
        <span className="st">{curation.retired ? 'Off view' : 'Curation'}</span>
      </div>
      <div className="lab">
        <div className={styles.labMain}>
          <span className="nm">{title}</span>
          <span className="by">by {truncateAddress(curation.curator)}</span>
        </div>
        {/* Undefined while the JSON is still resolving — a count of 0 would be a claim we cannot
            make yet, and this plate slot is the one place it would read as a fact. */}
        <span className="px">
          {count === undefined ? '·' : `${count} ${count === 1 ? 'pick' : 'picks'}`}
        </span>
      </div>
    </Link>
  )
}
