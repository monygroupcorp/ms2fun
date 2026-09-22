/**
 * EditionScheduleForm — correct an edition's close time and per-wallet ceiling before it has sold.
 *
 * `ERC1155Instance.setEditionSchedule` is bounded to `minted == 0` on purpose: a collector who has
 * paid chose a drop with a stated end and a stated ceiling, and moving either afterwards changes the
 * deal under them. So this exists for the case it is for — a creator who typed the wrong timestamp
 * and has not sold yet — and it says why it is unavailable rather than failing at the wallet.
 */
import { useState } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc1155InstanceEditionCloseTime,
  useReadErc1155InstanceEditionMaxPerWallet,
  useReadErc1155InstanceGetEdition,
  useWriteErc1155InstanceSetEditionSchedule,
} from '../../generated/contracts'
import { useCollectionChainId } from './useCollectionChain'
import { txErrorReason } from '../ui/useTxAction'
import styles from './AddEditionForm.module.css'

export interface EditionScheduleFormProps {
  instance: `0x${string}`
  editionId: bigint
  onChanged?: () => void
}

export function EditionScheduleForm({ instance, editionId, onChanged }: EditionScheduleFormProps) {
  const chainId = useCollectionChainId()
  const [closeTime, setCloseTime] = useState('')
  const [maxPerWallet, setMaxPerWallet] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const { data: edition } = useReadErc1155InstanceGetEdition({
    address: instance,
    chainId: chainId,
    args: [editionId],
  })
  const { data: currentCloseTime } = useReadErc1155InstanceEditionCloseTime({
    address: instance,
    chainId: chainId,
    args: [editionId],
  })
  const { data: currentMaxPerWallet } = useReadErc1155InstanceEditionMaxPerWallet({
    address: instance,
    chainId: chainId,
    args: [editionId],
  })

  const {
    writeContract,
    data: hash,
    isPending,
    isError: writeError,
    error: writeErrorObj,
    reset: resetWrite,
  } = useWriteErc1155InstanceSetEditionSchedule()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // Seed the inputs from the chain once, so the form opens showing what the edition carries rather
  // than two empty boxes that would read as "no schedule".
  if (!loaded && currentCloseTime !== undefined && currentMaxPerWallet !== undefined) {
    setLoaded(true)
    setCloseTime(currentCloseTime.toString())
    setMaxPerWallet(currentMaxPerWallet.toString())
  }

  if (isSuccess && onChanged) onChanged()

  // `minted` counts the paid and free paths together — the same figure the contract's own bound
  // reads — so a single free claim closes this form exactly as a sale does.
  const sold = edition !== undefined && edition.minted > 0n
  const isBusy = isPending || isConfirming

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const close = Number(closeTime.trim() || '0')
    const cap = Number(maxPerWallet.trim() || '0')
    if (!Number.isInteger(close) || close < 0) {
      setClientError('Close time must be a whole number of seconds')
      return
    }
    if (!Number.isInteger(cap) || cap < 0) {
      setClientError('Per-wallet limit must be a whole number ≥ 0')
      return
    }
    // Mirrors `_validateSchedule`: a close time must fall after the edition opens, and `openTime`
    // of 0 means the edition is already open, so the comparison is against now.
    if (close !== 0) {
      const openTime = edition !== undefined ? Number(edition.openTime) : 0
      const opensAt = openTime === 0 ? Math.floor(Date.now() / 1000) : openTime
      if (close <= opensAt) {
        setClientError(
          openTime === 0
            ? 'Close time must be in the future'
            : 'Close time must be after the open time',
        )
        return
      }
    }
    setClientError(null)
    resetWrite()
    writeContract({
      address: instance,
      chainId: chainId,
      args: [editionId, BigInt(close), BigInt(cap)],
    })
  }

  if (sold) {
    return (
      <p className={styles.hint} data-testid="edition-schedule-locked">
        edition #{editionId.toString()} has sold — its close time and per-wallet limit are fixed
        now.
      </p>
    )
  }

  const failure = writeError ? txErrorReason(writeErrorObj) : null

  return (
    <form className={styles.form} onSubmit={handleSubmit} data-testid="edition-schedule-form">
      <p className={styles.hint}>
        Edition #{editionId.toString()} — editable until the first mint.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`esf-close-${editionId}`}>
          Close time (unix seconds; 0 = never closes)
        </label>
        <input
          id={`esf-close-${editionId}`}
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={closeTime}
          onChange={(e) => setCloseTime(e.target.value)}
          disabled={isBusy}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`esf-cap-${editionId}`}>
          Per-wallet limit (count; 0 = no limit)
        </label>
        <input
          id={`esf-cap-${editionId}`}
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={maxPerWallet}
          onChange={(e) => setMaxPerWallet(e.target.value)}
          disabled={isBusy}
        />
      </div>

      {clientError !== null && <p className={styles.hint}>{clientError}</p>}
      {failure !== null && <p className={styles.hint}>{failure}</p>}
      {isSuccess && <p className={styles.hint}>schedule updated — tx confirmed.</p>}

      <button className="btn btn-secondary" type="submit" disabled={isBusy}>
        {isPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'update schedule'}
      </button>
    </form>
  )
}
