/**
 * BoardPage — `useGlobalFeed` cache-key isolation regression (noesis-422).
 *
 * Home's activity preview and the board's infinite feed used to share one cache key
 * (`['message-feed', 'global']`) with incompatible shapes: home cached a plain `FeedMessage[]`,
 * the board's `useInfiniteQuery` expects `{ pages, pageParams }`. Whichever query populated the
 * cache first poisoned the other's read — a warm home visit followed by a board mount threw
 * inside tanstack's `getNextPageParam` (`Cannot read properties of undefined (reading 'length')`).
 *
 * This seeds a query client with the home-shaped entry under home's own key and mounts the
 * board's feed hook, asserting it never throws. Before the key split this would have used the
 * same literal key the board reads and reproduced the crash; the fix keeps the two keys distinct
 * so the board never sees home's cache shape.
 */
import { cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useGlobalFeed } from './BoardPage'
import { homeActivityQueryKey } from '../components/home/useGlobalActivity'
import type { FeedMessage } from '../components/useMessageFeed'

vi.mock('wagmi', () => ({
  usePublicClient: () => undefined,
  useAccount: () => ({ address: undefined }),
}))

vi.mock('../generated/contracts', () => ({
  globalMessageRegistryAbi: [],
  useReadQueryAggregatorGetHomePageData: () => ({ data: undefined }),
}))

afterEach(() => {
  cleanup()
})

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const HOME_SHAPED_ENTRY: FeedMessage[] = [
  {
    messageId: 1n,
    instance: '0x0000000000000000000000000000000000000001',
    sender: '0x0000000000000000000000000000000000000002',
    messageType: 0,
    refId: 0n,
    value: 0n,
    content: 'hi',
  },
]

describe('useGlobalFeed / home cache-key isolation', () => {
  it('does not throw when a home-shaped entry is cached under home’s own key', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // The scenario that used to crash: a warm home visit leaves a plain-array entry in the
    // cache before the board ever mounts.
    client.setQueryData(homeActivityQueryKey, HOME_SHAPED_ENTRY)

    const { result } = renderHook(() => useGlobalFeed(), { wrapper: wrapper(client) })

    expect(result.current.hasNextPage).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})
