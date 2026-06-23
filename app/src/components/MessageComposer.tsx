import { useEffect, useState } from 'react'
import { useWriteGlobalMessageRegistryPost } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './MessageComposer.module.css'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export function MessageComposer({ channel }: { channel: `0x${string}` }) {
  const [content, setContent] = useState('')

  const { writeContract, isPending, isSuccess } = useWriteGlobalMessageRegistryPost()

  // Clear textarea after a successful post
  useEffect(() => {
    if (isSuccess) {
      setContent('')
    }
  }, [isSuccess])

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
        <button type="submit" className="btn btn-primary" disabled={!canPost}>
          Post
        </button>
      </div>
    </form>
  )
}
