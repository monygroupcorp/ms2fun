import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { deriveTxState, queryKeyIncludesAddress, txErrorReason, useTxAction } from './useTxAction'

const base = { signing: false, confirming: false, success: false, error: false }

describe('deriveTxState', () => {
  it('idle when nothing is happening', () => {
    expect(deriveTxState(base)).toBe('idle')
  })
  it('signing takes precedence (wallet prompt)', () => {
    expect(deriveTxState({ ...base, signing: true, confirming: true })).toBe('signing')
  })
  it('confirming while mining', () => {
    expect(deriveTxState({ ...base, confirming: true })).toBe('confirming')
  })
  it('success after the receipt lands', () => {
    expect(deriveTxState({ ...base, success: true })).toBe('success')
  })
  it('error when a write/wait failed', () => {
    expect(deriveTxState({ ...base, error: true })).toBe('error')
  })
  it('success beats error (a confirmed receipt is terminal-good)', () => {
    expect(deriveTxState({ ...base, success: true, error: true })).toBe('success')
  })
})

describe('txErrorReason', () => {
  it('returns undefined for no error', () => {
    expect(txErrorReason(null)).toBeUndefined()
    expect(txErrorReason(undefined)).toBeUndefined()
  })
  it('appends the decoded custom error from metaMessages to the base shortMessage', () => {
    // Shape of a viem ContractFunctionExecutionError on a custom-error revert.
    const err = {
      shortMessage: 'The contract function "mint" reverted.',
      metaMessages: ['Error: EditionNotFound()', 'Contract Call:', '  address: 0x…'],
    }
    expect(txErrorReason(err)).toBe('The contract function "mint" reverted. (EditionNotFound())')
  })
  it('falls back to shortMessage / details / message in order', () => {
    expect(txErrorReason({ shortMessage: 'Chain mismatch: expected 1337' })).toBe(
      'Chain mismatch: expected 1337',
    )
    expect(txErrorReason({ message: 'User rejected the request.' })).toBe(
      'User rejected the request.',
    )
  })
})

const INSTANCE = '0xaaaa000000000000000000000000000000aaaa'
const OTHER = '0xbbbb000000000000000000000000000000bbbb'

describe('queryKeyIncludesAddress', () => {
  it('matches a bare string element (the shape of our own hand-written query keys)', () => {
    expect(queryKeyIncludesAddress(['erc404-owned-pieces', INSTANCE, null, '5'], INSTANCE)).toBe(
      true,
    )
  })
  it('matches case-insensitively', () => {
    expect(queryKeyIncludesAddress(['erc404-owned-pieces', INSTANCE.toUpperCase()], INSTANCE)).toBe(
      true,
    )
  })
  it('matches an address nested in a wagmi-shaped options object (readContract keys)', () => {
    expect(
      queryKeyIncludesAddress(
        ['readContract', { address: INSTANCE, functionName: 'balanceOf', chainId: 1337 }],
        INSTANCE,
      ),
    ).toBe(true)
  })
  it('matches an address nested inside an args array (e.g. getStakingInfo(instance, holder), read from the staking MODULE address, not the instance)', () => {
    expect(
      queryKeyIncludesAddress(
        [
          'readContract',
          { address: OTHER, functionName: 'getStakingInfo', args: [INSTANCE, '0xh'] },
        ],
        INSTANCE,
      ),
    ).toBe(true)
  })
  it('does not match an unrelated address', () => {
    expect(
      queryKeyIncludesAddress(
        ['readContract', { address: OTHER, args: ['0xsomeoneelse'] }],
        INSTANCE,
      ),
    ).toBe(false)
  })
})

// ── shared invalidation guard (noesis-352) ──────────────────────────────────────────────────────
//
// The defect: every ERC-404 panel refetched only its OWN reads on transaction success, so a buy on
// the swap panel left the tier panel / portfolio grid rendering pre-trade state. The fix is a SHARED
// invalidation keyed on the instance address, reachable from `useTxAction`'s `instance` opt.
//
// This test proves the shared part: it writes through one `useTxAction` instance and asserts that a
// SIBLING cache entry — standing in for another panel's read of the same instance — was invalidated,
// while an entry for a DIFFERENT instance is left alone. A test that only asserted "my own query
// refetched" would still pass with the shared invalidation deleted; this one would not.

const txSuccess = vi.hoisted(() => ({ current: false }))
const mockWriteContract = vi.hoisted(() => vi.fn())

vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    writeContract: mockWriteContract,
    data: txSuccess.current ? ('0xhash' as const) : undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: txSuccess.current,
    isError: false,
    error: null,
  }),
}))

function withQueryClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useTxAction shared invalidation (guard)', () => {
  it('invalidates a SIBLING query for the same instance once the receipt lands', () => {
    txSuccess.current = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    // Stand-in for another panel's already-resolved read of this instance (a wagmi-shaped key, as
    // `Erc404AdminPanel`'s reads use, and a hand-written key, as `useErc404OwnedPieces` uses).
    const siblingWagmiKey = ['readContract', { address: INSTANCE, functionName: 'balanceOf' }]
    const siblingOwnedPiecesKey = ['erc404-owned-pieces', INSTANCE, '0xmirror', '0xholder', '10']
    client.setQueryData(siblingWagmiKey, 1n)
    client.setQueryData(siblingOwnedPiecesKey, [])
    expect(client.getQueryState(siblingWagmiKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(siblingOwnedPiecesKey)?.isInvalidated).toBe(false)

    const { rerender } = renderHook(() => useTxAction({ instance: INSTANCE }), {
      wrapper: withQueryClient(client),
    })

    txSuccess.current = true
    rerender()

    expect(client.getQueryState(siblingWagmiKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(siblingOwnedPiecesKey)?.isInvalidated).toBe(true)
  })

  it('leaves a query for a DIFFERENT instance untouched', () => {
    txSuccess.current = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const otherInstanceKey = ['readContract', { address: OTHER, functionName: 'balanceOf' }]
    client.setQueryData(otherInstanceKey, 1n)

    const { rerender } = renderHook(() => useTxAction({ instance: INSTANCE }), {
      wrapper: withQueryClient(client),
    })

    txSuccess.current = true
    rerender()

    expect(client.getQueryState(otherInstanceKey)?.isInvalidated).toBe(false)
  })

  it('does nothing extra when no `instance` is given (every other caller, unaffected)', () => {
    txSuccess.current = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const someKey = ['readContract', { address: INSTANCE, functionName: 'balanceOf' }]
    client.setQueryData(someKey, 1n)

    const onSuccess = vi.fn()
    const { rerender } = renderHook(() => useTxAction({ onSuccess }), {
      wrapper: withQueryClient(client),
    })

    txSuccess.current = true
    rerender()

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(someKey)?.isInvalidated).toBe(false)
  })
})
