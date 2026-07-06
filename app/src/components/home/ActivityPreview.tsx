import { Link } from 'wouter'
import { truncateAddress } from '../../lib/format'
import { meetsThreshold } from '../threadMessages'
import { usePostThreshold } from '../useMessageFeed'
import { useGlobalActivity } from './useGlobalActivity'
import styles from './ActivityPreview.module.css'

const PREVIEW_LIMIT = 5

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  1: 'REPLY',
  2: 'QUOTE',
  3: 'REACT',
}

/**
 * Recent-activity preview for the home landing surface. Reads the same global feed the board uses
 * (cache-shared) and shows the latest few posts read-only, each linking to its channel/sender, with
 * a link into the full board to compose. Kept lightweight: no threading, no reply/react controls.
 */
export function ActivityPreview() {
  const { data, isPending, isError } = useGlobalActivity()
  const threshold = usePostThreshold()

  // Apply the same spam lever as the board: hide below-threshold top-level posts (replies/reactions
  // stay), then take the latest few.
  const latest = (data ?? []).filter((m) => meetsThreshold(m, threshold)).slice(0, PREVIEW_LIMIT)

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.sectionTitle}>RECENT ACTIVITY</h2>
        <Link href="/board" className={styles.boardLink} data-testid="board-link">
          Open board →
        </Link>
      </div>

      {isPending && <p className={styles.note}>loading activity…</p>}
      {isError && <p className={styles.note}>activity unreachable — is the fork up?</p>}

      {!isPending && !isError && latest.length === 0 && (
        <p className={styles.note} data-testid="home-activity-empty">
          no activity yet — be the first to post on the board.
        </p>
      )}

      {!isPending && !isError && latest.length > 0 && (
        <ul className={styles.list} data-testid="home-activity">
          {latest.map((m) => (
            <li key={String(m.messageId)} className={styles.item}>
              <div className={styles.meta}>
                <Link href={`/profile/${m.sender}`} className={styles.senderLink}>
                  {truncateAddress(m.sender)}
                </Link>
                <span className={styles.arrow}>→</span>
                <Link href={`/collection/${m.instance}`} className={styles.channelLink}>
                  {truncateAddress(m.instance)}
                </Link>
                {MESSAGE_TYPE_LABELS[m.messageType] !== undefined && (
                  <span className="badge">{MESSAGE_TYPE_LABELS[m.messageType]}</span>
                )}
              </div>
              {m.content.length > 0 && <p className={styles.content}>{m.content}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
