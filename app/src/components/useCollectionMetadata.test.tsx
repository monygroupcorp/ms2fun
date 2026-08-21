/**
 * useCollectionMetadata (noesis-371) — immutability governs the refetch, and only where it holds.
 *
 * A content-addressed pointer names its own bytes, so a cached value can never be stale and must not
 * be refetched at all. An `http(s)://` pointer is mutable and must keep revalidating on its finite
 * staleTime — the permanence must not leak across schemes.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useCollectionMetadata } from './useCollectionMetadata'

const CID = 'ipfs://QmCollectionMetadata'
const HTTP = 'https://example.test/metadata.json'
const SIX_MINUTES = 6 * 60_000

const fetchJsonMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/metadata')>()
  return { ...actual, fetchJson: fetchJsonMock }
})

// One client for the whole test: the claim is about a SESSION, so the cache must survive unmounts.
let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchJsonMock.mockReset()
  fetchJsonMock.mockResolvedValue({ name: 'a collection' })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
})

describe('useCollectionMetadata', () => {
  it('never refetches a content-addressed pointer within a session', async () => {
    for (let i = 0; i < 3; i++) {
      const view = renderHook(() => useCollectionMetadata(CID), { wrapper })
      await waitFor(() => expect(view.result.current).toMatchObject({ name: 'a collection' }))
      view.unmount()
      // Well past the window a mutable pointer would revalidate on.
      vi.setSystemTime(Date.now() + SIX_MINUTES)
    }

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
  })

  it('still refetches a mutable http(s) pointer once its staleTime has passed', async () => {
    const first = renderHook(() => useCollectionMetadata(HTTP), { wrapper })
    await waitFor(() => expect(first.result.current).toMatchObject({ name: 'a collection' }))
    first.unmount()
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + SIX_MINUTES)
    const second = renderHook(() => useCollectionMetadata(HTTP), { wrapper })
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalledTimes(2))
    second.unmount()
  })

  it('resolves a data: pointer without a network fetch', async () => {
    const dataUri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'inline' }))}`
    fetchJsonMock.mockImplementation(async (uri: string) =>
      uri.startsWith('data:') ? { name: 'inline' } : null,
    )

    const view = renderHook(() => useCollectionMetadata(dataUri), { wrapper })
    await waitFor(() => expect(view.result.current).toMatchObject({ name: 'inline' }))
    view.unmount()

    vi.setSystemTime(Date.now() + SIX_MINUTES)
    renderHook(() => useCollectionMetadata(dataUri), { wrapper })

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
  })
})
