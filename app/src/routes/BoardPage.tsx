import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { formatGwei } from 'viem'
import { useInfiniteQuery } from '@tanstack/react-query'
import { usePublicClient, useAccount } from 'wagmi'
import {
  globalMessageRegistryAbi,
  useReadQueryAggregatorGetHomePageData,
} from '../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../lib/addresses'
import { DEFAULT_LOG_WINDOW } from '../lib/logScan'
import { useAllVaults } from '../lib/vaults/useAllVaults'
import { truncateAddress } from '../lib/format'
import { MessageComposer } from '../components/MessageComposer'
import { ReplyComposer } from '../components/ReplyComposer'
import { ReactButton } from '../components/ReactButton'
import { type ThreadView, reactionFor, threadMessages } from '../components/threadMessages'
import type { FeedMessage } from '../components/useMessageFeed'
import { StateBlock } from '../components/ui/StateBlock'
import { Linkify } from '../components/ui/Linkify'
import styles from './BoardPage.module.css'

/** The board's two honest views: the threaded salon, and the flat on-chain register. (The spec's
 * third "All" stream would fold in mint/align/list events, which the board feed doesn't emit yet.) */
type BoardView = 'discourse' | 'activity'

/** Register verbs for the flat Activity view — the on-chain event, stated plainly. */
const ACTIVITY_VERB: Record<number, string> = { 0: 'posted', 1: 'replied', 2: 'quoted', 3: 'endorsed' }

/**
 * A post's channel (`instance`) is one of: a WALL (the sender's own address, the profile-wall
 * convention), a VAULT (S3 — vaults are postable channels), or a collection. Each routes to its own
 * page; only a genuine collection links to `/collection/…`. Fixes the dead `/collection/<wallet>`
 * links general-board posts render (N6) and the equivalent for vault channels (S3). `vaults` is the
 * set of known vault addresses (lowercased); omit it and vault posts fall back to collection links.
 */
function channelRef(
  message: Pick<FeedMessage, 'instance' | 'sender'>,
  vaults?: Set<string>,
): {
  href: string
  isWall: boolean
  isVault: boolean
} {
  const isWall = message.instance.toLowerCase() === message.sender.toLowerCase()
  const isVault = !isWall && (vaults?.has(message.instance.toLowerCase()) ?? false)
  const href = isWall
    ? `/profile/${message.instance}`
    : isVault
      ? `/vault/${message.instance}`
      : `/collection/${message.instance}`
  return { href, isWall, isVault }
}

/** Channels rail — the distinct walls in the feed (All · per-collection · your wall). Each carries
 * a swatch (mono until the work's colour is wired) + its post count; selecting one filters the
 * salon. Composed app-side (the brand bible names .noesis-channels but it isn't vendored yet). */
function ChannelsRail({
  channels,
  active,
  onSelect,
  connected,
}: {
  channels: [`0x${string}`, number][]
  active: 'all' | `0x${string}`
  onSelect: (c: 'all' | `0x${string}`) => void
  connected: `0x${string}` | undefined
}) {
  return (
    <nav className={styles.channels}>
      <p className={styles.channelsHead}>Channels</p>
      <button
        type="button"
        className={`${styles.channel} ${active === 'all' ? styles.channelOn : ''}`}
        onClick={() => onSelect('all')}
      >
        <span className={styles.swatch} aria-hidden />
        <span className={styles.channelName}>All discourse</span>
      </button>
      {channels.map(([inst, count]) => (
        <button
          key={inst}
          type="button"
          className={`${styles.channel} ${active === inst ? styles.channelOn : ''}`}
          onClick={() => onSelect(inst)}
        >
          <span className={styles.swatch} aria-hidden />
          <span className={styles.channelName}>
            {connected && inst.toLowerCase() === connected.toLowerCase()
              ? 'Your wall'
              : truncateAddress(inst)}
          </span>
          <span className={styles.channelCount}>{count}</span>
        </button>
      ))}
    </nav>
  )
}

/** Featured — the contained, honestly-labelled paid-placement module (never the lead). Reads the
 * same featured set as Home/discovery; rendered in the board's left rail under Channels. */
function FeaturedRail() {
  const { data } = useReadQueryAggregatorGetHomePageData({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [0n, 6n],
  })
  const cards = data?.[0] ?? []
  if (cards.length === 0) return null
  return (
    <aside className="noesis-featured">
      <p className="fk">
        Featured · <b>paid placement</b> — labelled, not an endorsement
      </p>
      {cards.slice(0, 5).map((c) => (
        <Link key={c.instance} href={`/collection/${c.instance}`} className="fcard">
          <div>
            <div className="fn">{c.name || truncateAddress(c.instance)}</div>
          </div>
          <span className="fp">{formatGwei(c.currentPrice)} gwei</span>
        </Link>
      ))}
    </aside>
  )
}

/** One page of the board feed = one reverse window of `MessagePosted` logs (ADR-0010 Tier 1B). */
interface FeedPage {
  messages: FeedMessage[]
  /** toBlock for the next (older) page, or null once the deploy-block floor is reached. */
  nextCursor: bigint | null
}

function useGlobalFeed(): {
  data: FeedMessage[] | undefined
  isPending: boolean
  isError: boolean
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  // Infinite, newest-first: the first page is the most recent window (fast initial paint — never
  // scans to the floor), "load older" walks one window back per page down to the deploy block.
  const q = useInfiniteQuery({
    // Keyed under 'message-feed' so reply/react refetches (which invalidate that key) refresh the board.
    queryKey: ['message-feed', 'global'],
    enabled: !!client,
    staleTime: 15_000,
    initialPageParam: null as bigint | null,
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      if (!client) return { messages: [], nextCursor: null }
      const toBlock = pageParam ?? (await client.getBlockNumber())
      const lo = toBlock - DEFAULT_LOG_WINDOW + 1n
      const fromBlock = lo > deployBlock ? lo : deployBlock

      const logs = await client.getContractEvents({
        address: forkAddresses.GlobalMessageRegistry,
        abi: globalMessageRegistryAbi,
        eventName: 'MessagePosted',
        fromBlock,
        toBlock,
      })

      const messages: FeedMessage[] = []
      for (const log of logs) {
        const { messageId, instance, sender, messageType, refId, content } = log.args
        if (
          messageId === undefined ||
          instance === undefined ||
          sender === undefined ||
          messageType === undefined ||
          refId === undefined ||
          content === undefined
        ) {
          continue
        }
        messages.push({ messageId, instance, sender, messageType, refId, content })
      }

      return { messages, nextCursor: fromBlock <= deployBlock ? null : fromBlock - 1n }
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  // Flatten pages + sort newest-first (re-threading over the accumulated set as older pages load
  // keeps replies' parents resolvable).
  const data = useMemo((): FeedMessage[] | undefined => {
    if (!q.data) return undefined
    const all = q.data.pages.flatMap((p) => p.messages)
    return all.sort((a, b) => (a.messageId > b.messageId ? -1 : a.messageId < b.messageId ? 1 : 0))
  }, [q.data])

  return {
    data,
    isPending: q.isPending,
    isError: q.isError,
    fetchNextPage: () => void q.fetchNextPage(),
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  }
}

/**
 * Board route — platform-wide threaded activity across all channels.
 * Compose section posts to the connected user's own wall (their address as channel),
 * which is the established convention from ProfilePage and shows in this global feed.
 * Replies (type 1) nest under their parent; reactions (type 3) aggregate into a 👍 count.
 */
export function BoardPage() {
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useGlobalFeed()
  const { address: connected } = useAccount()
  const [boardView, setBoardView] = useState<BoardView>('discourse')

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])

  // Known vault addresses → route vault-channel posts to /vault/… (not a dead collection link).
  const { vaults } = useAllVaults()
  const vaultSet = useMemo(
    () => new Set(vaults.map((v) => v.address.toLowerCase())),
    [vaults],
  )

  // Channels — distinct walls drawn from the feed (a collection, or a sender's own address). The
  // rail filters the salon to one channel; "All" is the default. Ordered by post volume.
  const [channel, setChannel] = useState<'all' | `0x${string}`>('all')
  const channels = useMemo(() => {
    const counts = new Map<`0x${string}`, number>()
    for (const m of data ?? []) counts.set(m.instance, (counts.get(m.instance) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [data])
  const visibleThreads = view.threads.filter(
    (t) => channel === 'all' || t.message.instance === channel,
  )
  const activityRows = (data ?? []).filter((m) => channel === 'all' || m.instance === channel)

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <header className={styles.salonHead}>
        <h1 className={styles.title}>The salon</h1>
        <p className={styles.sub}>
          Discourse on the work — every voice attributed on-chain, permanent. No anonymous posts.
        </p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.rail}>
          <ChannelsRail
            channels={channels}
            active={channel}
            onSelect={setChannel}
            connected={connected}
          />
          <FeaturedRail />
        </aside>

        <div className={styles.main}>
          <div className={styles.toolbar}>
            <nav className="noesis-viewtoggle">
              <button
                type="button"
                className={`${styles.toggleBtn} ${boardView === 'discourse' ? styles.toggleOn : ''}`}
                onClick={() => setBoardView('discourse')}
              >
                Discourse
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${boardView === 'activity' ? styles.toggleOn : ''}`}
                onClick={() => setBoardView('activity')}
              >
                Activity
              </button>
            </nav>
          </div>

          {connected !== undefined && (
            <section className={styles.composeSection}>
              {/* channel = sender's own address — the established per-wall convention */}
              <MessageComposer channel={connected} />
              <p className={styles.composeNote}>
                signed by {truncateAddress(connected)} · permanent — posts appear in the feed and on
                your profile
              </p>
            </section>
          )}

          {connected === undefined && (
            <StateBlock variant="empty" boxed>
              connect your wallet to post — every voice on the board is attributed.
            </StateBlock>
          )}

          <section className={styles.feedSection}>
            {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}

            {isError && (
              <StateBlock variant="error">couldn&apos;t load activity — is the fork up?</StateBlock>
            )}

            {!isPending && !isError && data !== undefined && data.length === 0 && (
              <StateBlock variant="empty" boxed>
                this wall is empty — be the first to say something considered.
              </StateBlock>
            )}

            {/* Discourse — the threaded salon (filtered to the active channel). */}
            {!isPending && !isError && boardView === 'discourse' && visibleThreads.length > 0 && (
              <div className={styles.list}>
                {visibleThreads.map((thread) => (
                  <article
                    key={String(thread.message.messageId)}
                    className="noesis-post"
                    data-testid="board-thread"
                  >
                    <BoardMessage
                      message={thread.message}
                      view={view}
                      connected={connected !== undefined}
                      vaults={vaultSet}
                    />

                    {thread.replies.map((reply) => (
                      <div
                        key={String(reply.messageId)}
                        className="reply"
                        data-testid="board-reply"
                      >
                        <BoardMessage
                          message={reply}
                          view={view}
                          connected={connected !== undefined}
                          vaults={vaultSet}
                        />
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )}

            {/* Activity — the flat on-chain register, every event attributed, newest first. */}
            {!isPending && !isError && boardView === 'activity' && data !== undefined && (
              <ul className={styles.register} data-testid="board-activity">
                {activityRows.map((m) => (
                  <li key={String(m.messageId)} className={styles.regRow}>
                    <Link href={`/profile/${m.sender}`} className={styles.regWho}>
                      {truncateAddress(m.sender)}
                    </Link>
                    <span className={styles.regVerb}>
                      {ACTIVITY_VERB[m.messageType] ?? 'posted'}
                    </span>
                    {(() => {
                      const { href, isWall, isVault } = channelRef(m, vaultSet)
                      // A wall post has no collection channel — it's a general-board post; show it
                      // as such (linking to the wall/profile) rather than a dead collection link.
                      // A vault channel links to the vault page.
                      return (
                        <Link href={href} className={styles.regCh}>
                          {isWall
                            ? 'the salon'
                            : isVault
                              ? `vault ${truncateAddress(m.instance)}`
                              : truncateAddress(m.instance)}
                        </Link>
                      )
                    })()}
                    {m.content.length > 0 && <span className={styles.regContent}>{m.content}</span>}
                  </li>
                ))}
              </ul>
            )}

            {/* Load older — fetches the next window back (ADR-0010 Tier 1B); hidden once the feed
                reaches the deploy-block floor. */}
            {!isPending && !isError && data !== undefined && data.length > 0 && hasNextPage && (
              <div className={styles.loadOlder}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={fetchNextPage}
                  disabled={isFetchingNextPage}
                  data-testid="board-load-older"
                >
                  {isFetchingNextPage ? 'loading older…' : 'load older'}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function BoardMessage({
  message,
  view,
  connected,
  vaults,
}: {
  message: FeedMessage
  view: ThreadView
  connected: boolean
  vaults?: Set<string>
}) {
  const [replying, setReplying] = useState(false)
  const reaction = reactionFor(view, message.messageId)
  const chan = channelRef(message, vaults)

  return (
    <>
      <div className="phead">
        <Link href={`/profile/${message.sender}`} className={`name ${styles.senderLink}`}>
          {truncateAddress(message.sender)}
        </Link>

        {/* A wall post is a general-board post (channel = the sender's own wall), not a collection
            pointer — read it as "· on the salon" linking to their wall, never a dead collection. */}
        <Link href={chan.href} className={`ch ${styles.channelLink}`}>
          {chan.isWall
            ? '· on the salon'
            : `→ ${chan.isVault ? 'vault ' : ''}${truncateAddress(message.instance)}`}
        </Link>
      </div>

      {/* Quote — a card carrying the referenced work's swatch (mono until colour is wired). */}
      {message.messageType === 2 && (
        <Link href={chan.href} className={styles.quoteCard}>
          <span className={styles.swatch} aria-hidden />
          <span className={styles.quoteRef}>
            re: {chan.isWall ? 'the salon' : truncateAddress(message.instance)}
          </span>
        </Link>
      )}

      {message.content.length > 0 && (
        <p className="ptext">
          <Linkify text={message.content} />
        </p>
      )}

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
    </>
  )
}
