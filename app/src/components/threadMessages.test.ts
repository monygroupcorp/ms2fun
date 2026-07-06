import { describe, expect, it } from 'vitest'
import { meetsThreshold, reactionFor, threadMessages, visibleThreads } from './threadMessages'
import type { FeedMessage } from './useMessageFeed'

// ── helpers ───────────────────────────────────────────────────────────────────

const A = '0x000000000000000000000000000000000000000a' as const
const B = '0x000000000000000000000000000000000000000b' as const
const CHAN = '0x00000000000000000000000000000000000000cc' as const

function msg(
  id: number,
  type: number,
  ref: number,
  sender: `0x${string}` = A,
  content = `m${id}`,
  value = 0n,
): FeedMessage {
  return {
    messageId: BigInt(id),
    instance: CHAN,
    sender,
    messageType: type,
    refId: BigInt(ref),
    value,
    content,
  }
}

// ── threadMessages ──────────────────────────────────────────────────────────────

describe('threadMessages', () => {
  it('returns no threads for no messages', () => {
    expect(threadMessages([]).threads).toEqual([])
  })

  it('keeps top-level posts as threads, newest first', () => {
    const { threads } = threadMessages([msg(1, 0, 0), msg(2, 0, 0), msg(3, 0, 0)])
    expect(threads.map((t) => Number(t.message.messageId))).toEqual([3, 2, 1])
    expect(threads.every((t) => t.replies.length === 0)).toBe(true)
  })

  it('nests replies under their parent, oldest reply first', () => {
    const { threads } = threadMessages([
      msg(1, 0, 0),
      msg(3, 1, 1), // reply to 1
      msg(2, 1, 1), // reply to 1
    ])
    expect(threads).toHaveLength(1)
    expect(Number(threads[0]!.message.messageId)).toBe(1)
    expect(threads[0]!.replies.map((r) => Number(r.messageId))).toEqual([2, 3])
  })

  it('aggregates distinct reactors per target and ignores duplicate reacts', () => {
    const view = threadMessages([
      msg(1, 0, 0),
      msg(2, 3, 1, A), // react by A
      msg(3, 3, 1, B), // react by B
      msg(4, 3, 1, A), // duplicate react by A — counted once
    ])
    expect(reactionFor(view, 1n).count).toBe(2)
  })

  it('reactions never appear as their own rows or threads', () => {
    const { threads } = threadMessages([msg(1, 0, 0), msg(2, 3, 1, B)])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.replies).toHaveLength(0)
  })

  it('aggregates reactions onto replies, keyed by the reply id', () => {
    const view = threadMessages([
      msg(1, 0, 0),
      msg(2, 1, 1), // reply
      msg(3, 3, 2, B), // react to the reply
    ])
    const reply = view.threads[0]!.replies[0]!
    expect(Number(reply.messageId)).toBe(2)
    expect(reactionFor(view, 2n).count).toBe(1)
    expect(reactionFor(view, 1n).count).toBe(0)
  })

  it('marks reactedByMe when the viewer is among the reactors', () => {
    const reacted = threadMessages([msg(1, 0, 0), msg(2, 3, 1, A)], A)
    expect(reactionFor(reacted, 1n).reactedByMe).toBe(true)
    const notReacted = threadMessages([msg(1, 0, 0), msg(2, 3, 1, B)], A)
    expect(reactionFor(notReacted, 1n).reactedByMe).toBe(false)
  })

  it('reactionFor returns a zero summary for messages with no reactions', () => {
    const view = threadMessages([msg(1, 0, 0)])
    expect(reactionFor(view, 1n)).toEqual({ count: 0, reactedByMe: false })
  })

  it('promotes orphan replies to top-level instead of dropping them', () => {
    // refId 99 is not present in the feed (e.g. different channel)
    const { threads } = threadMessages([msg(5, 1, 99)])
    expect(threads).toHaveLength(1)
    expect(Number(threads[0]!.message.messageId)).toBe(5)
  })

  it('treats quotes (type 2) as top-level threads', () => {
    const { threads } = threadMessages([msg(1, 2, 0)])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.message.messageType).toBe(2)
  })
})

// ── meetsThreshold (N12 spam lever) ──────────────────────────────────────────────

describe('meetsThreshold', () => {
  it('admits every message when the threshold is 0', () => {
    expect(meetsThreshold(msg(1, 0, 0, A, 'm', 0n), 0n)).toBe(true)
  })

  it('gates a top-level post on its attached value', () => {
    const t = 5n
    expect(meetsThreshold(msg(1, 0, 0, A, 'cheap', 4n), t)).toBe(false)
    expect(meetsThreshold(msg(2, 0, 0, A, 'exact', 5n), t)).toBe(true)
    expect(meetsThreshold(msg(3, 0, 0, A, 'dear', 6n), t)).toBe(true)
  })

  it('gates quotes (type 2) like posts', () => {
    expect(meetsThreshold(msg(1, 2, 0, A, 'q', 0n), 5n)).toBe(false)
  })

  it('exempts replies (type 1) and reactions (type 3) regardless of value', () => {
    expect(meetsThreshold(msg(1, 1, 0, A, 'reply', 0n), 5n)).toBe(true)
    expect(meetsThreshold(msg(2, 3, 0, A, '', 0n), 5n)).toBe(true)
  })
})

// ── visibleThreads ───────────────────────────────────────────────────────────────

describe('visibleThreads', () => {
  it('returns all threads unchanged when the threshold is 0', () => {
    const view = threadMessages([msg(1, 0, 0, A, 'a', 0n), msg(2, 0, 0, A, 'b', 0n)])
    expect(visibleThreads(view.threads, 0n)).toHaveLength(2)
  })

  it('drops a below-threshold post together with its nested replies', () => {
    // Post 1 (value 0) has a reply (5). Post 2 (value 10) has a reply (6). Threshold 5.
    const view = threadMessages([
      msg(1, 0, 0, A, 'cheap post', 0n),
      msg(5, 1, 1, B, 'reply to cheap'),
      msg(2, 0, 0, A, 'paid post', 10n),
      msg(6, 1, 2, B, 'reply to paid'),
    ])
    const shown = visibleThreads(view.threads, 5n)
    // Only the paid post survives; the cheap post AND its reply are gone (reply nested under it).
    expect(shown).toHaveLength(1)
    expect(Number(shown[0]!.message.messageId)).toBe(2)
    expect(shown[0]!.replies.map((r) => Number(r.messageId))).toEqual([6])
  })

  it('keeps the replies of a surviving post even if the replies carry no value', () => {
    const view = threadMessages([
      msg(1, 0, 0, A, 'paid post', 10n),
      msg(5, 1, 1, B, 'free reply', 0n),
    ])
    const shown = visibleThreads(view.threads, 5n)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.replies).toHaveLength(1)
  })

  it('keeps an orphan-promoted reply visible even when the lever is raised', () => {
    // A reply whose parent isn't loaded is promoted to top-level; it must not be value-gated
    // (its value is 0) — otherwise raising the lever would silently drop conversation.
    const view = threadMessages([msg(5, 1, 99, B, 'orphan reply', 0n)])
    expect(visibleThreads(view.threads, 5n)).toHaveLength(1)
  })
})
