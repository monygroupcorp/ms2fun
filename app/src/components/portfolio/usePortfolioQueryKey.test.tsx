/**
 * usePortfolio — query key regression (noesis-337).
 *
 * The aggregator query must key on the CONTENTS of the instance/vault sets, not their lengths.
 * A same-length swap (all-new addresses, same count) has to be indistinguishable from a no-op to
 * a length-keyed cache, so it is the one case a passing-but-shallow test can't see — this renders
 * the real hook against a real `QueryClient` and swaps the collection set between renders.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { usePortfolio } from './usePortfolio'

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`
const USER = addr(0xff)

const card = (instance: `0x${string}`) => ({ instance, vault: addr(0) })

const mockUseAllCollections = vi.hoisted(() => vi.fn())
vi.mock('../../lib/discovery', () => ({
  useAllCollections: mockUseAllCollections,
}))

const mockReadContract = vi.hoisted(() => vi.fn())
vi.mock('wagmi', () => ({
  usePublicClient: () => ({ readContract: mockReadContract }),
}))

afterEach(() => {
  cleanup()
  mockUseAllCollections.mockReset()
  mockReadContract.mockReset()
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const EMPTY_PORTFOLIO = [[], [], [], 0n, []] as const

describe('usePortfolio query key', () => {
  it('refetches when a same-length instance set is wholly replaced', async () => {
    mockReadContract.mockResolvedValue(EMPTY_PORTFOLIO)
    mockUseAllCollections.mockReturnValue({
      data: [card(addr(1)), card(addr(2))],
      isPending: false,
      isError: false,
    })

    const { rerender } = renderHook(() => usePortfolio(USER), { wrapper })

    await waitFor(() => expect(mockReadContract).toHaveBeenCalledTimes(1))

    // Same length (2), entirely different addresses — the reachable re-seed shape (F-Z1).
    mockUseAllCollections.mockReturnValue({
      data: [card(addr(3)), card(addr(4))],
      isPending: false,
      isError: false,
    })
    rerender()

    await waitFor(() => expect(mockReadContract).toHaveBeenCalledTimes(2))
    const secondArgs = mockReadContract.mock.calls[1]?.[0] as { args: unknown[] } | undefined
    expect(secondArgs?.args[1]).toEqual([addr(3), addr(4)])
  })

  it('still refetches when the set length changes (no regression on the working leg)', async () => {
    mockReadContract.mockResolvedValue(EMPTY_PORTFOLIO)
    mockUseAllCollections.mockReturnValue({
      data: [card(addr(1)), card(addr(2))],
      isPending: false,
      isError: false,
    })

    const { rerender } = renderHook(() => usePortfolio(USER), { wrapper })

    await waitFor(() => expect(mockReadContract).toHaveBeenCalledTimes(1))

    mockUseAllCollections.mockReturnValue({
      data: [card(addr(1)), card(addr(2)), card(addr(5))],
      isPending: false,
      isError: false,
    })
    rerender()

    await waitFor(() => expect(mockReadContract).toHaveBeenCalledTimes(2))
  })
})
