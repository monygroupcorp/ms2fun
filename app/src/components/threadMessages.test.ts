import { describe, expect, it } from 'vitest'
import { reactionFor, threadMessages } from './threadMessages'
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
): FeedMessage {
  return {
    messageId: BigInt(id),
    instance: CHAN,
    sender,
    messageType: type,
    refId: BigInt(ref),
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
