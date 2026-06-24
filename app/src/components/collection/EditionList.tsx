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
  useReadErc1155InstanceGatingModule,
  useReadErc1155InstanceGatingScope,
  useWriteErc1155InstanceMint,
} from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
import {
  encodeMintMessage,
  isPaidMintGated,
  passwordToBytes32,
  ZERO_BYTES32,
} from './erc1155/gatingMint'
import { FreeMintClaimPanel } from './erc1155/FreeMintClaimPanel'
import { useEditions, type EditionView } from './useEditions'
import styles from './EditionList.module.css'

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
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const { data: costData, isPending: costPending } = useReadErc1155InstanceCalculateMintCost({
    address: instance,
    chainId: forkChainId,
    args: [edition.id, BigInt(amount)],
    query: { enabled: amount > 0 },
  })

  // Gating config for the paid mint path. When a module is set and scope isn't FREE_MINT_ONLY,
  // `mint` consults the module — we then resolve the user's password credential into bytes32
  // (see erc1155/gatingMint.ts for the approach + the merkle seam). Otherwise gatingData = zero.
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: forkChainId,
  })
  const { data: gatingScope } = useReadErc1155InstanceGatingScope({
    address: instance,
    chainId: forkChainId,
  })
  const gated = isPaidMintGated(gatingModule, gatingScope)

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
    // Real gatingData when the paid path is gated (keccak256(password) as bytes32), else zero.
    const gatingData = gated ? passwordToBytes32(password) : ZERO_BYTES32
    // Optional attached message, ABI-encoded to the registry's 5-field convention (else '0x').
    const messageData = encodeMintMessage(message)
    writeContract({
      address: instance,
      chainId: forkChainId,
      args: [edition.id, BigInt(amount), gatingData, messageData, costData],
      value: costData,
    })
  }

  function handleSuccess(): void {
    resetWrite()
    setAmount(1)
    setPassword('')
    setMessage('')
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
          className="btn btn-primary btn-chromatic"
          onClick={handleMint}
          disabled={isBusy || costData === undefined}
        >
          {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'mint'}
        </button>
      </div>
      {gated && (
        <input
          className={styles.mintInput}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="access password (gated sale)"
          disabled={isBusy}
          aria-label="mint access password"
          data-testid="erc1155-mint-password"
        />
      )}
      <textarea
        className={styles.mintMessage}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="attach a message (optional)"
        rows={2}
        disabled={isBusy}
        aria-label="optional mint message"
        data-testid="erc1155-mint-message"
      />
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

  const firstEdition = data[0]
  if (firstEdition === undefined) {
    return (
      <p className={styles.note} data-testid="editions-empty">
        no editions yet
      </p>
    )
  }

  return (
    <div className={styles.editions}>
      {/* Free-mint claim is per-instance (allocation is a single tranche); target the first
          edition. The panel renders nothing unless the connected wallet is eligible. */}
      <FreeMintClaimPanel instance={instance} editionId={firstEdition.id} />
      <ul className={styles.list} data-testid="editions">
        {data.map((edition) => (
          <li key={edition.id.toString()} className={styles.card}>
            <EditionCard edition={edition} instance={instance} refetch={refetch} />
          </li>
        ))}
      </ul>
    </div>
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
