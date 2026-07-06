/**
 * ReplyComposer — a compact composer for a REPLY (messageType 1) to a parent message. Replies
 * AUTO-BATCH: "Reply" queues the reply into the board cart and collapses; the sticky <BoardCartBar>
 * commits it (with any other queued actions) in one postBatch. No separate "add to batch" button.
 *
 * Channel: queued against the PARENT message's `instance` channel (not the replier's own wall) so it
 * appears wherever the parent does; `refId` = the parent's messageId so the threading transform nests
 * it once committed. `sender` is the replier (msg.sender). actionRef/metadata are bytes32(0).
 */
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useBoardCart, ZERO_BYTES32 } from './board/boardCart'
import composer from './MessageComposer.module.css'

export function ReplyComposer({
  parentId,
  channel,
  onCancel,
}: {
  parentId: bigint
  /** The parent message's `instance` channel — the reply is queued here so it threads in-context. */
  channel: `0x${string}`
  onCancel: () => void
}) {
  const { address: connected } = useAccount()
  const [content, setContent] = useState('')
  const { add } = useBoardCart()

  if (connected === undefined) {
    return (
      <p className={composer.status} data-testid="board-reply-composer">
        connect your wallet to reply
      </p>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    add({
      instance: channel,
      messageType: 1,
      refId: parentId,
      actionRef: ZERO_BYTES32,
      metadata: ZERO_BYTES32,
      value: 0n, // replies are exempt from the post-value threshold
      content: trimmed,
      label: `reply: ${trimmed}`,
    })
    setContent('')
    onCancel()
  }

  const canPost = content.trim().length > 0

  return (
    <form className={composer.composer} onSubmit={submit} data-testid="board-reply-composer">
      <textarea
        className={composer.textarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="write a reply…"
        rows={2}
        autoFocus
      />
      <div className={composer.footer}>
        <span className={composer.status}>queues to your batch</span>
        <div style={{ display: 'flex', gap: 'var(--gap-md)' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canPost}>
            Reply
          </button>
        </div>
      </div>
    </form>
  )
}
