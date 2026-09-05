import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { formatEther, formatGwei } from 'viem'
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
import { meetsThreshold, threadMessages } from '../components/threadMessages'
import { type FeedMessage, usePostThreshold } from '../components/useMessageFeed'
import { ActivityBox } from '../components/activity/ActivityBox'
import { ActivityMessage } from '../components/activity/ActivityMessage'
import { channelRef, messageVerb } from '../components/activity/messageMeta'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './BoardPage.module.css'

/** The board's two honest views: the threaded salon, and the flat on-chain register. (The spec's
 * third "All" stream would fold in mint/align/list events, which the board feed doesn't emit yet.) */
type BoardView = 'discourse' | 'activity'

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

/** Exported for `BoardPage.test.tsx` — the cache-key isolation regression (noesis-422). */
export function useGlobalFeed(): {
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
    // Keyed under 'message-feed' so reply/react refetches (which invalidate that key) refresh the
    // board. This key is intentionally NOT shared with home's `useGlobalActivity` — the two cache
    // different shapes (infinite-query pages vs a plain array) and sharing a key lets whichever
    // populates the cache first poison the other's read (noesis-422).
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
        const { messageId, instance, sender, messageType, refId, value, content } = log.args
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
        messages.push({
          messageId,
          instance,
          sender,
          messageType,
          refId,
          value: value ?? 0n,
          content,
        })
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
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useGlobalFeed()
  const { address: connected } = useAccount()
  const [boardView, setBoardView] = useState<BoardView>('discourse')
  const threshold = usePostThreshold()

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])

  // The endorse/reply affordances every rendered message gets, in one stable object.
  const actions = useMemo(() => ({ view, connected: connected !== undefined }), [view, connected])

  // Known vault addresses → route vault-channel posts to /vault/… (not a dead collection link).
  const { vaults } = useAllVaults()
  const vaultSet = useMemo(() => new Set(vaults.map((v) => v.address.toLowerCase())), [vaults])

  // Channels — distinct walls drawn from the feed (a collection, or a sender's own address). The
  // rail filters the salon to one channel; "All" is the default. Ordered by post volume.
  const [channel, setChannel] = useState<'all' | `0x${string}`>('all')
  const channels = useMemo(() => {
    const counts = new Map<`0x${string}`, number>()
    for (const m of data ?? []) counts.set(m.instance, (counts.get(m.instance) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [data])
  // Channel filter + N12 spam lever: hide top-level posts below the threshold (their nested replies go
  // with the dropped thread); replies/reactions and orphan-promoted rows stay. threshold 0 = show all.
  const visibleThreads = view.threads.filter(
    (t) =>
      (channel === 'all' || t.message.instance === channel) && meetsThreshold(t.message, threshold),
  )
  const activityRows = (data ?? []).filter(
    (m) => (channel === 'all' || m.instance === channel) && meetsThreshold(m, threshold),
  )

  // The window's name plate says which channel you are standing in — the rail's own labels, so the
  // room you picked and the room you are in are named the same way.
  const roomName =
    channel === 'all'
      ? 'All discourse'
      : connected && channel.toLowerCase() === connected.toLowerCase()
        ? 'Your wall'
        : truncateAddress(channel)

  // What the plate counts: the lines actually in the transcript of the active view.
  const rows =
    boardView === 'discourse'
      ? visibleThreads.reduce((n, t) => n + 1 + t.replies.length, 0)
      : activityRows.length

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
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

          {/* The salon is the same chat box home's preview and every collection feed are drawn in
              — one window, named for the channel you are standing in, with the composer in its
              well. The composer used to sit above the feed as a section of its own, which read as
              a form over a list rather than as a room you speak in. */}
          <ActivityBox
            room={roomName}
            status={rows > 0 ? `${rows} posts` : undefined}
            scrolls
            composer={
              connected !== undefined ? (
                <>
                  {/* channel = sender's own address — the established per-wall convention */}
                  <MessageComposer channel={connected} />
                  <p className={styles.composeNote}>
                    signed by {truncateAddress(connected)} · permanent — posts appear in the feed
                    and on your profile
                  </p>
                </>
              ) : (
                <StateBlock variant="empty">
                  connect your wallet to post — every voice on the board is attributed.
                </StateBlock>
              )
            }
          >
            {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}

            {isError && (
              <StateBlock variant="error">couldn&apos;t load activity — is the fork up?</StateBlock>
            )}

            {!isPending && !isError && data !== undefined && data.length === 0 && (
              <StateBlock variant="empty" boxed>
                this wall is empty — be the first to say something considered.
              </StateBlock>
            )}

            {/* Discourse — the threaded salon (filtered to the active channel). Newest first in the
                DOM; the transcript reverses it onto the floor of the window. */}
            {!isPending &&
              !isError &&
              boardView === 'discourse' &&
              visibleThreads.map((thread) => (
                <ActivityMessage
                  key={String(thread.message.messageId)}
                  message={thread.message}
                  replies={thread.replies}
                  vaults={vaultSet}
                  actions={actions}
                />
              ))}

            {/* Activity — the flat on-chain register, every event attributed. */}
            {!isPending && !isError && boardView === 'activity' && data !== undefined && (
              <ul className={styles.register} data-testid="board-activity">
                {activityRows.map((m) => {
                  const chan = channelRef(m, vaultSet)
                  return (
                    <li key={String(m.messageId)} className={styles.regRow}>
                      <Link href={`/profile/${m.sender}`} className={styles.regWho}>
                        {truncateAddress(m.sender)}
                      </Link>
                      <span className={styles.regVerb}>{messageVerb(m.messageType)}</span>
                      <Link href={chan.href} className={styles.regCh}>
                        {chan.label}
                      </Link>
                      {m.content.length > 0 && (
                        <span className={styles.regContent}>{m.content}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Both of these are scrollback: last in the DOM, so the reversed transcript puts them
                at the top of the pane, above the oldest line — where you go looking for them.
                "Load older" fetches the next window back (ADR-0010 Tier 1B); it is hidden once the
                feed reaches the deploy-block floor. */}
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

            {threshold > 0n && (
              <StateBlock variant="empty" testId="board-threshold-note">
                spam lever on: showing posts of {formatEther(threshold)} ETH or more — cheaper posts
                are hidden until the threshold is lowered.
              </StateBlock>
            )}
          </ActivityBox>
        </div>
      </div>
    </div>
  )
}
