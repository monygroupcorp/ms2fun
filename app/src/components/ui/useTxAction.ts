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

/**
 * Human-readable reason from a wagmi/viem write or receipt error. viem's BaseError carries a concise
 * `shortMessage` (e.g. "Chain mismatch…", the decoded revert like `EditionNotFound()`, or "User
 * rejected"); we fall back to `details`/`message`. Returning this instead of swallowing the error is
 * the difference between a silent "try again" and an actionable failure the tester can act on.
 */
export function txErrorReason(error: unknown): string | undefined {
  if (error == null) return undefined
  const e = error as {
    shortMessage?: string
    details?: string
    message?: string
    metaMessages?: string[]
  }
  const base = (e.shortMessage || e.details || e.message)?.trim()
  // For a contract revert, viem's shortMessage is the generic "…reverted." and the DECODED custom
  // error (e.g. "Error: EditionNotFound()") lands in metaMessages — surface it so the reason is
  // actionable, not just "reverted".
  const decoded = e.metaMessages
    ?.find((m) => /error:|reverted|custom error/i.test(m))
    ?.replace(/^error:\s*/i, '')
    .trim()
  if (base && decoded && !base.includes(decoded)) return `${base} (${decoded})`
  return base || decoded || undefined
}

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
    error: writeErrObj,
    reset: resetWrite,
  } = useWriteContract()
  const {
    isLoading: confirming,
    isSuccess: success,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash })

  const state = deriveTxState({ signing, confirming, success, error: writeError || waitError })
  // Expose only the parsed string (not the raw viem error union — its type isn't portable across
  // the inferred return, and the string is all any caller needs to render).
  const reason = txErrorReason(writeErrObj ?? waitErrObj)

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
  return { send: writeContract, reset, state, isBusy: signing || confirming, hash, reason }
}

/** The shape returned by {@link useTxAction} (derived from the impl to keep wagmi's generics intact). */
export type TxAction = ReturnType<typeof useTxAction>
