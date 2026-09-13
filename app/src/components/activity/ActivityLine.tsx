/**
 * ActivityLine — one line of a transcript, and the only place the shape of one is decided.
 *
 * Every activity surface draws the same line: a mono byline, the room it was said in, the event
 * named, and then what was said, running on and wrapping under a hanging indent. What differs
 * between surfaces is only which of those parts they know — the salon's register names the event
 * for every row, home's preview names none, the EXEC fossil knows a time but no channel — so each
 * part is optional and nothing here is per-surface.
 *
 * It exists because the parts kept getting redrawn. The salon's flat register had its own row with
 * the fields in a different order and the content NOT linkified, so the same post's URL was live in
 * one view of the window and dead in the other; the fossil's legacy log had its own byline stack
 * entirely. This is that line, once.
 *
 * Presentational on purpose: it resolves nothing. The caller brings the channel (`channelRef`) and
 * the verb (`messageVerb`) from the shared vocabulary, so a surface cannot quietly invent either.
 */
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { truncateAddress } from '../../lib/format'
import { Linkify } from '../ui/Linkify'
import type { ChannelRef } from './messageMeta'
import styles from './ActivityLine.module.css'

export function ActivityLine({
  sender,
  channel,
  verb,
  when,
  say,
  children,
}: {
  /** Who spoke. Always attributed, always a link to their profile — there are no anonymous posts. */
  sender: `0x${string}`
  /** The room it was said in. Omit where the box's name plate already names it (a single-room log). */
  channel?: ChannelRef | undefined
  /** The event, from `messageVerb`. Omit where the line already reads as one — a plain post. */
  verb?: string | undefined
  /** Relative time ("3mo ago"), on the surfaces that know one. The board feed does not carry
      block times, so it passes nothing rather than inventing one. */
  when?: string | undefined
  /** What was said. URLs are linkified here, so every surface linkifies or none does. */
  say?: string | undefined
  /** Trailing attachments that hang UNDER this line — a quote card, the endorse/reply bar. They
      are blocks, so they sit outside the line's paragraph rather than inside it. */
  children?: ReactNode
}) {
  return (
    <>
      <p className={styles.line}>
        <Link href={`/profile/${sender}`} className={styles.name}>
          {truncateAddress(sender)}
        </Link>

        {/* A wall post is a general-board post (channel = the sender's own wall), not a collection
            pointer — read it as "· on the salon" linking to their wall, never a dead collection. */}
        {channel !== undefined && (
          <Link href={channel.href} className={styles.channel}>
            {channel.isWall ? `· on ${channel.label}` : `→ ${channel.label}`}
          </Link>
        )}

        {verb !== undefined && <span className={styles.verb}>{verb}</span>}

        {when !== undefined && when !== '' && <span className={styles.when}>· {when}</span>}

        {say !== undefined && say.length > 0 && (
          <span className={styles.say}>
            <Linkify text={say} />
          </span>
        )}
      </p>

      {children}
    </>
  )
}
