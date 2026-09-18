import { useMemo } from 'react'
import { Link } from 'wouter'
import { threadMessages, visibleThreads } from '../threadMessages'
import { usePostThreshold } from '../useMessageFeed'
import { ActivityBox } from '../activity/ActivityBox'
import { ActivityMessage } from '../activity/ActivityMessage'
import { ActivityStates } from '../activity/ActivityStates'
import { useGlobalActivity } from './useGlobalActivity'
import styles from './ActivityPreview.module.css'

const PREVIEW_LIMIT = 5

/**
 * Recent-activity preview for the home landing surface. Reads the same global feed the board uses
 * (cache-shared) and shows the latest few posts read-only, each linking to its channel/sender, with
 * a link into the full board to compose. It is the same chat box (`ActivityBox`) the feed and the
 * salon are drawn in — a glimpse into the room, not a second design for the same thing. Kept
 * lightweight: no reply/endorse controls, no nested replies, and the well is left empty because you
 * speak on the board.
 *
 * It threads the feed for the same reason every other discourse surface does. Drawing the raw log
 * instead, as this did, made the landing page a register: an endorsement is an event but never a
 * line — it folds into a count on the message it answers — so it came out as a byline with a verb
 * and nothing said, and a reply came out detached from the post it was answering. The one surface
 * that IS a register, the salon's Activity view, is a view you deliberately switch into and it
 * names every event for exactly that reason. This is the discourse room, previewed.
 *
 * No vault set is passed: deriving one costs the whole collections index (`useAllVaults`), which a
 * five-row preview should not pull onto the landing page. Vault channels fall back to collection
 * links here; wall posts route correctly regardless, since that is read off the message itself.
 */
export function ActivityPreview() {
  const { data, isPending, isError } = useGlobalActivity()
  const threshold = usePostThreshold()

  const view = useMemo(() => threadMessages(data ?? []), [data])
  // Apply the same spam lever as the board — hide below-threshold top-level posts — then take the
  // latest few thread roots.
  const threads = useMemo(() => visibleThreads(view.threads, threshold), [view.threads, threshold])
  const latest = threads.slice(0, PREVIEW_LIMIT)

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
        {/* Counted in threads, the unit this transcript draws: a board holding only endorsements
            has nothing to preview and nothing filtering it, and counting raw events there would
            blame the spam lever for a quiet board. */}
        <ActivityStates
          subject="activity"
          isPending={isPending}
          isError={isError}
          fetched={data === undefined ? undefined : view.threads.length}
          shown={latest.length}
          empty="no activity yet — be the first to post on the board."
          emptyTestId="home-activity-empty"
        />

        {/* Newest first in the DOM; the transcript reverses it, so the newest post sits on the
            floor of the box the way the live edge of a room does. */}
        {!isPending &&
          !isError &&
          latest.map((t) => (
            <ActivityMessage key={String(t.message.messageId)} message={t.message} />
          ))}
      </ActivityBox>
    </section>
  )
}
