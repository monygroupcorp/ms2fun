/**
 * useTxAction — the write-transaction idiom in ONE place (Phase 0 foundation). Every contract action
 * across the app (mint, bid, withdraw, claim, admin setters, …) follows the same shape:
 * useWriteContract → useWaitForTransactionReceipt → idle/signing/confirming/success/error + reset,
 * firing an onSuccess (refetch) once when the receipt lands. This hook collapses ~40 lines per action
 * into a few, so a new action is config not code — and the status UX is consistent everywhere.
 *
 * Usage:
 *   const tx = useTxAction({ onSuccess: refetch })
 *   tx.send({ address, abi, functionName: 'withdraw', args: [amount], chainId: forkChainId })
 *   <TxButton state={tx.state} onClick={...} label="withdraw" onReset={tx.reset} />
 *
 * `send` is wagmi's `writeContract` returned verbatim, so the call site keeps full type inference
 * over abi/functionName/args (pass `chainId: forkChainId` as the existing readers do).
 */
import { useCallback, useEffect, useRef } from 'react'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

export type TxState = 'idle' | 'signing' | 'confirming' | 'success' | 'error'

/** Pure state derivation (tested) — checked signing → confirming → success → error → idle. */
export function deriveTxState(flags: {
  signing: boolean
  confirming: boolean
  success: boolean
  error: boolean
}): TxState {
  if (flags.signing) return 'signing'
  if (flags.confirming) return 'confirming'
  if (flags.success) return 'success'
  if (flags.error) return 'error'
  return 'idle'
}

export function useTxAction(opts: { onSuccess?: () => void } = {}) {
  const {
    writeContract,
    data: hash,
    isPending: signing,
    isError: writeError,
    reset: resetWrite,
  } = useWriteContract()
  const {
    isLoading: confirming,
    isSuccess: success,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash })

  const state = deriveTxState({ signing, confirming, success, error: writeError || waitError })

  // Fire onSuccess exactly once per confirmed receipt (not on every render while success is true).
  const { onSuccess } = opts
  const fired = useRef(false)
  useEffect(() => {
    if (success && !fired.current) {
      fired.current = true
      onSuccess?.()
    }
    if (!success) fired.current = false
  }, [success, onSuccess])

  const reset = useCallback(() => {
    fired.current = false
    resetWrite()
  }, [resetWrite])

  // `send` is wagmi's writeContract verbatim — returning it inferred (not via an explicit interface)
  // preserves its abi/functionName/chainId generics at the call site.
  return { send: writeContract, reset, state, isBusy: signing || confirming, hash }
}

/** The shape returned by {@link useTxAction} (derived from the impl to keep wagmi's generics intact). */
export type TxAction = ReturnType<typeof useTxAction>
