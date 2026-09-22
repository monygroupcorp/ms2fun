import { Link } from 'wouter'
import { CurationCard } from './CurationCard'
import { curationsAvailable, useCurationsOf } from './useCurations'
import { StateBlock } from '../ui/StateBlock'
import styles from './CuratorShelf.module.css'

/**
 * Everything one address has curated — the Curated tab of a profile plate.
 *
 * `isOwn` is the difference between a shelf and a wall. Your own shelf shows what you took off
 * view, because a retired curation is still yours and putting it back is one click from its page.
 * A visitor's shelf shows only what is on view, because "off view" is the curator's decision about
 * strangers and this surface is where that decision applies.
 */
export function CuratorShelf({ curator, isOwn }: { curator: `0x${string}`; isOwn: boolean }) {
  const { data, isPending, isError } = useCurationsOf(curator)

  if (!curationsAvailable) return null

  if (isPending) return <StateBlock variant="loading">reading the shelf…</StateBlock>
  if (isError)
    return (
      <StateBlock variant="error">
        could not reach the curation registry — no response from the network.
      </StateBlock>
    )

  const rows = (data ?? []).filter((row) => isOwn || !row.curation.retired)

  if (rows.length === 0) {
    return (
      <StateBlock variant="empty" boxed testId="curator-shelf-empty">
        <span className="big">
          {isOwn ? 'You haven’t curated anything yet' : 'Nothing curated'}
        </span>
        <span className="cap">
          {isOwn
            ? 'A curation is a named set of collections or pieces. You don’t need to have made anything to publish one.'
            : 'This address has not published a curation that is on view.'}
        </span>
        {isOwn && (
          <span className="act">
            <Link href="/curations">Create a curation →</Link>
          </span>
        )}
      </StateBlock>
    )
  }

  return (
    <div className={styles.grid} data-testid="curator-shelf">
      {rows.map((row) => (
        <CurationCard key={row.id.toString()} id={row.id} curation={row.curation} />
      ))}
    </div>
  )
}
