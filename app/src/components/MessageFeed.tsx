/**
 * MessageFeed — threaded activity for a channel (collection) or a wall (profile).
 *
 * Reused on CollectionPage (filter={{ instance }}) and ProfilePage (filter={{ sender }}). The board is
 * flat on-chain; this threads it client-side via `threadMessages`: top-level posts with their replies
 * nested, plus an aggregated 👍 reaction count. Threading is applied consistently in every context —
 * a feed with no replies/reactions simply renders as flat single-message threads, so collection/profile
 * pages degrade gracefully with zero special-casing.
 *
 * Reply/react write to GlobalMessageRegistry.post and then invalidate the feed query so the new
 * message appears immediately (optimistic refetch, not a staleTime wait).
 */
import { type ReactNode, useMemo, useState } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { truncateAddress } from '../lib/format'
import {
  type FeedFilter,
  type FeedMessage,
  useMessageFeed,
  usePostThreshold,
} from './useMessageFeed'
import { reactionFor, threadMessages, visibleThreads } from './threadMessages'
import { ReplyComposer } from './ReplyComposer'
import { ReactButton } from './ReactButton'
import { Linkify } from './ui/Linkify'
import styles from './MessageFeed.module.css'

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  2: 'QUOTE',
}

export function MessageFeed({
  filter,
  footer,
}: {
  filter: FeedFilter
  /** Rendered at the bottom of the activity section (e.g. the "write something" composer), so the
      empty "no activity yet" state sits directly above it. */
  footer?: ReactNode
}) {
  const { data, isPending, isError } = useMessageFeed(filter)
  const { address: connected } = useAccount()
  const threshold = usePostThreshold()

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])
  const threads = useMemo(() => visibleThreads(view.threads, threshold), [view.threads, threshold])

  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>ACTIVITY</h2>

      {threshold > 0n && (
        <p className={styles.note} data-testid="feed-threshold-note">
          showing posts of {formatEther(threshold)} ETH or more — cheaper posts are hidden by the
          current threshold.
        </p>
      )}

      {isPending && <p className={styles.note}>loading activity…</p>}

      {isError && <p className={styles.note}>couldn&apos;t load activity — is the fork up?</p>}

      {!isPending && !isError && data !== undefined && threads.length === 0 && (
        <p className={styles.note} data-testid="message-feed-empty">
          no activity yet
        </p>
      )}

      {!isPending && !isError && threads.length > 0 && (
        <ul className={styles.list} data-testid="message-feed">
          {threads.map((thread) => {
            const post = thread.message
            const reaction = reactionFor(view, post.messageId)
            return (
              <li key={String(post.messageId)} className={styles.item} data-testid="board-thread">
                <MessageRow message={post} />
                <ReactionRow
                  message={post}
                  count={reaction.count}
                  reactedByMe={reaction.reactedByMe}
                  canReply={connected !== undefined}
                />

                {thread.replies.length > 0 && (
                  <ul className={styles.replies}>
                    {thread.replies.map((reply) => {
                      const r = reactionFor(view, reply.messageId)
                      return (
                        <li
                          key={String(reply.messageId)}
                          className={styles.reply}
                          data-testid="board-reply"
                        >
                          <MessageRow message={reply} />
                          <ReactionRow
                            message={reply}
                            count={r.count}
                            reactedByMe={r.reactedByMe}
                            canReply={connected !== undefined}
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}

function MessageRow({ message }: { message: FeedMessage }) {
  return (
    <>
      <div className={styles.meta}>
        <span className={styles.sender}>{truncateAddress(message.sender)}</span>
        {MESSAGE_TYPE_LABELS[message.messageType] !== undefined && (
          <span className="badge">{MESSAGE_TYPE_LABELS[message.messageType]}</span>
        )}
      </div>
      {message.content.length > 0 && (
        <p className={styles.content}>
          <Linkify text={message.content} />
        </p>
      )}
    </>
  )
}

/** Reaction count + react button + a toggleable reply affordance/composer. */
function ReactionRow({
  message,
  count,
  reactedByMe,
  canReply,
}: {
  message: FeedMessage
  count: number
  reactedByMe: boolean
  canReply: boolean
}) {
  const [replying, setReplying] = useState(false)
  return (
    <div className={styles.actions}>
      <div className={styles.actionBar}>
        <ReactButton
          targetId={message.messageId}
          channel={message.instance}
          count={count}
          reactedByMe={reactedByMe}
        />
        {canReply && !replying && (
          <button
            type="button"
            className={styles.replyBtn}
            onClick={() => setReplying(true)}
            data-testid="board-reply-toggle"
          >
            reply
          </button>
        )}
      </div>
      {replying && (
        <ReplyComposer
          parentId={message.messageId}
          channel={message.instance}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  )
}
