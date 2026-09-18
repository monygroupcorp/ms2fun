/**
 * `useLatestCurations` — the discovery read, and the one place the wall's ordering is applied.
 *
 * The contract pages by publication order; the wall orders by last worked on. This pins that the
 * hook actually performs the second, because the whole argument for the surface is that the only
 * way up it is to work on your curation.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockLatestRead = vi.hoisted(() => vi.fn())

vi.mock('../../generated/contracts', () => ({
  curationRegistryAbi: [],
  useReadCurationRegistryCanEdit: () => ({ data: undefined }),
  useReadCurationRegistryCurationIdsOf: () => ({ data: undefined }),
  useReadCurationRegistryGetCuration: () => ({ data: undefined }),
  useReadCurationRegistryGetCurations: () => ({ data: undefined }),
  useReadCurationRegistryLatestCurations: mockLatestRead,
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }))

// The committed deployment placeholder is all-zero, which is exactly the "no registry on this
// chain" case the hook short-circuits on. Give it a deployed one so the read path is the subject.
vi.mock('../../lib/addresses', () => ({
  forkAddresses: { CurationRegistry: '0x9999999999999999999999999999999999999999' },
  forkChainId: 1337,
}))

const CURATOR = '0x1111111111111111111111111111111111111111' as const
const record = (updatedAt: bigint) => ({
  curator: CURATOR,
  updatedAt,
  retired: false,
  uri: 'ipfs://QmSet',
})

afterEach(() => mockLatestRead.mockReset())

describe('useLatestCurations', () => {
  it('orders the page by last worked on, not by the order the chain paged it', async () => {
    // The chain hands back ids descending — 3 newest-published — but 2 was edited most recently.
    mockLatestRead.mockReturnValue({
      data: [
        [3n, 2n, 1n],
        [record(100n), record(900n), record(500n)],
      ],
      isPending: false,
      isError: false,
    })

    const { useLatestCurations } = await import('./useCurations')
    const { result } = renderHook(() => useLatestCurations(24))

    expect(result.current.data?.map((r) => r.id)).toEqual([2n, 1n, 3n])
  })

  it('keeps each id paired with its own record through the re-sort', async () => {
    mockLatestRead.mockReturnValue({
      data: [
        [3n, 2n],
        [record(100n), record(900n)],
      ],
      isPending: false,
      isError: false,
    })

    const { useLatestCurations } = await import('./useCurations')
    const { result } = renderHook(() => useLatestCurations(24))

    expect(result.current.data).toEqual([
      { id: 2n, curation: record(900n) },
      { id: 3n, curation: record(100n) },
    ])
  })

  it('passes an unresolved read straight through', async () => {
    mockLatestRead.mockReturnValue({ data: undefined, isPending: true, isError: false })

    const { useLatestCurations } = await import('./useCurations')
    const { result } = renderHook(() => useLatestCurations(24))

    expect(result.current.data).toBeUndefined()
    expect(result.current.isPending).toBe(true)
  })
})
