/**
 * ActivityStates — what a transcript says when it has no lines to show, decided once.
 *
 * The chrome of the activity window was unified into `ActivityBox` and its lines into
 * `ActivityLine`, but every surface still hand-rolled the three states inside it, so the same
 * window said three different things: home and the feed were "loading activity…", the salon was
 * "hanging the work…", the EXEC fossil was "reading the ledger…". That is one room with three
 * voices.
 *
 * Two of those hand-rolls were also wrong, in the same way. A surface that filters its feed — the
 * spam threshold everywhere, the channel on the salon — can have a full feed and a bare transcript,
 * and both the collection/vault/profile feed and home's preview keyed their zero-state on the rows
 * they draw while wording it as though the room itself were empty. So a collection whose posts all
 * sit under the threshold read "no activity yet", and the landing page invited you to "be the first
 * to post" on a board that was not empty at all. The salon had already been fixed on its own; this
 * is that fix in the one place, which is why the other two get it for free.
 *
 * What stays the surface's own is only what is actually its own: the noun this window shows
 * (`subject`), what it can be filtered by (`filters`), and the invitation to speak when the room
 * really is empty (`empty`). Everything else — the sentence shapes, and which of the three states
 * is in force — lives here.
 */
import type { ReactNode } from 'react'
import { formatEther } from 'viem'
import { StateBlock } from '../ui/StateBlock'

export function ActivityStates({
  subject,
  isPending,
  isError,
  fetched,
  shown,
  empty,
  filters = 'the current threshold',
  emptyTestId,
}: {
  /** What this window shows, named in the loading and error lines: "activity", "legacy messages". */
  subject: string
  isPending: boolean
  isError: boolean
  /**
   * Lines the surface has in hand before its filters, counted in the units it draws — threads where
   * it draws threads, events where it draws events. It is only ever compared against `shown` to
   * tell an empty room from a filtered one, so a count of something the transcript would never have
   * drawn (an endorsement, in a threaded view) reads as a filter swallowing posts that do not exist.
   * `undefined` until the feed answers.
   */
  fetched: number | undefined
  /** Lines it actually draws. Above zero, the transcript speaks for itself and nothing renders. */
  shown: number
  /** What to say when the room is genuinely empty — an invitation to be the first to speak. */
  empty: ReactNode
  /** What can hide a line on this surface, named in the "nothing to show" line. */
  filters?: string
  emptyTestId?: string | undefined
}) {
  if (isPending) return <StateBlock variant="loading">loading {subject}…</StateBlock>

  if (isError) {
    return (
      <StateBlock variant="error">
        couldn&apos;t load {subject} — no response from the network.
      </StateBlock>
    )
  }

  // Nothing to say while the feed is unanswered, or while there are lines on screen.
  if (fetched === undefined || shown > 0) return null

  return (
    <StateBlock variant="empty" boxed testId={emptyTestId}>
      {fetched === 0
        ? empty
        : `nothing to show in this view — ${filters} hides every post in the feed.`}
    </StateBlock>
  )
}

/**
 * The spam lever, said once. The salon and the feed both apply the threshold and both told you so,
 * in two different sentences for the same fact. It renders nothing when the lever is off.
 *
 * It is scrollback rather than a state: it goes last in the DOM, so the reversed transcript puts it
 * at the top of the pane, above the oldest line, and it shows whether or not there are lines below.
 */
export function ActivityThresholdNote({
  threshold,
  testId,
}: {
  threshold: bigint
  testId?: string | undefined
}) {
  if (threshold <= 0n) return null

  return (
    <StateBlock variant="empty" testId={testId}>
      spam lever on: showing posts of {formatEther(threshold)} ETH or more — cheaper posts are
      hidden until the threshold is lowered.
    </StateBlock>
  )
}
