import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc1155InstanceAbi } from '../../generated/contracts'
import {
  editionDraftToAddEditionArgs,
  emptyEditionDraft,
  validateEditionDraft,
  type EditionDraft,
} from './erc1155/editionDraft'
import { useCollectionChainId } from './useCollectionChain'
import styles from './AddEditionForm.module.css'

export interface AddEditionFormProps {
  instance: `0x${string}`
  onAdded?: () => void
}

const PRICING_MODEL_LABELS: Record<number, string> = {
  0: 'Unlimited (fixed price)',
  1: 'Limited fixed',
  2: 'Limited dynamic',
}

type FormState = EditionDraft

export function AddEditionForm({ instance, onAdded }: AddEditionFormProps) {
  const chainId = useCollectionChainId()
  const [form, setForm] = useState<FormState>(emptyEditionDraft)
  const [clientError, setClientError] = useState<string | null>(null)

  const {
    writeContract,
    data: hash,
    isPending,
    isError: writeError,
    error: writeErrorObj,
    reset: resetWrite,
  } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
    error: waitErrorObj,
  } = useWaitForTransactionReceipt({ hash })

  // On success: clear form + notify caller once
  const [notified, setNotified] = useState(false)
  if (isSuccess && !notified) {
    setNotified(true)
    setForm(emptyEditionDraft())
    setClientError(null)
    onAdded?.()
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (clientError) setClientError(null)
  }

  function handlePricingModel(value: string) {
    const model = parseInt(value, 10) as 0 | 1 | 2
    setForm((prev) => ({
      ...prev,
      pricingModel: model,
      // Reset supply and rate when switching modes for cleaner UX
      supply: model === 0 ? '0' : prev.supply === '0' ? '' : prev.supply,
      priceIncreaseRate: model !== 2 ? '' : prev.priceIncreaseRate,
    }))
    if (clientError) setClientError(null)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const error = validateEditionDraft(form)
    if (error) {
      setClientError(error)
      return
    }

    resetWrite()
    setNotified(false)

    writeContract({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'addEdition',
      args: editionDraftToAddEditionArgs(form),
      chainId: chainId,
    })
  }

  const isBusy = isPending || isConfirming
  const txError = writeError ? writeErrorObj : waitError ? waitErrorObj : null

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-title">
          Piece title
        </label>
        <input
          id="aef-title"
          className={styles.input}
          type="text"
          value={form.pieceTitle}
          onChange={(e) => set('pieceTitle', e.target.value)}
          placeholder="e.g. Genesis Print #1"
          disabled={isBusy}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-pricing">
          Pricing model
        </label>
        <select
          id="aef-pricing"
          className={styles.select}
          value={form.pricingModel}
          onChange={(e) => handlePricingModel(e.target.value)}
          disabled={isBusy}
        >
          {([0, 1, 2] as const).map((m) => (
            <option key={m} value={m}>
              {PRICING_MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        <span className={styles.hint}>
          {form.pricingModel === 0 && 'Fixed price, unlimited supply. Supply is forced to 0.'}
          {form.pricingModel === 1 && 'Fixed price, capped supply.'}
          {form.pricingModel === 2 && 'Price increases by a basis-point rate on each mint.'}
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-price">
          Base price (ETH)
        </label>
        <input
          id="aef-price"
          className={styles.input}
          type="number"
          min="0"
          step="any"
          value={form.basePrice}
          onChange={(e) => set('basePrice', e.target.value)}
          placeholder="0.01"
          disabled={isBusy}
          required
        />
      </div>

      {form.pricingModel !== 0 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aef-supply">
            Supply
          </label>
          <input
            id="aef-supply"
            className={styles.input}
            type="number"
            min="1"
            step="1"
            value={form.supply}
            onChange={(e) => set('supply', e.target.value)}
            placeholder="e.g. 100"
            disabled={isBusy}
          />
        </div>
      )}

      {form.pricingModel === 2 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="aef-rate">
            Price increase rate (basis points)
          </label>
          <input
            id="aef-rate"
            className={styles.input}
            type="number"
            min="1"
            step="1"
            value={form.priceIncreaseRate}
            onChange={(e) => set('priceIncreaseRate', e.target.value)}
            placeholder="e.g. 100 (= 1% per mint)"
            disabled={isBusy}
          />
          <span className={styles.hint}>100 basis points = 1% price increase per mint</span>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-metadata">
          Metadata URI
        </label>
        <input
          id="aef-metadata"
          className={styles.input}
          type="text"
          value={form.metadataURI}
          onChange={(e) => set('metadataURI', e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:"
          disabled={isBusy}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-opentime">
          Open time (unix seconds; 0 = open immediately)
        </label>
        <input
          id="aef-opentime"
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={form.openTime}
          onChange={(e) => set('openTime', e.target.value)}
          placeholder="0"
          disabled={isBusy}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-closetime">
          Close time (unix seconds; 0 = never closes)
        </label>
        <input
          id="aef-closetime"
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={form.closeTime}
          onChange={(e) => set('closeTime', e.target.value)}
          placeholder="0"
          disabled={isBusy}
        />
        <span className={styles.hint}>
          When minting stops. Mints revert at this timestamp, so it is the first second the edition
          is over. Leave at 0 to run the edition open-ended. This and the per-wallet limit stay
          editable until the first mint and are fixed after it — a collector who has paid chose the
          drop as it was stated.
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-maxperwallet">
          Per-wallet limit (count; 0 = no limit)
        </label>
        <input
          id="aef-maxperwallet"
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={form.maxPerWallet}
          onChange={(e) => set('maxPerWallet', e.target.value)}
          placeholder="0"
          disabled={isBusy}
        />
        <span className={styles.hint}>
          The most tokens of this edition one wallet may mint, counted across paid mints and free
          claims together. Counted off what a wallet has minted, not what it still holds, so sending
          tokens away does not reopen the allowance.
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="aef-freemint">
          Free-mint allocation (count; 0 = none)
        </label>
        <input
          id="aef-freemint"
          className={styles.input}
          type="number"
          min="0"
          step="1"
          value={form.freeMintAllocation}
          onChange={(e) => set('freeMintAllocation', e.target.value)}
          placeholder="0"
          disabled={isBusy}
        />
        <span className={styles.hint}>
          Number of zero-cost mints allowed for this edition — a ceiling, capped at supply, not a
          reserve. Free claims and paid mints draw from the same supply on a first-come basis, so if
          paid buyers sell out the edition first, remaining free claims will revert. Each wallet may
          claim one free mint per edition. On a Limited dynamic edition, each free claim also
          advances the price curve for later paid buyers.
        </span>
      </div>

      {clientError !== null && (
        <div className={styles.errorBox} role="alert">
          {clientError}
        </div>
      )}

      {txError !== null && (
        <div className={styles.errorBox} role="alert">
          {txError.message.split('\n')[0]}
        </div>
      )}

      {isSuccess && (
        <div className={styles.successBox} role="status">
          Edition added successfully.
        </div>
      )}

      <div className={styles.actions}>
        <div className={styles.statusLine}>
          {isPending && <span className={styles.statusText}>Waiting for wallet…</span>}
          {isConfirming && <span className={styles.statusText}>Confirming transaction…</span>}
        </div>
        <button type="submit" className="btn btn-primary btn-chromatic" disabled={isBusy}>
          {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Add edition'}
        </button>
      </div>
    </form>
  )
}
