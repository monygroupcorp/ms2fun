/**
 * MessageFeed — threaded activity for a channel (collection or vault) or a wall (profile).
 *
 * Reused on CollectionPage (filter={{ instance }}), VaultPage and ProfilePage (filter={{ sender }}).
 * The board is flat on-chain; this threads it client-side via `threadMessages`: top-level posts with
 * their replies nested, plus an aggregated endorsement count. Threading is applied consistently in
 * every context — a feed with no replies/endorsements simply renders as flat single-message threads,
 * so collection/profile pages degrade gracefully with zero special-casing.
 *
 * The chrome is `ActivityBox`, the same chat box home's preview and the salon are drawn in, and each
 * row is the shared `ActivityMessage` — so this surface carries no markup of its own beyond the room
 * name and what goes in the well. Reply/endorse write to GlobalMessageRegistry.post and then
 * invalidate the feed query so the new message appears immediately (optimistic refetch, not a
 * staleTime wait).
 */
import { type ReactNode, useMemo } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { type FeedFilter, useMessageFeed, usePostThreshold } from './useMessageFeed'
import { threadMessages, visibleThreads } from './threadMessages'
import { ActivityBox } from './activity/ActivityBox'
import { ActivityMessage } from './activity/ActivityMessage'
import { StateBlock } from './ui/StateBlock'
import styles from './MessageFeed.module.css'

export function MessageFeed({
  filter,
  vaults,
  footer,
}: {
  filter: FeedFilter
  /** Known vault addresses, lowercased, so vault channels link to /vault/… (see `channelRef`). */
  vaults?: Set<string> | undefined
  /** Docked in the box's well (e.g. the "write something" composer), so the empty "no activity yet"
      state sits directly above it. */
  footer?: ReactNode
}) {
  const { data, isPending, isError } = useMessageFeed(filter)
  const { address: connected } = useAccount()
  const threshold = usePostThreshold()

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])
  const threads = useMemo(() => visibleThreads(view.threads, threshold), [view.threads, threshold])
  const actions = useMemo(() => ({ view, connected: connected !== undefined }), [view, connected])

  // What the plate counts: the lines actually in the transcript, replies included.
  const posts = threads.reduce((n, t) => n + 1 + t.replies.length, 0)

  return (
    <div className={styles.section}>
      <ActivityBox
        room="Activity"
        status={posts > 0 ? `${posts} posts` : undefined}
        composer={footer}
        logTestId="message-feed"
        scrolls={threads.length > 4}
      >
        {isPending && <StateBlock variant="loading">loading activity…</StateBlock>}

        {isError && (
          <StateBlock variant="error">couldn&apos;t load activity — is the fork up?</StateBlock>
        )}

        {!isPending && !isError && data !== undefined && threads.length === 0 && (
          <StateBlock variant="empty" boxed testId="message-feed-empty">
            no activity yet
          </StateBlock>
        )}

        {/* Newest first in the DOM; the transcript reverses it so the newest line sits on the floor
            and the threshold note lands at the top of the scrollback. */}
        {!isPending &&
          !isError &&
          threads.map((thread) => (
            <ActivityMessage
              key={String(thread.message.messageId)}
              message={thread.message}
              replies={thread.replies}
              vaults={vaults}
              actions={actions}
            />
          ))}

        {threshold > 0n && (
          <StateBlock variant="empty" testId="feed-threshold-note">
            showing posts of {formatEther(threshold)} ETH or more — cheaper posts are hidden by the
            current threshold.
          </StateBlock>
        )}
      </ActivityBox>
    </div>
  )
}
