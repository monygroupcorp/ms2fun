/**
 * ActivityMessage — the one board post. Every activity surface renders its messages through this:
 * home's recent-activity preview, the collection/profile/vault feed, and the salon. There used to
 * be three renderings of the same `MessagePosted` event, each with its own meta line, its own
 * message-type labels and its own channel links; this is that one thing.
 *
 * It draws one line of the chat box's transcript (`ActivityBox`): a mono byline, the channel it was
 * said in, then what was said, running on and wrapping under a hanging indent. It used to draw the
 * vendored `.noesis-post` wall label — a byline row, a paragraph beneath, a 2px rule under each —
 * which read as a register rather than as a room.
 *
 * The row owns its own container and its replies, so a surface hands over a message (and its
 * replies, where it threads) and nothing else. Actions (endorse + reply) are opt-in, so a read-only
 * surface renders nothing interactive.
 */
import { useState } from 'react'
import { Link } from 'wouter'
import { truncateAddress } from '../../lib/format'
import { type ThreadView, reactionFor } from '../threadMessages'
import type { FeedMessage } from '../useMessageFeed'
import { ReactButton } from '../ReactButton'
import { ReplyComposer } from '../ReplyComposer'
import { Linkify } from '../ui/Linkify'
import { channelRef, messageVerb } from './messageMeta'
import styles from './ActivityMessage.module.css'

/** Endorse + reply affordances. Omitted on read-only surfaces (home's preview). */
type Actions = { view: ThreadView; connected: boolean }

export function ActivityMessage({
  message,
  replies = [],
  vaults,
  actions,
}: {
  message: FeedMessage
  /** Replies to nest under the line, on the surfaces that thread. */
  replies?: readonly FeedMessage[]
  /** Known vault addresses, lowercased — see `channelRef`. Omit and vault channels read as collections. */
  vaults?: Set<string> | undefined
  actions?: Actions | undefined
}) {
  return (
    <article className={styles.post} data-testid="board-thread">
      <MessageLine message={message} vaults={vaults} actions={actions} />

      {replies.map((reply) => (
        <div key={String(reply.messageId)} className={styles.reply} data-testid="board-reply">
          <MessageLine message={reply} vaults={vaults} actions={actions} />
        </div>
      ))}
    </article>
  )
}

function MessageLine({
  message,
  vaults,
  actions,
}: {
  message: FeedMessage
  vaults: Set<string> | undefined
  actions: Actions | undefined
}) {
  const chan = channelRef(message, vaults)

  return (
    <>
      <p className={styles.line}>
        <Link href={`/profile/${message.sender}`} className={styles.name}>
          {truncateAddress(message.sender)}
        </Link>

        {/* A wall post is a general-board post (channel = the sender's own wall), not a collection
            pointer — read it as "· on the salon" linking to their wall, never a dead collection. */}
        <Link href={chan.href} className={styles.channel}>
          {chan.isWall ? `· on ${chan.label}` : `→ ${chan.label}`}
        </Link>

        {/* The event. A plain post says nothing — the line already reads as one — so only a
            reply/quote/endorsement is named, and it is named the same way on a flat surface as on
            a threaded one. */}
        {message.messageType !== 0 && (
          <span className={styles.verb}>{messageVerb(message.messageType)}</span>
        )}

        {message.content.length > 0 && (
          <span className={styles.say}>
            <Linkify text={message.content} />
          </span>
        )}
      </p>

      {/* Quote — a card carrying the referenced work's swatch (mono until colour is wired). */}
      {message.messageType === 2 && (
        <Link href={chan.href} className={styles.quoteCard}>
          <span className={styles.swatch} aria-hidden />
          <span className={styles.quoteRef}>re: {chan.label}</span>
        </Link>
      )}

      {actions !== undefined && (
        <ActivityActions message={message} view={actions.view} connected={actions.connected} />
      )}
    </>
  )
}

/** Endorsement count + endorse button + a toggleable reply affordance/composer. */
function ActivityActions({
  message,
  view,
  connected,
}: {
  message: FeedMessage
  view: ThreadView
  connected: boolean
}) {
  const [replying, setReplying] = useState(false)
  const reaction = reactionFor(view, message.messageId)

  return (
    <div className={styles.actions}>
      <div className={styles.actionBar}>
        <ReactButton
          targetId={message.messageId}
          channel={message.instance}
          count={reaction.count}
          reactedByMe={reaction.reactedByMe}
        />
        {connected && !replying && (
          <button
            type="button"
            className={styles.replyBtn}
            onClick={() => setReplying(true)}
            data-testid="board-reply-toggle"
          >
            Reply
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
