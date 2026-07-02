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
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { truncateAddress } from '../lib/format'
import { type FeedFilter, type FeedMessage, useMessageFeed } from './useMessageFeed'
import { reactionFor, threadMessages } from './threadMessages'
import { ReplyComposer } from './ReplyComposer'
import { ReactButton } from './ReactButton'
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
  const queryClient = useQueryClient()

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['message-feed'] })
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.heading}>ACTIVITY</h2>

      {isPending && <p className={styles.note}>loading activity…</p>}

      {isError && <p className={styles.note}>couldn&apos;t load activity — is the fork up?</p>}

      {!isPending && !isError && data !== undefined && data.length === 0 && (
        <p className={styles.note} data-testid="message-feed-empty">
          no activity yet
        </p>
      )}

      {!isPending && !isError && view.threads.length > 0 && (
        <ul className={styles.list} data-testid="message-feed">
          {view.threads.map((thread) => {
            const post = thread.message
            const reaction = reactionFor(view, post.messageId)
            return (
              <li key={String(post.messageId)} className={styles.item} data-testid="board-thread">
                <MessageRow message={post} />
                <ReactionRow
                  message={post}
                  count={reaction.count}
                  reactedByMe={reaction.reactedByMe}
                  onChanged={refetch}
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
                            onChanged={refetch}
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
      {message.content.length > 0 && <p className={styles.content}>{message.content}</p>}
    </>
  )
}

/** Reaction count + react button + a toggleable reply affordance/composer. */
function ReactionRow({
  message,
  count,
  reactedByMe,
  onChanged,
  canReply,
}: {
  message: FeedMessage
  count: number
  reactedByMe: boolean
  onChanged: () => void
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
          onReacted={onChanged}
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
          onPosted={onChanged}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  )
}
