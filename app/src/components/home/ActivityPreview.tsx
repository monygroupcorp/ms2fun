import { Link } from 'wouter'
import { meetsThreshold } from '../threadMessages'
import { usePostThreshold } from '../useMessageFeed'
import { ActivityBox } from '../activity/ActivityBox'
import { ActivityMessage } from '../activity/ActivityMessage'
import { StateBlock } from '../ui/StateBlock'
import { useGlobalActivity } from './useGlobalActivity'
import styles from './ActivityPreview.module.css'

const PREVIEW_LIMIT = 5

/**
 * Recent-activity preview for the home landing surface. Reads the same global feed the board uses
 * (cache-shared) and shows the latest few posts read-only, each linking to its channel/sender, with
 * a link into the full board to compose. It is the same chat box (`ActivityBox`) the feed and the
 * salon are drawn in — a glimpse into the room, not a second design for the same thing. Kept
 * lightweight: no threading, no reply/endorse controls, and the well is left empty because you
 * speak on the board.
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
      <ActivityBox
        room="Recent activity"
        status={
          <Link href="/board" data-testid="board-link">
            Open board →
          </Link>
        }
        logTestId="home-activity"
      >
        {isPending && <StateBlock variant="loading">loading activity…</StateBlock>}

        {isError && <StateBlock variant="error">activity unreachable — is the fork up?</StateBlock>}

        {!isPending && !isError && latest.length === 0 && (
          <StateBlock variant="empty" boxed testId="home-activity-empty">
            no activity yet — be the first to post on the board.
          </StateBlock>
        )}

        {/* Newest first in the DOM; the transcript reverses it, so the newest post sits on the
            floor of the box the way the live edge of a room does. */}
        {!isPending &&
          !isError &&
          latest.map((m) => <ActivityMessage key={String(m.messageId)} message={m} />)}
      </ActivityBox>
    </section>
  )
}
