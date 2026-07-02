/**
 * ReactButton — endorse (messageType 3) a message. Endorsements AUTO-BATCH: clicking queues the
 * endorse into the board cart (toggle: click again to un-queue) and the sticky <BoardCartBar> commits
 * every queued board action in one postBatch. No separate "+ batch" button — every board action
 * batches by default. The count shows the on-chain tally plus your pending (queued) endorse.
 *
 * Channel: queued against the TARGET message's `instance` channel, `refId` = the target messageId, so
 * once committed the endorse threads in the same filtered feed as the message it reacts to. Disabled
 * (count still shown) when disconnected or already endorsed on-chain.
 */
import { useAccount } from 'wagmi'
import { useBoardCart, ZERO_BYTES32 } from './board/boardCart'
import styles from './MessageFeed.module.css'

export function ReactButton({
  targetId,
  channel,
  count,
  reactedByMe,
}: {
  targetId: bigint
  /** The target message's `instance` channel — the endorse is posted here so it threads in-context. */
  channel: `0x${string}`
  count: number
  reactedByMe: boolean
}) {
  const { address: connected } = useAccount()
  const { add, remove, items } = useBoardCart()

  const queuedItem = items.find(
    (i) =>
      i.messageType === 3 &&
      i.refId === targetId &&
      i.instance.toLowerCase() === channel.toLowerCase(),
  )
  const queued = queuedItem !== undefined
  const disabled = connected === undefined || reactedByMe

  function toggle() {
    if (disabled) return
    if (queuedItem) {
      remove(queuedItem.id)
    } else {
      add({
        instance: channel,
        messageType: 3,
        refId: targetId,
        actionRef: ZERO_BYTES32,
        metadata: ZERO_BYTES32,
        content: '',
        label: `endorse #${targetId.toString()}`,
      })
    }
  }

  // Endorsement, not emoji — the one dignified reaction, rendered as the mono "▪ endorsed · N" mark.
  const shown = count + (queued ? 1 : 0)
  const verb = reactedByMe ? 'endorsed' : queued ? 'queued' : 'endorse'
  return (
    <button
      type="button"
      className={`${styles.reactBtn} noesis-endorse`}
      onClick={toggle}
      disabled={disabled}
      data-testid="board-react"
      aria-pressed={reactedByMe || queued}
      title={
        reactedByMe
          ? 'you endorsed this'
          : queued
            ? 'queued to endorse — un-queue'
            : 'endorse (queues to your batch)'
      }
    >
      {verb} · <span className={styles.reactCount}>{shown}</span>
    </button>
  )
}
