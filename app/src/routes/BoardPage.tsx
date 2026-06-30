import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { formatGwei } from 'viem'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient, useAccount } from 'wagmi'
import {
  globalMessageRegistryAbi,
  useReadQueryAggregatorGetHomePageData,
} from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { truncateAddress } from '../lib/format'
import { MessageComposer } from '../components/MessageComposer'
import { ReplyComposer } from '../components/ReplyComposer'
import { ReactButton } from '../components/ReactButton'
import { type ThreadView, reactionFor, threadMessages } from '../components/threadMessages'
import type { FeedMessage } from '../components/useMessageFeed'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './BoardPage.module.css'

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  2: 'QUOTE',
}

/** The board's two honest views: the threaded salon, and the flat on-chain register. (The spec's
 * third "All" stream would fold in mint/align/list events, which the board feed doesn't emit yet.) */
type BoardView = 'discourse' | 'activity'

/** Register verbs for the flat Activity view — the on-chain event, stated plainly. */
const ACTIVITY_VERB: Record<number, string> = { 0: 'posted', 1: 'replied', 2: 'quoted', 3: 'endorsed' }

/** Featured — the contained, honestly-labelled paid-placement module (never the lead). Reads the
 * same featured set as Home/discovery; rendered as the board's right rail. */
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

function useGlobalFeed(): {
  data: FeedMessage[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  return useQuery({
    // Keyed under 'message-feed' so reply/react refetches (which invalidate that key) refresh the board.
    queryKey: ['message-feed', 'global'],
    enabled: !!client,
    staleTime: 15_000,
    queryFn: async (): Promise<FeedMessage[]> => {
      if (!client) return []

      const logs = await client.getContractEvents({
        address: forkAddresses.GlobalMessageRegistry,
        abi: globalMessageRegistryAbi,
        eventName: 'MessagePosted',
        fromBlock: 0n,
        toBlock: 'latest',
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

      // Newest first — sort by messageId descending
      messages.sort((a, b) => (a.messageId > b.messageId ? -1 : a.messageId < b.messageId ? 1 : 0))

      return messages
    },
  })
}

/**
 * Board route — platform-wide threaded activity across all channels.
 * Compose section posts to the connected user's own wall (their address as channel),
 * which is the established convention from ProfilePage and shows in this global feed.
 * Replies (type 1) nest under their parent; reactions (type 3) aggregate into a 👍 count.
 */
export function BoardPage() {
  const { data, isPending, isError } = useGlobalFeed()
  const { address: connected } = useAccount()
  const queryClient = useQueryClient()
  const [boardView, setBoardView] = useState<BoardView>('discourse')

  const view = useMemo(() => threadMessages(data ?? [], connected), [data, connected])

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['message-feed'] })
  }

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

            {/* Discourse — the threaded salon. */}
            {!isPending && !isError && boardView === 'discourse' && view.threads.length > 0 && (
              <div className={styles.list}>
                {view.threads.map((thread) => (
                  <article
                    key={String(thread.message.messageId)}
                    className="noesis-post"
                    data-testid="board-thread"
                  >
                    <BoardMessage
                      message={thread.message}
                      view={view}
                      connected={connected !== undefined}
                      onChanged={refetch}
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
                          onChanged={refetch}
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
                {data.map((m) => (
                  <li key={String(m.messageId)} className={styles.regRow}>
                    <Link href={`/profile/${m.sender}`} className={styles.regWho}>
                      {truncateAddress(m.sender)}
                    </Link>
                    <span className={styles.regVerb}>
                      {ACTIVITY_VERB[m.messageType] ?? 'posted'}
                    </span>
                    <Link href={`/collection/${m.instance}`} className={styles.regCh}>
                      {truncateAddress(m.instance)}
                    </Link>
                    {m.content.length > 0 && <span className={styles.regContent}>{m.content}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <FeaturedRail />
      </div>
    </div>
  )
}

function BoardMessage({
  message,
  view,
  connected,
  onChanged,
}: {
  message: FeedMessage
  view: ThreadView
  connected: boolean
  onChanged: () => void
}) {
  const [replying, setReplying] = useState(false)
  const reaction = reactionFor(view, message.messageId)

  return (
    <>
      <div className="phead">
        <Link href={`/profile/${message.sender}`} className={`name ${styles.senderLink}`}>
          {truncateAddress(message.sender)}
        </Link>

        <Link href={`/collection/${message.instance}`} className={`ch ${styles.channelLink}`}>
          → {truncateAddress(message.instance)}
        </Link>

        {MESSAGE_TYPE_LABELS[message.messageType] !== undefined && (
          <span className="badge">{MESSAGE_TYPE_LABELS[message.messageType]}</span>
        )}
      </div>

      {message.content.length > 0 && <p className="ptext">{message.content}</p>}

      <div className={styles.actions}>
        <div className={styles.actionBar}>
          <ReactButton
            targetId={message.messageId}
            channel={message.instance}
            count={reaction.count}
            reactedByMe={reaction.reactedByMe}
            onReacted={onChanged}
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
            onPosted={onChanged}
            onCancel={() => setReplying(false)}
          />
        )}
      </div>
    </>
  )
}
