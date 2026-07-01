import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWriteGlobalMessageRegistryPost } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { useBoardCart, ZERO_BYTES32 } from './board/boardCart'
import styles from './MessageComposer.module.css'

export function MessageComposer({ channel }: { channel: `0x${string}` }) {
  const [content, setContent] = useState('')

  const { writeContract, isPending, isSuccess } = useWriteGlobalMessageRegistryPost()
  const { add } = useBoardCart()
  const queryClient = useQueryClient()

  // Clear the textarea and refetch the feed(s) after a successful post so the new message appears
  // immediately rather than after the staleTime window.
  useEffect(() => {
    if (!isSuccess) return
    setContent('')
    void queryClient.invalidateQueries({ queryKey: ['message-feed'] })
  }, [isSuccess, queryClient])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    writeContract({
      address: forkAddresses.GlobalMessageRegistry,
      chainId: forkChainId,
      args: [channel, 0, 0n, ZERO_BYTES32, ZERO_BYTES32, trimmed],
    })
  }

  const canPost = content.trim().length > 0 && !isPending

  function handleAddToBatch() {
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

  return (
    <form className={styles.composer} onSubmit={handleSubmit}>
      <textarea
        className={styles.textarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="write something…"
        rows={3}
        disabled={isPending}
      />
      <div className={styles.footer}>
        <span className={styles.status}>
          {isPending && 'posting…'}
          {isSuccess && !isPending && 'posted'}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAddToBatch}
          disabled={content.trim().length === 0 || isPending}
        >
          add to batch
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canPost}>
          Post
        </button>
      </div>
    </form>
  )
}
