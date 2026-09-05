/**
 * MessageFeed — threaded activity for a channel (collection or vault) or a wall (profile).
 *
 * Reused on CollectionPage (filter={{ instance }}), VaultPage and ProfilePage (filter={{ sender }}).
 * The board is flat on-chain; this threads it client-side via `threadMessages`: top-level posts with
 * their replies nested, plus an aggregated endorsement count. Threading is applied consistently in
 * every context — a feed with no replies/endorsements simply renders as flat single-message threads,
 * so collection/profile pages degrade gracefully with zero special-casing.
 *
 * Each message is drawn by the shared `ActivityMessage`, the same component home's preview and the
 * salon use, so this surface carries no post markup of its own. Reply/endorse write to
 * GlobalMessageRegistry.post and then invalidate the feed query so the new message appears
 * immediately (optimistic refetch, not a staleTime wait).
 */
import { type ReactNode, useMemo } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { type FeedFilter, useMessageFeed, usePostThreshold } from './useMessageFeed'
import { threadMessages, visibleThreads } from './threadMessages'
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
  /** Rendered at the bottom of the activity section (e.g. the "write something" composer), so the
      empty "no activity yet" state sits directly above it. */
  footer?: ReactNode
}) {
  const { data, isPending, isError } = useMessageFeed(filter)
  const { address: connected } = useAccount()
  const threshold = usePostThreshold()

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])
  const threads = useMemo(() => visibleThreads(view.threads, threshold), [view.threads, threshold])
  const actions = useMemo(() => ({ view, connected: connected !== undefined }), [view, connected])

  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>ACTIVITY</h2>

      {threshold > 0n && (
        <StateBlock variant="empty" testId="feed-threshold-note">
          showing posts of {formatEther(threshold)} ETH or more — cheaper posts are hidden by the
          current threshold.
        </StateBlock>
      )}

      {isPending && <StateBlock variant="loading">loading activity…</StateBlock>}

      {isError && (
        <StateBlock variant="error">couldn&apos;t load activity — is the fork up?</StateBlock>
      )}

      {!isPending && !isError && data !== undefined && threads.length === 0 && (
        <StateBlock variant="empty" boxed testId="message-feed-empty">
          no activity yet
        </StateBlock>
      )}

      {!isPending && !isError && threads.length > 0 && (
        <div className={styles.list} data-testid="message-feed">
          {threads.map((thread) => (
            <article
              key={String(thread.message.messageId)}
              className="noesis-post"
              data-testid="board-thread"
            >
              <ActivityMessage message={thread.message} vaults={vaults} actions={actions} />

              {thread.replies.map((reply) => (
                <div key={String(reply.messageId)} className="reply" data-testid="board-reply">
                  <ActivityMessage message={reply} vaults={vaults} actions={actions} />
                </div>
              ))}
            </article>
          ))}
        </div>
      )}

      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}
