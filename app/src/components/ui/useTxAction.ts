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
 *
 * `instance` (noesis-352) — pass the collection instance a write acts on and every cached read
 * touching that address is invalidated the moment the receipt lands, on top of `onSuccess`. This is
 * the SHARED invalidation seam: a panel's own `onSuccess` only reaches that panel's own reads, but a
 * write on an instance can move state multiple panels read independently — a bonding buy/sell moves
 * coin balance AND NFT ids in the same transaction, for example. Without a shared invalidation, a
 * sibling panel keeps rendering a position that no longer exists on-chain until it happens to refetch
 * on its own. Pass `instance` on every write that mutates state a shared instance read observes;
 * omit it only for actions with nothing else to invalidate.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
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

/**
 * True when `address` (case-insensitively) appears anywhere in `queryKey` — as a bare string element
 * (the shape of our own hand-written keys, e.g. `['erc404-owned-pieces', instance, ...]`) or nested
 * inside an object/array (the shape of wagmi's generated read keys, e.g.
 * `['readContract', { address, args: [instance, holder], ... }]`). This is a structural match, not a
 * dependency on any one hook's key layout, so it keeps working as new reads are added for an
 * instance without each one needing to be told about invalidation by name.
 *
 * Recursion is bounded by a plain cycle guard (`seen`) — query keys are small, JSON-serializable-ish
 * data, never a real graph, so this is defensive rather than load-bearing.
 */
export function queryKeyIncludesAddress(
  queryKey: readonly unknown[],
  address: string,
  seen: Set<unknown> = new Set(),
): boolean {
  const target = address.toLowerCase()
  const matches = (value: unknown): boolean => {
    if (value == null) return false
    if (typeof value === 'string') return value.toLowerCase() === target
    if (Array.isArray(value)) return value.some(matches)
    if (typeof value === 'object') {
      if (seen.has(value)) return false
      seen.add(value)
      return Object.values(value).some(matches)
    }
    return false
  }
  return queryKey.some(matches)
}

/**
 * Invalidate every cached query touching `instance` — the shared-invalidation seam `useTxAction`
 * fires on transaction success (see `instance` in its opts, above). Exported so panels that manage
 * their own write hooks directly (not through `useTxAction`) can call it from their own success
 * handler and get the same coverage.
 */
export function invalidateInstanceQueries(queryClient: QueryClient, instance: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => queryKeyIncludesAddress(query.queryKey as QueryKey, instance),
  })
}

export function useTxAction(opts: { onSuccess?: () => void; instance?: `0x${string}` } = {}) {
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

  // Fire the shared invalidation + onSuccess exactly once per confirmed receipt (not on every render
  // while success is true).
  const { onSuccess, instance } = opts
  const queryClient = useQueryClient()
  const fired = useRef(false)
  useEffect(() => {
    if (success && !fired.current) {
      fired.current = true
      if (instance) invalidateInstanceQueries(queryClient, instance)
      onSuccess?.()
    }
    if (!success) fired.current = false
  }, [success, onSuccess, instance, queryClient])

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
