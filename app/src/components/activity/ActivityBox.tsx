/**
 * ActivityBox — the one window every activity surface is drawn in: home's recent-activity preview,
 * the collection/profile/vault feed, and the salon.
 *
 * The shape is the one rth asked for on the 2026-08-28 walk — an AIM/AOL-era chat box, read through
 * the brand: a named plate across the top, a transcript below it, and a well at the floor where you
 * speak. Each surface used to bring its own chrome (a heading here, a header row with a link there,
 * a toolbar and a detached compose section on the salon), so three renderings of the same room
 * looked like three different products. This is that chrome, once.
 *
 * Emphatically not a messenger pastiche: no bubbles, no avatars, no tails, no emoji. The byline is
 * the only ornament, and it is mono.
 *
 * The transcript runs newest-last on screen while the caller keeps handing over a newest-first list
 * — see `.log` in the stylesheet. Callers therefore pass their rows in the order they already have
 * them, and put "load older" last.
 */
import type { ReactNode } from 'react'
import styles from './ActivityBox.module.css'

export function ActivityBox({
  room,
  status,
  children,
  composer,
  scrolls = false,
  logTestId,
}: {
  /** The room, on the name plate — "the salon", "activity", the active channel. */
  room: ReactNode
  /** The plate's right-hand slot: a count, a state, a way out to the full board. */
  status?: ReactNode
  /** The transcript, newest first. States (loading/empty/error) go here too, not around the box. */
  children: ReactNode
  /** Docked in the well. Omit on a read-only surface and the box ends at the transcript. */
  composer?: ReactNode
  /** Bound the transcript and let it scroll, so a long room keeps its window. */
  scrolls?: boolean
  logTestId?: string | undefined
}) {
  return (
    <section className={`${styles.box} ${scrolls ? styles.scrolls : ''}`}>
      <div className={styles.bar}>
        <span className={styles.room}>{room}</span>
        {status !== undefined && <span className={styles.status}>{status}</span>}
      </div>

      <div className={styles.log} data-testid={logTestId}>
        {children}
      </div>

      {composer !== undefined && <div className={styles.well}>{composer}</div>}
    </section>
  )
}
