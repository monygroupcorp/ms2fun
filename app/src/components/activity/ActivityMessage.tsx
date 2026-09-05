/**
 * ActivityMessage — the one board post. Every activity surface renders its messages through this:
 * home's recent-activity preview, the collection/profile/vault feed, and the salon. There used to
 * be three renderings of the same `MessagePosted` event, each with its own meta line, its own
 * message-type labels and its own channel links; this is that one thing.
 *
 * It draws the signature `.noesis-post` device (styles/noesis/signature.css) — the wall-label look
 * is stated once in the brand layer and inherited, not re-invented per surface. The CALLER owns the
 * container (`<article className="noesis-post">`) and the threading: a reply goes inside the
 * caller's `.reply` wrapper, which is the device's own class.
 *
 * Actions (endorse + reply) are opt-in, so a read-only surface renders nothing interactive.
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

export function ActivityMessage({
  message,
  vaults,
  actions,
}: {
  message: FeedMessage
  /** Known vault addresses, lowercased — see `channelRef`. Omit and vault channels read as collections. */
  vaults?: Set<string> | undefined
  /** Endorse + reply affordances. Omitted on read-only surfaces (home's preview). */
  actions?: { view: ThreadView; connected: boolean } | undefined
}) {
  const chan = channelRef(message, vaults)

  return (
    <>
      <div className="phead">
        <Link href={`/profile/${message.sender}`} className={`name ${styles.link}`}>
          {truncateAddress(message.sender)}
        </Link>

        {/* A wall post is a general-board post (channel = the sender's own wall), not a collection
            pointer — read it as "· on the salon" linking to their wall, never a dead collection. */}
        <Link href={chan.href} className={`ch ${styles.link}`}>
          {chan.isWall ? `· on ${chan.label}` : `→ ${chan.label}`}
        </Link>

        {/* The event, in the device's right-hand slot. A plain post says nothing — the row already
            reads as one — so only a reply/quote/endorsement is named, and it is named the same way
            on a flat surface as on a threaded one. */}
        {message.messageType !== 0 && (
          <span className={`age ${styles.verb}`}>{messageVerb(message.messageType)}</span>
        )}
      </div>

      {/* Quote — a card carrying the referenced work's swatch (mono until colour is wired). */}
      {message.messageType === 2 && (
        <Link href={chan.href} className={styles.quoteCard}>
          <span className={styles.swatch} aria-hidden />
          <span className={styles.quoteRef}>re: {chan.label}</span>
        </Link>
      )}

      {message.content.length > 0 && (
        <p className="ptext">
          <Linkify text={message.content} />
        </p>
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
