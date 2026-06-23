import { type FeedFilter, useMessageFeed } from './useMessageFeed'
import styles from './MessageFeed.module.css'

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  1: 'REPLY',
  2: 'QUOTE',
  3: 'REACT',
}

function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function MessageFeed({ filter }: { filter: FeedFilter }) {
  const { data, isPending, isError } = useMessageFeed(filter)

  return (
    <div className={styles.section}>
      <h2 className={`${styles.heading} text-chromatic-medium`}>ACTIVITY</h2>

      {isPending && <p className={styles.note}>loading activity…</p>}

      {isError && <p className={styles.note}>couldn&apos;t load activity — is the fork up?</p>}

      {!isPending && !isError && data !== undefined && data.length === 0 && (
        <p className={styles.note} data-testid="message-feed-empty">
          no activity yet
        </p>
      )}

      {!isPending && !isError && data !== undefined && data.length > 0 && (
        <ul className={styles.list} data-testid="message-feed">
          {data.map((msg) => (
            <li key={String(msg.messageId)} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.sender}>{truncateAddress(msg.sender)}</span>
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
    </div>
  )
}
