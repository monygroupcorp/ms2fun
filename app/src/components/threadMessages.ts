/**
 * threadMessages — pure transform from a flat MessagePosted log list into a threaded board view.
 *
 * The board is flat on-chain: every message is one `MessagePosted` event carrying a `messageType`
 * (0 POST · 1 REPLY · 2 QUOTE · 3 REACT) and a `refId` (the parent message's id for replies/reactions).
 * This builds the tree the UI renders:
 *   - top-level POSTs (and QUOTEs) become threads, newest first
 *   - REPLYs (type 1) whose refId points at a known post nest under it, oldest first (chat order)
 *   - REACTs (type 3) are aggregated per target messageId — never shown as rows. Reactions can target
 *     either a top-level post or a nested reply, so counts are keyed by id and looked up by the renderer
 *     for whichever message it's drawing.
 *
 * A reply/reaction whose refId points at a message we can't see (filtered-out channel, not yet loaded)
 * degrades gracefully: orphan replies are promoted to top-level so nothing is silently dropped;
 * orphan reactions still count (keyed by their target id) even if that target isn't rendered.
 */
import type { FeedMessage } from './useMessageFeed'

export interface Reaction {
  /** number of distinct senders who reacted to a given message */
  count: number
  /** whether the connected wallet (if supplied) is among them */
  reactedByMe: boolean
}

export interface ThreadNode {
  message: FeedMessage
  replies: FeedMessage[]
}

export interface ThreadView {
  threads: ThreadNode[]
  /** reaction summary keyed by String(messageId) — covers posts AND replies */
  reactions: Map<string, Reaction>
}

const TYPE_POST = 0
const TYPE_REPLY = 1
const TYPE_QUOTE = 2
const TYPE_REACT = 3

const NO_REACTION: Reaction = { count: 0, reactedByMe: false }

/** Look up a message's reaction summary; returns a zero summary when none exist. */
export function reactionFor(view: ThreadView, messageId: bigint): Reaction {
  return view.reactions.get(String(messageId)) ?? NO_REACTION
}

/**
 * N12 spam lever: a genuine top-level post/quote (type 0/2) must carry `value >= threshold` to surface.
 * Everything else is exempt — replies/reactions (nested conversation isn't value-gated) and any message
 * threadMessages *promoted* to top-level (an orphan reply whose parent isn't loaded), which keeps the
 * "never silently drop a reply" guarantee even when the lever is raised. threshold 0 admits everything.
 */
export function meetsThreshold(
  m: Pick<FeedMessage, 'messageType' | 'value'>,
  threshold: bigint,
): boolean {
  const isTopLevelPost = m.messageType === TYPE_POST || m.messageType === TYPE_QUOTE
  if (!isTopLevelPost) return true
  return m.value >= threshold
}

/**
 * Drop whole threads whose ROOT is a top-level post below the threshold (its nested replies/reactions
 * go with it). Threads rooted at a promoted orphan reply are kept. Pure — reused by every feed surface.
 */
export function visibleThreads(threads: readonly ThreadNode[], threshold: bigint): ThreadNode[] {
  if (threshold <= 0n) return threads as ThreadNode[]
  return threads.filter((t) => meetsThreshold(t.message, threshold))
}

/**
 * Build threads from a flat, arbitrarily-ordered feed. Pure — no I/O, fully tested.
 * `viewer` (optional, lowercased internally) marks which messages the current wallet has reacted to.
 */
export function threadMessages(
  messages: readonly FeedMessage[],
  viewer?: `0x${string}`,
): ThreadView {
  const me = viewer?.toLowerCase()

  // Index every message by id so refIds can be resolved to a parent.
  const byId = new Map<string, FeedMessage>()
  for (const m of messages) byId.set(String(m.messageId), m)

  const nodes = new Map<string, ThreadNode>()
  const order: string[] = []

  function ensureNode(m: FeedMessage): ThreadNode {
    const key = String(m.messageId)
    let node = nodes.get(key)
    if (node === undefined) {
      node = { message: m, replies: [] }
      nodes.set(key, node)
      order.push(key)
    }
    return node
  }

  // First pass: create a node for every top-level post/quote, preserving input order.
  for (const m of messages) {
    if (m.messageType === TYPE_POST || m.messageType === TYPE_QUOTE) ensureNode(m)
  }

  // Track distinct reactors per target so the same wallet reacting twice counts once.
  const reactors = new Map<string, Set<string>>()

  // Second pass: attach replies and reactions to their parent (or promote orphans).
  for (const m of messages) {
    if (m.messageType === TYPE_REPLY) {
      const parent = byId.get(String(m.refId))
      if (parent !== undefined && parent.messageId !== m.messageId) {
        ensureNode(parent).replies.push(m)
      } else {
        // Orphan reply — show it as its own thread rather than dropping it.
        ensureNode(m)
      }
    } else if (m.messageType === TYPE_REACT) {
      const key = String(m.refId)
      let set = reactors.get(key)
      if (set === undefined) {
        set = new Set<string>()
        reactors.set(key, set)
      }
      set.add(m.sender.toLowerCase())
    }
  }

  // Fold reactor sets into a count + reactedByMe summary, keyed by target id (post OR reply).
  const reactions = new Map<string, Reaction>()
  for (const [key, set] of reactors) {
    reactions.set(key, { count: set.size, reactedByMe: me !== undefined && set.has(me) })
  }

  // Replies oldest-first (chat reading order) by messageId.
  for (const node of nodes.values()) {
    node.replies.sort((a, b) =>
      a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0,
    )
  }

  // Threads newest-first by parent messageId (mirrors the flat feed's existing sort).
  const threads = order.map((k) => nodes.get(k)!)
  threads.sort((a, b) =>
    a.message.messageId > b.message.messageId
      ? -1
      : a.message.messageId < b.message.messageId
        ? 1
        : 0,
  )
  return { threads, reactions }
}
