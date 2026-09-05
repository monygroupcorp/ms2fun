import { Link } from 'wouter'
import { meetsThreshold } from '../threadMessages'
import { usePostThreshold } from '../useMessageFeed'
import { ActivityMessage } from '../activity/ActivityMessage'
import { StateBlock } from '../ui/StateBlock'
import { useGlobalActivity } from './useGlobalActivity'
import styles from './ActivityPreview.module.css'

const PREVIEW_LIMIT = 5

/**
 * Recent-activity preview for the home landing surface. Reads the same global feed the board uses
 * (cache-shared) and shows the latest few posts read-only, each linking to its channel/sender, with
 * a link into the full board to compose. Kept lightweight: no threading, no reply/endorse controls
 * — so `ActivityMessage` is rendered without its actions.
 *
 * No vault set is passed: deriving one costs the whole collections index (`useAllVaults`), which a
 * five-row preview should not pull onto the landing page. Vault channels fall back to collection
 * links here; wall posts route correctly regardless, since that is read off the message itself.
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

      {isPending && <StateBlock variant="loading">loading activity…</StateBlock>}

      {isError && (
        <StateBlock variant="error">
          activity unreachable — no response from the network.
        </StateBlock>
      )}

      {!isPending && !isError && latest.length === 0 && (
        <StateBlock variant="empty" boxed testId="home-activity-empty">
          no activity yet — be the first to post on the board.
        </StateBlock>
      )}

      {!isPending && !isError && latest.length > 0 && (
        <div className={styles.list} data-testid="home-activity">
          {latest.map((m) => (
            <article key={String(m.messageId)} className="noesis-post">
              <ActivityMessage message={m} />
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
