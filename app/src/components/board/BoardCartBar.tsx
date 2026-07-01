/**
 * BoardCartBar — the sticky finalize bar for the board transaction cart. Renders only when the cart
 * has queued actions. Lists them (each removable), then commits ALL of them in a single
 * `postBatch(tuple[])` transaction. On success it clears the cart and invalidates the feed so the new
 * messages appear at once. Errors surface the decoded reason via useTxAction (`reason`).
 */
import { useQueryClient } from '@tanstack/react-query'
import { globalMessageRegistryAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import { useBoardCart } from './boardCart'
import styles from './BoardCartBar.module.css'

const TYPE_VERB: Record<number, string> = { 0: 'post', 1: 'reply', 3: 'endorse' }

export function BoardCartBar() {
  const { items, remove, clear, count } = useBoardCart()
  const queryClient = useQueryClient()
  const tx = useTxAction({
    onSuccess: () => {
      clear()
      void queryClient.invalidateQueries({ queryKey: ['message-feed'] })
    },
  })

  if (count === 0) return null

  function finalize() {
    tx.send({
      address: forkAddresses.GlobalMessageRegistry,
      abi: globalMessageRegistryAbi,
      functionName: 'postBatch',
      chainId: forkChainId,
      args: [
        items.map((i) => ({
          instance: i.instance,
          messageType: i.messageType,
          refId: i.refId,
          actionRef: i.actionRef,
          metadata: i.metadata,
          content: i.content,
        })),
      ],
    })
  }

  return (
    <div
      className={styles.bar}
      role="region"
      aria-label="board transaction cart"
      data-testid="board-cart"
    >
      <div className={styles.inner}>
        <div className={styles.head}>
          <span className={styles.title}>Batch · {count} not yet on-chain</span>
          <button type="button" className={styles.clear} onClick={clear} disabled={tx.isBusy}>
            clear
          </button>
        </div>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.verb}>{TYPE_VERB[item.messageType] ?? 'post'}</span>
              <span className={styles.label}>{item.label}</span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(item.id)}
                disabled={tx.isBusy}
                aria-label={`remove ${item.label}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <TxButton
          state={tx.state}
          onClick={finalize}
          label={`finalize ${count} on-chain →`}
          successLabel={`${count} committed ✓`}
          errorText={tx.reason ?? 'batch failed — try again'}
          testId="board-cart-finalize"
        />
      </div>
    </div>
  )
}
