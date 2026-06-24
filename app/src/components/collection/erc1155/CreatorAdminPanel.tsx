/**
 * CreatorAdminPanel — creator-only management actions for an ERC1155 instance: withdraw proceeds,
 * claim accrued vault fees, and update a single edition's metadata URI. Only rendered by the
 * parent when the connected wallet is the creator/owner (guarded there and re-asserted here via
 * the on-chain `owner()` read).
 *
 * Withdrawable context = totalProceeds() - totalWithdrawn(). `withdraw(amount)` takes an explicit
 * amount; we default the form to the full withdrawable balance. Write idiom mirrors EditionList.
 */
import { useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc1155InstanceOwner,
  useReadErc1155InstanceTotalProceeds,
  useReadErc1155InstanceTotalWithdrawn,
  useWriteErc1155InstanceClaimVaultFees,
  useWriteErc1155InstanceUpdateEditionMetadata,
  useWriteErc1155InstanceWithdraw,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { useEditions, type EditionView } from '../useEditions'
import styles from './Erc1155Actions.module.css'

interface CreatorAdminPanelProps {
  instance: `0x${string}`
}

export function CreatorAdminPanel({ instance }: CreatorAdminPanelProps) {
  const { address } = useAccount()
  const { data: editions } = useEditions(instance)

  const { data: owner } = useReadErc1155InstanceOwner({ address: instance, chainId: forkChainId })
  // Re-assert ownership on-chain (parent already gates on the registry creator).
  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase()

  if (!isOwner) return null

  return (
    <div className={styles.adminSection} data-testid="erc1155-admin">
      <p className={styles.label}>CREATOR ACTIONS</p>
      <WithdrawPanel instance={instance} />
      <ClaimFeesPanel instance={instance} />
      <UpdateMetadataPanel instance={instance} editions={editions} />
    </div>
  )
}

// ── Withdraw ─────────────────────────────────────────────────────────────────

function WithdrawPanel({ instance }: { instance: `0x${string}` }) {
  const { data: totalProceeds, refetch: refetchProceeds } = useReadErc1155InstanceTotalProceeds({
    address: instance,
    chainId: forkChainId,
  })
  const { data: totalWithdrawn, refetch: refetchWithdrawn } = useReadErc1155InstanceTotalWithdrawn({
    address: instance,
    chainId: forkChainId,
  })

  const withdrawable =
    totalProceeds !== undefined && totalWithdrawn !== undefined
      ? totalProceeds - totalWithdrawn
      : undefined

  const [amount, setAmount] = useState('')

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteErc1155InstanceWithdraw()
  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const isBusy = sigPending || isConfirming

  function handleWithdraw(): void {
    // Default to the full withdrawable balance when the field is left blank.
    const raw = amount.trim()
    const value = raw === '' ? (withdrawable ?? 0n) : parseEther(raw)
    if (value <= 0n) return
    writeContract({ address: instance, chainId: forkChainId, args: [value] })
  }

  function handleReset(): void {
    resetWrite()
    setAmount('')
    void refetchProceeds()
    void refetchWithdrawn()
  }

  return (
    <div className={styles.action}>
      <div className={styles.actionHead}>
        <span className={styles.actionTitle}>withdraw proceeds</span>
        <span className={styles.actionMeta}>
          withdrawable: {withdrawable !== undefined ? `${formatEther(withdrawable)} ETH` : '…'}
          {totalWithdrawn !== undefined && ` · withdrawn: ${formatEther(totalWithdrawn)} ETH`}
        </span>
      </div>
      {isSuccess ? (
        <div className={styles.row}>
          <p className={styles.txStatus}>withdrawn — tx confirmed.</p>
          <button className="btn btn-secondary" onClick={handleReset}>
            reset
          </button>
        </div>
      ) : (
        <div className={styles.row}>
          <input
            className={styles.input}
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={withdrawable !== undefined ? formatEther(withdrawable) : 'amount (ETH)'}
            disabled={isBusy}
            aria-label="withdraw amount in ETH"
          />
          <button
            className="btn btn-primary"
            onClick={handleWithdraw}
            disabled={isBusy || withdrawable === undefined || withdrawable <= 0n}
            data-testid="erc1155-withdraw"
          >
            {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'withdraw'}
          </button>
        </div>
      )}
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>withdraw failed — try again</p>
      )}
    </div>
  )
}

// ── Claim vault fees ─────────────────────────────────────────────────────────

function ClaimFeesPanel({ instance }: { instance: `0x${string}` }) {
  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteErc1155InstanceClaimVaultFees()
  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const isBusy = sigPending || isConfirming

  function handleClaim(): void {
    writeContract({ address: instance, chainId: forkChainId })
  }

  return (
    <div className={styles.action}>
      <div className={styles.actionHead}>
        <span className={styles.actionTitle}>claim vault fees</span>
        <span className={styles.actionMeta}>
          sweep accrued alignment-vault yield to the creator
        </span>
      </div>
      {isSuccess ? (
        <div className={styles.row}>
          <p className={styles.txStatus}>fees claimed — tx confirmed.</p>
          <button className="btn btn-secondary" onClick={resetWrite}>
            reset
          </button>
        </div>
      ) : (
        <div className={styles.row}>
          <button
            className="btn btn-secondary"
            onClick={handleClaim}
            disabled={isBusy}
            data-testid="erc1155-claim-fees"
          >
            {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'claim fees'}
          </button>
        </div>
      )}
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>claim failed — try again</p>
      )}
    </div>
  )
}

// ── Update edition metadata ──────────────────────────────────────────────────

function UpdateMetadataPanel({
  instance,
  editions,
}: {
  instance: `0x${string}`
  editions: readonly EditionView[]
}) {
  // Track an explicit selection; fall back to the first edition so the panel is usable even
  // when editions finish loading after mount (the useState initializer only runs once).
  const [selectedId, setSelectedId] = useState<string>('')
  const firstEdition = editions[0]
  const editionId =
    selectedId !== '' ? selectedId : firstEdition !== undefined ? firstEdition.id.toString() : ''
  const [uri, setUri] = useState('')

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteErc1155InstanceUpdateEditionMetadata()
  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const isBusy = sigPending || isConfirming
  const canSubmit = editionId.trim() !== '' && uri.trim() !== '' && !isBusy

  function handleUpdate(): void {
    if (!canSubmit) return
    writeContract({
      address: instance,
      chainId: forkChainId,
      args: [BigInt(editionId), uri.trim()],
    })
  }

  function handleReset(): void {
    resetWrite()
    setUri('')
  }

  if (editions.length === 0) return null

  return (
    <div className={styles.action}>
      <div className={styles.actionHead}>
        <span className={styles.actionTitle}>update edition metadata</span>
        <span className={styles.actionMeta}>replace a single edition&apos;s metadata URI</span>
      </div>
      {isSuccess ? (
        <div className={styles.row}>
          <p className={styles.txStatus}>metadata updated — tx confirmed.</p>
          <button className="btn btn-secondary" onClick={handleReset}>
            reset
          </button>
        </div>
      ) : (
        <div className={styles.metadataForm}>
          <select
            className={styles.input}
            value={editionId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={isBusy}
            aria-label="edition to update"
          >
            {editions.map((ed) => (
              <option key={ed.id.toString()} value={ed.id.toString()}>
                {ed.pieceTitle || `edition #${ed.id}`}
              </option>
            ))}
          </select>
          <input
            className={styles.input}
            type="text"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="ipfs://, ar://, https://, or data:"
            disabled={isBusy}
            aria-label="new metadata URI"
          />
          <button
            className="btn btn-primary"
            onClick={handleUpdate}
            disabled={!canSubmit}
            data-testid="erc1155-edit-metadata"
          >
            {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'update metadata'}
          </button>
        </div>
      )}
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>update failed — try again</p>
      )}
    </div>
  )
}
