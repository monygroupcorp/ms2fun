import { useEffect, useState } from 'react'
import { formatGwei } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import {
  EXEC404_ADDRESS,
  EXEC404_CHAIN_ID,
  exec404Abi,
  maxCostWithSlippage,
  minRefundWithSlippage,
  parseExecAmount,
} from '../lib/exec404'
import styles from './Exec404Trade.module.css'

const base = { address: EXEC404_ADDRESS, abi: exec404Abi, chainId: EXEC404_CHAIN_ID } as const

type Mode = 'buy' | 'sell'

/** viem errors expose a terse `shortMessage`; fall back to `message` for the rest of the union. */
function errorText(error: Error): string {
  return 'shortMessage' in error && typeof error.shortMessage === 'string'
    ? error.shortMessage
    : error.message
}

/**
 * Buy/sell EXEC on the bonding curve with a live quote and honest tx state.
 *
 * Tx-state convention (established here, reused everywhere): useWriteContract drives submit →
 * useWaitForTransactionReceipt drives confirmation; on confirmed success we invalidate the query
 * cache so every read (price, supply, balance) refetches. No optimistic UI — we show real
 * pending/confirming/success/error transitions only.
 */
export function Exec404Trade() {
  const { isConnected } = useAccount()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('buy')
  const [amount, setAmount] = useState('')

  const amountWei = parseExecAmount(amount)
  const hasAmount = amountWei !== null && amountWei > 0n

  // Live quote: cost (buy) or refund (sell) for the entered amount.
  const quote = useReadContract({
    ...base,
    functionName: mode === 'buy' ? 'calculateCost' : 'calculateRefund',
    args: hasAmount ? [amountWei] : undefined,
    query: { enabled: hasAmount },
  })

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    chainId: EXEC404_CHAIN_ID,
  })

  // On confirmed success, refetch all reads (price/supply/balance) and clear the form.
  useEffect(() => {
    if (isSuccess) {
      void queryClient.invalidateQueries()
      setAmount('')
    }
  }, [isSuccess, queryClient])

  function submit() {
    if (!hasAmount || quote.data === undefined) return
    if (mode === 'buy') {
      const maxCost = maxCostWithSlippage(quote.data)
      writeContract({
        ...base,
        functionName: 'buyBonding',
        args: [amountWei, maxCost, false, [], ''],
        value: maxCost,
      })
    } else {
      const minRefund = minRefundWithSlippage(quote.data)
      writeContract({ ...base, functionName: 'sellBonding', args: [amountWei, minRefund, [], ''] })
    }
  }

  const busy = isPending || isConfirming
  const status = isPending
    ? 'confirm in wallet…'
    : isConfirming
      ? 'confirming…'
      : isSuccess
        ? 'success ✓'
        : error
          ? errorText(error)
          : null

  function switchMode(next: Mode) {
    setMode(next)
    setAmount('')
    reset()
  }

  return (
    <section className={styles.trade} data-testid="exec404-trade">
      <div className={styles.tabs}>
        {(['buy', 'sell'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={m === mode ? styles.tabActive : styles.tab}
            onClick={() => switchMode(m)}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>amount · EXEC</span>
        <input
          className={styles.input}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="exec404-amount"
        />
      </label>

      <p className={styles.quote} data-testid="exec404-quote">
        {!hasAmount
          ? '—'
          : quote.isPending
            ? 'quoting…'
            : quote.isError
              ? 'quote failed'
              : quote.data !== undefined
                ? `${mode === 'buy' ? 'cost' : 'refund'} ≈ ${formatGwei(quote.data)} gwei (±1% slippage)`
                : '—'}
      </p>

      {!isConnected ? (
        <p className={styles.hint}>connect a wallet on the fork to trade</p>
      ) : (
        <button
          type="button"
          className={styles.submit}
          disabled={!hasAmount || quote.data === undefined || busy}
          onClick={submit}
          data-testid="exec404-submit"
        >
          {busy ? '…' : mode === 'buy' ? 'BUY EXEC' : 'SELL EXEC'}
        </button>
      )}

      {status && (
        <p className={styles.status} data-testid="exec404-status">
          {status}
        </p>
      )}
    </section>
  )
}
