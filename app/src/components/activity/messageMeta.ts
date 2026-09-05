/**
 * The shared activity vocabulary — one channel-routing rule and one set of verbs for every surface
 * that renders a board message (home's preview, the collection/profile/vault feed, the salon).
 *
 * Both used to be per-surface. Only the board knew a wall or a vault channel from a collection, so
 * home's preview pointed every channel at `/collection/…` — dead for a wall post, which is the
 * commonest kind on the general board. And the message type was said three ways: "posted/replied/
 * quoted/endorsed" in the board's register, "REPLY/QUOTE/REACT" on home, "QUOTE" alone in the feed.
 * The verbs here are the register's, because "endorsed" is the one reaction the signature language
 * admits — never an emoji, never a tray, never "REACT".
 */
import { truncateAddress } from '../../lib/format'
import type { FeedMessage } from '../useMessageFeed'

/** The on-chain event stated plainly, keyed by `MessagePosted.messageType`. */
const VERBS: Record<number, string> = {
  0: 'posted',
  1: 'replied',
  2: 'quoted',
  3: 'endorsed',
}

/** The verb for a message type; an unrecognised type reads as a plain post. */
export function messageVerb(messageType: number): string {
  return VERBS[messageType] ?? 'posted'
}

export interface ChannelRef {
  /** Where the channel link goes. */
  href: string
  /** The channel is the sender's own address — a general-board post, not a collection. */
  isWall: boolean
  /** The channel is a known alignment vault. */
  isVault: boolean
  /** The channel said plainly: "the salon", "vault 0x…", or the collection's short address. */
  label: string
}

/**
 * Resolve a post's channel (`instance`). It is one of: a WALL (the sender's own address, the
 * profile-wall convention), a VAULT (vaults are postable channels), or a collection — and each
 * routes to its own page. `vaults` is the set of known vault addresses, lowercased; omit it and
 * vault posts fall back to collection links (the wall case does not need it — it is derived from
 * the message itself).
 */
export function channelRef(
  message: Pick<FeedMessage, 'instance' | 'sender'>,
  vaults?: Set<string>,
): ChannelRef {
  const isWall = message.instance.toLowerCase() === message.sender.toLowerCase()
  const isVault = !isWall && (vaults?.has(message.instance.toLowerCase()) ?? false)
  const short = truncateAddress(message.instance)
  return {
    href: isWall
      ? `/profile/${message.instance}`
      : isVault
        ? `/vault/${message.instance}`
        : `/collection/${message.instance}`,
    isWall,
    isVault,
    label: isWall ? 'the salon' : isVault ? `vault ${short}` : short,
  }
}
