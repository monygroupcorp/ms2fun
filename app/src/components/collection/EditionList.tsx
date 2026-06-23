/**
 * EditionList — renders all ERC1155 editions for a given instance with per-edition mint panels.
 * Reads editions via useEditions (batched), reads live mint cost on-demand, and writes via
 * ERC1155Instance.mint with msg.value equal to the calculated cost.
 */
import { useState } from 'react'
import { formatEther } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc1155InstanceCalculateMintCost,
  useWriteErc1155InstanceMint,
} from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
import { useEditions, type EditionView } from './useEditions'
import styles from './EditionList.module.css'

/** bytes32 zero — used as gatingData for open mints. */
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

const PRICING_MODEL_LABELS: Record<number, string> = {
  0: 'fixed',
  1: 'limited',
  2: 'dynamic',
}

interface EditionListProps {
  instance: `0x${string}`
}

interface MintPanelProps {
  instance: `0x${string}`
  edition: EditionView
  refetch: () => void
}

function MintPanel({ instance, edition, refetch }: MintPanelProps) {
  const { isConnected } = useAccount()
  const [amount, setAmount] = useState(1)

  const { data: costData, isPending: costPending } = useReadErc1155InstanceCalculateMintCost({
    address: instance,
    chainId: forkChainId,
    args: [edition.id, BigInt(amount)],
    query: { enabled: amount > 0 },
  })

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteErc1155InstanceMint()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  function handleMint(): void {
    if (costData === undefined) return
    writeContract({
      address: instance,
      chainId: forkChainId,
      args: [edition.id, BigInt(amount), ZERO_BYTES32, '0x', costData],
      value: costData,
    })
  }

  function handleSuccess(): void {
    resetWrite()
    setAmount(1)
    refetch()
  }

  const cost = costData !== undefined ? formatEther(costData) : null
  const isBusy = sigPending || isConfirming

  if (!isConnected) {
    return (
      <div className={styles.mintPanel}>
        <p className={styles.connectNote}>connect wallet to mint</p>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className={styles.mintPanel}>
        <p className={styles.txStatus}>minted — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleSuccess}>
          reset
        </button>
      </div>
    )
  }

  return (
    <div className={styles.mintPanel}>
      <div className={styles.mintRow}>
        <input
          className={styles.amountInput}
          type="number"
          min={1}
          value={amount}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= 1) setAmount(v)
          }}
          disabled={isBusy}
          aria-label="mint amount"
        />
        <span className={styles.costLabel}>
          cost:{' '}
          <span className={styles.costValue}>
            {costPending ? '…' : cost !== null ? `${cost} ETH` : '—'}
          </span>
        </span>
        <button
          className="btn btn-primary"
          onClick={handleMint}
          disabled={isBusy || costData === undefined}
        >
          {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'mint'}
        </button>
      </div>
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed — try again</p>
      )}
    </div>
  )
}

export function EditionList({ instance }: EditionListProps) {
  const { data, isPending, isError, refetch } = useEditions(instance)

  if (isPending) {
    return <p className={styles.note}>loading editions…</p>
  }

  if (isError) {
    return <p className={styles.note}>could not load editions — is the fork up?</p>
  }

  if (data.length === 0) {
    return (
      <p className={styles.note} data-testid="editions-empty">
        no editions yet
      </p>
    )
  }

  return (
    <ul className={styles.list} data-testid="editions">
      {data.map((edition) => (
        <li key={edition.id.toString()} className={styles.card}>
          <EditionCard edition={edition} instance={instance} refetch={refetch} />
        </li>
      ))}
    </ul>
  )
}

interface EditionCardProps {
  edition: EditionView
  instance: `0x${string}`
  refetch: () => void
}

function EditionCard({ edition, instance, refetch }: EditionCardProps) {
  const pricingLabel = PRICING_MODEL_LABELS[edition.pricingModel] ?? `model-${edition.pricingModel}`
  const supplyLabel = edition.supply === 0n ? 'unlimited' : edition.supply.toString()

  return (
    <>
      <div className={styles.cardHeader}>
        <h3 className={styles.title}>{edition.pieceTitle || `edition #${edition.id}`}</h3>
        <span className={styles.badge}>{pricingLabel}</span>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>price</span>
          <span className={styles.statValue}>{formatEther(edition.currentPrice)} ETH</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>minted</span>
          <span className={styles.statValue}>{edition.minted.toString()}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>supply</span>
          <span className={styles.statValue}>{supplyLabel}</span>
        </div>
      </div>
      <MintPanel instance={instance} edition={edition} refetch={refetch} />
    </>
  )
}
