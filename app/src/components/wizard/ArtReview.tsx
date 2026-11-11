/**
 * The review screen for a planned upload: what will go up, what each piece's traits are, and every
 * problem, before anything is signed or sent.
 *
 * The trait summary is there to catch typos: "Blue" on 312 pieces and "Bleu" on one stands out in a
 * list of values with their counts, where it would hide in a grid of ten thousand cards.
 */
import { useEffect, useState } from 'react'

import { traitSummary, type ArtPlan, type PlannedPiece } from '../../lib/art/layout'
import styles from './ArtUploadPanel.module.css'

const SAMPLE = 12

const LAYOUT_LABEL: Record<ArtPlan['layout'], string> = {
  'per-piece': 'images with one JSON file per piece',
  aggregate: 'images with one metadata list',
  csv: 'images with a spreadsheet',
  images: 'images only',
}

/** An image from the drop, shown from the creator's own file. */
function Thumb({ piece }: { piece: PlannedPiece }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (piece.image === null || typeof URL.createObjectURL !== 'function') return
    let made: string | null = null
    let live = true
    void piece.image
      .bytes()
      .then((bytes) => {
        if (!live) return
        made = URL.createObjectURL(new Blob([bytes as BlobPart]))
        setUrl(made)
      })
      .catch(() => undefined)
    return () => {
      live = false
      if (made !== null) URL.revokeObjectURL(made)
    }
  }, [piece.image])
  if (piece.image === null) return <div className={styles.thumb} aria-hidden="true" />
  return url === null ? (
    <div className={styles.thumb} aria-hidden="true" />
  ) : (
    <img className={styles.thumb} src={url} alt={piece.name ?? `#${piece.piece}`} />
  )
}

function List({ items, role }: { items: string[]; role?: 'alert' }) {
  if (items.length === 0) return null
  return (
    <ul className={styles.problems} {...(role ? { role } : {})}>
      {items.slice(0, 20).map((item) => (
        <li key={item}>{item}</li>
      ))}
      {items.length > 20 && <li>…and {items.length - 20} more</li>}
    </ul>
  )
}

export function ArtReview({
  plan,
  showBlockers = true,
}: {
  plan: ArtPlan
  showBlockers?: boolean
}) {
  const traits = traitSummary(plan.pieces)
  const sample = plan.pieces.slice(0, SAMPLE)
  const bytes = plan.imageBytes
  const shown =
    bytes >= 1024 ** 3
      ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
      : bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
        : `${Math.max(1, Math.round(bytes / 1024))} KiB`
  return (
    <div className={styles.summary} data-testid="art-review">
      <p className={styles.note}>
        {plan.pieces.length} piece{plan.pieces.length === 1 ? '' : 's'}
        {plan.imageBytes > 0 && `, ${shown} of images`} — {LAYOUT_LABEL[plan.layout]}.
      </p>

      {showBlockers && plan.blockers.length > 0 && (
        <div>
          <p className={styles.error}>Fix these before uploading:</p>
          <List items={plan.blockers} role="alert" />
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div>
          <p className={styles.notice}>Worth a look:</p>
          <List items={plan.warnings} />
        </div>
      )}
      {plan.notices.map((notice) => (
        <p key={notice} className={styles.notice}>
          {notice}
        </p>
      ))}

      {sample.length > 0 && (
        <ul className={styles.grid} aria-label="Sample of pieces">
          {sample.map((piece) => (
            <li key={piece.piece} className={styles.card}>
              <Thumb piece={piece} />
              <span className={styles.cardName}>
                #{piece.piece} {piece.name ?? ''}
              </span>
              {piece.traits.length > 0 && (
                <span className={styles.cardTraits}>
                  {piece.traits.map((t) => `${t.trait_type}: ${t.value}`).join(' · ')}
                </span>
              )}
              {piece.meta === null && (
                <span className={styles.cardTraits}>metadata from the name pattern</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {plan.pieces.length > SAMPLE && (
        <p className={styles.note}>…and {plan.pieces.length - SAMPLE} more.</p>
      )}

      {traits.length > 0 && (
        <details className={styles.details} open={traits.length <= 8}>
          <summary>Traits ({traits.length})</summary>
          <table className={styles.traits}>
            <tbody>
              {traits.map(({ type, values }) => (
                <tr key={type}>
                  <th scope="row">{type}</th>
                  <td>
                    {values.map(({ value, count }) => (
                      <span
                        key={value}
                        className={count === 1 && values.length > 1 ? styles.rare : undefined}
                      >
                        {value} ({count}){' '}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.note}>
            A value that appears once among common ones is underlined — often a typo.
          </p>
        </details>
      )}

      {(plan.skipped.length > 0 || plan.junk > 0) && (
        <details className={styles.details}>
          <summary>
            Not used ({plan.skipped.length} file{plan.skipped.length === 1 ? '' : 's'}
            {plan.junk > 0 && `, plus ${plan.junk} system file${plan.junk === 1 ? '' : 's'}`})
          </summary>
          <List items={plan.skipped.map((s) => `${s.path}: ${s.reason}`)} />
        </details>
      )}
    </div>
  )
}
