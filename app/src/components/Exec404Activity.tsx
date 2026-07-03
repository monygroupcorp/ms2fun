/**
 * B7 — the fossil's legacy on-chain activity. The genesis DN404 baked a trade-message log into its
 * bonding curve (`totalMessages()` + `getMessagesBatch()`), so EXEC's original chatter lives on-chain
 * even though the curve is long closed. We read the most recent slice and render it read-only.
 */
import { useReadContract } from 'wagmi'
import { exec404Contract } from '../lib/exec404'
import { truncateAddress } from '../lib/format'
import { Linkify } from './ui/Linkify'
import styles from './Exec404Activity.module.css'

/** How many of the most recent legacy messages to surface. */
const LIMIT = 15n

interface LegacyMessage {
  sender: `0x${string}`
  message: string
  timestamp: number
  amount: bigint
  isBuy: boolean
}

/** Read the tail of the fossil's on-chain message log, newest-first, messages-only. */
function useExec404Messages(): { messages: LegacyMessage[]; isPending: boolean; isError: boolean } {
  const countRead = useReadContract({
    ...exec404Contract,
    functionName: 'totalMessages',
  })
  const total = countRead.data

  // getMessagesBatch end index is INCLUSIVE and must be <= total-1.
  const hasMessages = total !== undefined && total > 0n
  const start = hasMessages ? (total > LIMIT ? total - LIMIT : 0n) : 0n
  const end = hasMessages ? total - 1n : 0n

  const batchRead = useReadContract({
    ...exec404Contract, // carries address + abi + chainId
    functionName: 'getMessagesBatch',
    args: [start, end],
    query: { enabled: hasMessages },
  })

  const messages: LegacyMessage[] = []
  if (batchRead.data) {
    const [senders, timestamps, amounts, isBuys, texts] = batchRead.data
    for (let i = 0; i < senders.length; i++) {
      const text = texts[i] ?? ''
      if (text.trim() === '') continue // it's a message feed — skip trades that carried no note
      const sender = senders[i]
      if (sender === undefined) continue
      messages.push({
        sender,
        message: text,
        timestamp: Number(timestamps[i] ?? 0n),
        amount: amounts[i] ?? 0n,
        isBuy: isBuys[i] ?? true,
      })
    }
    messages.reverse() // newest first
  }

  return {
    messages,
    isPending: countRead.isPending || (hasMessages && batchRead.isPending),
    isError: countRead.isError || batchRead.isError,
  }
}

/** Compact "3mo ago" style relative time from a unix-seconds timestamp. */
function timeAgo(unixSec: number): string {
  if (!unixSec) return ''
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  const units: [number, string][] = [
    [31_536_000, 'y'],
    [2_592_000, 'mo'],
    [86_400, 'd'],
    [3_600, 'h'],
    [60, 'm'],
  ]
  for (const [size, label] of units) {
    if (secs >= size) return `${Math.floor(secs / size)}${label} ago`
  }
  return 'just now'
}

export function Exec404Activity() {
  const { messages, isPending, isError } = useExec404Messages()

  return (
    <section className={styles.card} data-testid="exec404-activity">
      <h2 className={styles.title}>Legacy activity</h2>
      <p className={styles.note}>EXEC&apos;s original on-chain chatter, from the bonding-curve era.</p>

      {isPending ? (
        <p className={styles.state}>reading the ledger…</p>
      ) : isError ? (
        <p className={styles.state}>could not read legacy messages (archive fork needed).</p>
      ) : messages.length === 0 ? (
        <p className={styles.state}>no legacy messages.</p>
      ) : (
        <ul className={styles.list}>
          {messages.map((m, i) => (
            <li key={`${m.timestamp}-${i}`} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.sender}>{truncateAddress(m.sender)}</span>
                <span className={`${styles.side} ${m.isBuy ? styles.buy : styles.sell}`}>
                  {m.isBuy ? 'bought' : 'sold'}
                </span>
                <span className={styles.time}>{timeAgo(m.timestamp)}</span>
              </div>
              <p className={styles.body}>
                <Linkify text={m.message} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
