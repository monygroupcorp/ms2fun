import { useEffect, useState } from 'react'
import { formatEther } from 'viem'
import { useBoardCart, ZERO_BYTES32 } from './board/boardCart'
import { usePostThreshold } from './useMessageFeed'
import { AmountField } from './ui/AmountField'
import { parseAmount } from './ui/parseAmount'
import styles from './MessageComposer.module.css'

/**
 * MessageComposer — writes a top-level post. Posts AUTO-BATCH: "Post" queues the message into the
 * board cart and the sticky <BoardCartBar> commits every queued board action in one postBatch. No
 * separate "add to batch" button — every board action batches by default (M4).
 *
 * N12 spam lever: each post can attach ETH (`value`). The amount defaults to the current on-chain
 * `postThreshold` so a post clears the bar by default; posting below it is still allowed on-chain but
 * the feed hides it until the threshold is lowered.
 */
export function MessageComposer({ channel }: { channel: `0x${string}` }) {
  const [content, setContent] = useState('')
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const { add } = useBoardCart()
  const threshold = usePostThreshold()

  // Default the amount to the current threshold (once, until the user edits it), so a fresh post
  // clears the bar without the author having to look the number up.
  useEffect(() => {
    if (!amountTouched) setAmount(threshold > 0n ? formatEther(threshold) : '')
  }, [threshold, amountTouched])

  const parsed = parseAmount(amount) // undefined on empty/invalid
  const amountInvalid = amount.trim() !== '' && parsed === undefined
  const value = parsed ?? 0n
  const belowThreshold = threshold > 0n && value < threshold

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || amountInvalid) return
    add({
      instance: channel,
      messageType: 0,
      refId: 0n,
      actionRef: ZERO_BYTES32,
      metadata: ZERO_BYTES32,
      value,
      content: trimmed,
      label: trimmed,
    })
    setContent('')
    // Keep the amount (and its threshold default) for the next post in the session.
  }

  const canPost = content.trim().length > 0 && !amountInvalid

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <textarea
        className={styles.textarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="write something…"
        rows={3}
      />
      <div className={styles.footer}>
        <div className={styles.amount}>
          <AmountField
            value={amount}
            onChange={(v) => {
              setAmountTouched(true)
              setAmount(v)
            }}
            placeholder="0"
            unit="ETH"
            ariaLabel="ETH to attach to this post"
            testId="composer-amount"
          />
          {threshold > 0n && (
            <span className={styles.status} data-testid="composer-threshold-hint">
              {belowThreshold
                ? `below the ${formatEther(threshold)} ETH threshold — this post will be hidden from the feed`
                : `meets the ${formatEther(threshold)} ETH threshold`}
            </span>
          )}
          {threshold === 0n && (
            <span className={styles.status}>queues to your batch — finalize below</span>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!canPost}>
          Post
        </button>
      </div>
    </form>
  )
}
