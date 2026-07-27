import { useState } from 'react'
import { parseEther } from 'viem'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc1155InstanceAbi } from '../../generated/contracts'
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

function emptyForm() {
  return {
    pieceTitle: '',
    basePrice: '',
    supply: '',
    metadataURI: '',
    pricingModel: 0 as 0 | 1 | 2,
    priceIncreaseRate: '',
    openTime: '0',
  }
}

type FormState = ReturnType<typeof emptyForm>

function validate(form: FormState): string | null {
  if (form.pieceTitle.trim() === '') return 'Piece title is required'
  const price = parseFloat(form.basePrice)
  if (!form.basePrice || isNaN(price) || price <= 0) return 'Base price must be greater than 0'
  if (form.pricingModel === 0) {
    const sup = form.supply.trim()
    if (sup !== '' && sup !== '0')
      return 'Unlimited pricing requires supply = 0 (leave blank or enter 0)'
  }
  if (form.pricingModel === 1 || form.pricingModel === 2) {
    const sup = parseInt(form.supply, 10)
    if (!form.supply || isNaN(sup) || sup <= 0) return 'Limited editions require supply > 0'
  }
  if (form.pricingModel === 2) {
    const rate = parseInt(form.priceIncreaseRate, 10)
    if (!form.priceIncreaseRate || isNaN(rate) || rate <= 0)
      return 'Dynamic pricing requires price increase rate > 0 basis points'
  }
  return null
}

export function AddEditionForm({ instance, onAdded }: AddEditionFormProps) {
  const chainId = useCollectionChainId()
  const [form, setForm] = useState<FormState>(emptyForm)
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
    setForm(emptyForm())
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

    const error = validate(form)
    if (error) {
      setClientError(error)
      return
    }

    const supply = form.pricingModel === 0 ? BigInt(0) : BigInt(form.supply)
    const rate = form.pricingModel === 2 ? BigInt(form.priceIncreaseRate) : BigInt(0)
    const openTime = BigInt(form.openTime.trim() || '0')

    resetWrite()
    setNotified(false)

    writeContract({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'addEdition',
      args: [
        form.pieceTitle.trim(),
        parseEther(form.basePrice),
        supply,
        form.metadataURI.trim(),
        form.pricingModel,
        rate,
        openTime,
      ],
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
