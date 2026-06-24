/**
 * ReactButton — posts a REACT (messageType 3) targeting a message, and renders the aggregate count.
 *
 * Channel: posted to the TARGET message's `instance` channel (so the reaction appears in the same
 * filtered feed as the message it reacts to), `refId` = the target messageId. actionRef/metadata are
 * bytes32(0). The threading transform de-dupes by sender, so a second click by the same wallet won't
 * inflate the count once the feed refetches. Disabled (but still shows the count) when disconnected or
 * already reacted.
 */
import { useAccount } from 'wagmi'
import { globalMessageRegistryAbi } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { useTxAction } from './ui/useTxAction'
import styles from './MessageFeed.module.css'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

export function ReactButton({
  targetId,
  channel,
  count,
  reactedByMe,
  onReacted,
}: {
  targetId: bigint
  /** The target message's `instance` channel — the reaction is posted here so it threads in-context. */
  channel: `0x${string}`
  count: number
  reactedByMe: boolean
  onReacted: () => void
}) {
  const { address: connected } = useAccount()
  const tx = useTxAction({ onSuccess: onReacted })

  const disabled = connected === undefined || reactedByMe || tx.isBusy

  function react() {
    if (disabled || connected === undefined) return
    tx.send({
      address: forkAddresses.GlobalMessageRegistry,
      abi: globalMessageRegistryAbi,
      functionName: 'post',
      chainId: forkChainId,
      // [instance(=target channel), messageType=3 REACT, refId=targetId, actionRef, metadata, '']
      args: [channel, 3, targetId, ZERO_BYTES32, ZERO_BYTES32, ''],
    })
  }

  const label = tx.isBusy ? '…' : '👍'

  return (
    <button
      type="button"
      className={styles.reactBtn}
      onClick={react}
      disabled={disabled}
      data-testid="board-react"
      aria-pressed={reactedByMe}
      title={reactedByMe ? 'you reacted' : 'react'}
    >
      <span aria-hidden>{label}</span>
      <span className={styles.reactCount}>{count}</span>
    </button>
  )
}
