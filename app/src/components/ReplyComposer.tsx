/**
 * ReplyComposer — a compact composer for posting a REPLY (messageType 1) to a parent message.
 *
 * Channel: a reply is posted to the PARENT message's `instance` channel (not the replier's own wall)
 * so it appears wherever the parent does — a reply to a collection message shows on that collection
 * page, not only on the global board. `refId` = the parent's messageId so the threading transform can
 * nest it; `sender` is still the replier (set by msg.sender). actionRef/metadata are bytes32(0). On a
 * confirmed receipt it clears, calls onPosted (feed refetch), and collapses.
 */
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { globalMessageRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { useTxAction } from './ui/useTxAction'
import composer from './MessageComposer.module.css'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export function ReplyComposer({
  parentId,
  channel,
  onPosted,
  onCancel,
}: {
  parentId: bigint
  /** The parent message's `instance` channel — the reply is posted here so it threads in-context. */
  channel: `0x${string}`
  onPosted: () => void
  onCancel: () => void
}) {
  const { address: connected } = useAccount()
  const [content, setContent] = useState('')
  const tx = useTxAction({ onSuccess: onPosted })

  // Collapse the composer once the reply confirms.
  useEffect(() => {
    if (tx.state === 'success') {
      setContent('')
      onCancel()
    }
  }, [tx.state, onCancel])

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
    if (!trimmed || connected === undefined) return
    tx.send({
      address: forkAddresses.GlobalMessageRegistry,
      abi: globalMessageRegistryAbi,
      functionName: 'post',
      chainId: forkChainId,
      // [instance(=parent channel), messageType=1 REPLY, refId=parentId, actionRef, metadata, content]
      args: [channel, 1, parentId, ZERO_BYTES32, ZERO_BYTES32, trimmed],
    })
  }

  const canPost = content.trim().length > 0 && !tx.isBusy

  return (
    <form className={composer.composer} onSubmit={submit} data-testid="board-reply-composer">
      <textarea
        className={composer.textarea}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="write a reply…"
        rows={2}
        disabled={tx.isBusy}
        autoFocus
      />
      <div className={composer.footer}>
        <span className={composer.status}>
          {tx.state === 'signing' && 'confirm in wallet…'}
          {tx.state === 'confirming' && 'posting…'}
          {tx.state === 'error' && 'failed — try again'}
        </span>
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
