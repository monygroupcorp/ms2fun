import { useState } from 'react'
import { useBoardCart, ZERO_BYTES32 } from './board/boardCart'
import styles from './MessageComposer.module.css'

/**
 * MessageComposer — writes a top-level post. Posts AUTO-BATCH: "Post" queues the message into the
 * board cart and the sticky <BoardCartBar> commits every queued board action in one postBatch. No
 * separate "add to batch" button — every board action batches by default (M4).
 */
export function MessageComposer({ channel }: { channel: `0x${string}` }) {
  const [content, setContent] = useState('')
  const { add } = useBoardCart()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    add({
      instance: channel,
      messageType: 0,
      refId: 0n,
      actionRef: ZERO_BYTES32,
      metadata: ZERO_BYTES32,
      content: trimmed,
      label: trimmed,
    })
    setContent('')
  }

  const canPost = content.trim().length > 0

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
        <span className={styles.status}>queues to your batch — finalize below</span>
        <button type="submit" className="btn btn-primary" disabled={!canPost}>
          Post
        </button>
      </div>
    </form>
  )
}
