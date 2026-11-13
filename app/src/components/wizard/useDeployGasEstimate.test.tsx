/**
 * The live estimate reads through the connected wallet's own RPC (`decentralizedTransport`'s wallet
 * hop) — the same node that has to answer the deploy send a moment later. These pin that a run of
 * edits (retyping a description, swapping a cover image) settles into ONE further
 * `estimateContractGas` call, not one per keystroke, the same discipline `useNameAvailability`
 * already applies to the name check. The very first call (entering the Review step) is immediate —
 * only a CHANGE afterward waits out the debounce.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CreateCall } from '../../lib/wizard/submit'

const mockEstimateContractGas = vi.hoisted(() => vi.fn(() => Promise.resolve(1_000_000n)))

vi.mock('wagmi', () => ({
  usePublicClient: () => ({ estimateContractGas: mockEstimateContractGas }),
}))

const { useDeployGasEstimate, DEBOUNCE_MS } = await import('./useDeployGasEstimate')

const ACCOUNT = '0xaaaa000000000000000000000000000000aaaa' as const

const callWithName = (name: string): CreateCall =>
  ({
    type: 'erc1155',
    factory: 'ERC1155Factory',
    args: [name] as never,
    value: 0n,
  }) as CreateCall

function withQueryClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/**
 * The settle (a `setState` inside a fake timer) and the query it then enables each need their own
 * turn of the microtask queue; a single `advanceTimersByTimeAsync` call doesn't reliably chase a
 * state update into the render + fetch it triggers. Ticking forward in small steps does.
 */
async function flush(ms: number, step = 50) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await vi.advanceTimersByTimeAsync(step)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  mockEstimateContractGas.mockClear()
})
afterEach(() => {
  // A test's component (and any debounce timer still pending on it) must not survive into the
  // next test — a leftover mounted instance's timer firing during another test's fake-timer
  // advance double-counts calls that belong to neither test.
  cleanup()
  vi.useRealTimers()
})

describe('useDeployGasEstimate debounces the live re-estimate', () => {
  it('five rapid edits inside the debounce window fire exactly one further RPC call', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = renderHook(({ call }) => useDeployGasEstimate(call, ACCOUNT), {
      wrapper: withQueryClient(client),
      initialProps: { call: callWithName('a') },
    })

    // Entering the review step already has a call — that first estimate fires immediately.
    await vi.advanceTimersByTimeAsync(0)
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(1)

    for (const name of ['ab', 'abc', 'abcd', 'abcde']) {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 50)
      rerender({ call: callWithName(name) })
    }
    // Every edit landed inside the window of the one before it — still just the initial call.
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(1)

    // Past the debounce window, settle fires, then the query itself resolves — two ticks of work,
    // so give it a generous flush rather than one exact-boundary advance.
    await flush(DEBOUNCE_MS * 2)
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(2)
    expect(mockEstimateContractGas).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: ['abcde'] }),
    )
  })

  it('an edit followed by a pause re-estimates once more for the settled value', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = renderHook(({ call }) => useDeployGasEstimate(call, ACCOUNT), {
      wrapper: withQueryClient(client),
      initialProps: { call: callWithName('a') },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(1)

    rerender({ call: callWithName('b') })
    await flush(DEBOUNCE_MS * 2)
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(2)
  })
})
