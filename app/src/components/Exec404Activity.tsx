/**
 * B7 — the fossil's legacy on-chain activity. The genesis DN404 baked a trade-message log into its
 * bonding curve (`totalMessages()` + `getMessagesBatch()`), so EXEC's original chatter lives on-chain
 * even though the curve is long closed. We read the most recent slice and render it read-only.
 *
 * It is drawn in `ActivityBox` — the same chat box home's preview, every collection/vault/profile
 * feed and the salon are drawn in — and each row is the shared `ActivityLine`. It used to carry an
 * entire second design for the same idea: its own bordered card with an uppercase heading, its own
 * byline stack with a boxed BOUGHT/SOLD pill and a right-floated time, its own body paragraph, its
 * own hand-rolled loading/empty/error notes. Two designs for "someone said something on-chain" is
 * the thing this surface is not allowed to be.
 *
 * No composer: the curve is closed, so there is nothing to say here. No channel on the line either
 * — every one of these was said in this one room, and the name plate already names it.
 */
import { useReadContract } from 'wagmi'
import { exec404Contract } from '../lib/exec404'
import { ActivityBox } from './activity/ActivityBox'
import { ActivityLine } from './activity/ActivityLine'
import { ActivityStates } from './activity/ActivityStates'
import { StateBlock } from './ui/StateBlock'

/** How many of the most recent legacy messages to surface. */
const LIMIT = 15n

interface LegacyMessage {
  sender: `0x${string}`
  message: string
  timestamp: number
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
    const [senders, timestamps, , isBuys, texts] = batchRead.data
    for (let i = 0; i < senders.length; i++) {
      const text = texts[i] ?? ''
      if (text.trim() === '') continue // it's a message feed — skip trades that carried no note
      const sender = senders[i]
      if (sender === undefined) continue
      messages.push({
        sender,
        message: text,
        timestamp: Number(timestamps[i] ?? 0n),
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
    <ActivityBox
      room="Legacy activity"
      status={messages.length > 0 ? `${messages.length} posts` : undefined}
      logTestId="exec404-activity"
      scrolls={messages.length > 4}
    >
      {/* Nothing filters this log — the curve is closed and every line it ever carried is here —
          so what it has in hand is always what it draws. */}
      <ActivityStates
        subject="legacy messages"
        isPending={isPending}
        isError={isError}
        fetched={messages.length}
        shown={messages.length}
        empty="no legacy messages — the bonding curve closed without a word."
        emptyTestId="exec404-activity-empty"
      />

      {/* Newest first in the DOM; the transcript reverses it, so the newest line sits on the floor
          of the box the way the live edge of a room does. The event is always named here — "bought"
          and "sold" are the whole vocabulary of a curve, and a line that named neither would say
          nothing at all. */}
      {!isPending &&
        !isError &&
        messages.map((m, i) => (
          <ActivityLine
            key={`${m.timestamp}-${i}`}
            sender={m.sender}
            verb={m.isBuy ? 'bought' : 'sold'}
            when={timeAgo(m.timestamp)}
            say={m.message}
          />
        ))}

      {/* What this room is, said once. Last in the DOM, so the reversed transcript puts it at the
          top of the scrollback, above the oldest line — the same place the salon parks its
          threshold note. */}
      <StateBlock variant="empty">
        EXEC&apos;s original on-chain chatter, from the bonding-curve era. The curve is closed;
        nothing new is said here.
      </StateBlock>
    </ActivityBox>
  )
}
