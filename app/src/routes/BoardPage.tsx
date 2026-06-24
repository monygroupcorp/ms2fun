import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient, useAccount } from 'wagmi'
import { globalMessageRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { truncateAddress } from '../lib/format'
import { MessageComposer } from '../components/MessageComposer'
import { ReplyComposer } from '../components/ReplyComposer'
import { ReactButton } from '../components/ReactButton'
import { type ThreadView, reactionFor, threadMessages } from '../components/threadMessages'
import type { FeedMessage } from '../components/useMessageFeed'
import styles from './BoardPage.module.css'

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  2: 'QUOTE',
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

      <h1 className={`${styles.title} text-chromatic-medium`}>BOARD</h1>

      {connected !== undefined && (
        <section className={styles.composeSection}>
          <h2 className={styles.sectionHeading}>POST TO YOUR WALL</h2>
          <p className={styles.composeNote}>
            posts appear in the platform feed and on your profile
          </p>
          {/* channel = sender's own address — the established per-wall convention */}
          <MessageComposer channel={connected} />
        </section>
      )}

      {connected === undefined && <p className={styles.note}>connect your wallet to post</p>}

      <section className={styles.feedSection}>
        <h2 className={styles.sectionHeading}>ALL ACTIVITY</h2>

        {isPending && <p className={styles.note}>loading activity…</p>}

        {isError && <p className={styles.note}>couldn&apos;t load activity — is the fork up?</p>}

        {!isPending && !isError && data !== undefined && data.length === 0 && (
          <p className={styles.note}>no activity yet</p>
        )}

        {!isPending && !isError && view.threads.length > 0 && (
          <ul className={styles.list}>
            {view.threads.map((thread) => (
              <li
                key={String(thread.message.messageId)}
                className={styles.item}
                data-testid="board-thread"
              >
                <BoardMessage
                  message={thread.message}
                  view={view}
                  connected={connected !== undefined}
                  onChanged={refetch}
                />

                {thread.replies.length > 0 && (
                  <ul className={styles.replies}>
                    {thread.replies.map((reply) => (
                      <li
                        key={String(reply.messageId)}
                        className={styles.reply}
                        data-testid="board-reply"
                      >
                        <BoardMessage
                          message={reply}
                          view={view}
                          connected={connected !== undefined}
                          onChanged={refetch}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
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
      <div className={styles.meta}>
        <Link href={`/profile/${message.sender}`} className={styles.senderLink}>
          {truncateAddress(message.sender)}
        </Link>

        <span className={styles.arrow}>→</span>

        <Link href={`/collection/${message.instance}`} className={styles.channelLink}>
          {truncateAddress(message.instance)}
        </Link>

        {MESSAGE_TYPE_LABELS[message.messageType] !== undefined && (
          <span className="badge">{MESSAGE_TYPE_LABELS[message.messageType]}</span>
        )}
      </div>

      {message.content.length > 0 && <p className={styles.content}>{message.content}</p>}

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
              reply
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
