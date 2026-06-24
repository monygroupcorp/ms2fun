import { Link } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useAccount } from 'wagmi'
import { globalMessageRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { truncateAddress } from '../lib/format'
import { MessageComposer } from '../components/MessageComposer'
import styles from './BoardPage.module.css'

interface BoardMessage {
  messageId: bigint
  instance: `0x${string}`
  sender: `0x${string}`
  messageType: number
  refId: bigint
  content: string
}

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  1: 'REPLY',
  2: 'QUOTE',
  3: 'REACT',
}

function useGlobalFeed(): {
  data: BoardMessage[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  return useQuery({
    queryKey: ['message-feed-global'],
    enabled: !!client,
    staleTime: 15_000,
    queryFn: async (): Promise<BoardMessage[]> => {
      if (!client) return []

      const logs = await client.getContractEvents({
        address: forkAddresses.GlobalMessageRegistry,
        abi: globalMessageRegistryAbi,
        eventName: 'MessagePosted',
        fromBlock: 0n,
        toBlock: 'latest',
      })

      const messages: BoardMessage[] = []
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
 * Board route — platform-wide activity feed across all channels.
 * Compose section posts to the connected user's own wall (their address as channel),
 * which is the established convention from ProfilePage and shows in this global feed.
 */
export function BoardPage() {
  const { data, isPending, isError } = useGlobalFeed()
  const { address: connected } = useAccount()

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

        {!isPending && !isError && data !== undefined && data.length > 0 && (
          <ul className={styles.list}>
            {data.map((msg) => (
              <li key={String(msg.messageId)} className={styles.item}>
                <div className={styles.meta}>
                  <Link href={`/profile/${msg.sender}`} className={styles.senderLink}>
                    {truncateAddress(msg.sender)}
                  </Link>

                  <span className={styles.arrow}>→</span>

                  <Link href={`/collection/${msg.instance}`} className={styles.channelLink}>
                    {truncateAddress(msg.instance)}
                  </Link>

                  {msg.messageType !== 0 && (
                    <span className="badge">
                      {MESSAGE_TYPE_LABELS[msg.messageType] ?? String(msg.messageType)}
                    </span>
                  )}
                </div>

                <p className={styles.content}>{msg.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
