import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ProjectCard } from '../../lib/discovery/types'

/**
 * noesis-327, acceptance 4 — the ordering assertion has to run through the REAL `useAllCollections`.
 *
 * `usePortfolio.test.ts` builds its own `cards` array and feeds it straight to
 * `derivePortfolioInputs`, so it can prove the cap but never WHICH collections the cap kept. The
 * answer only appears once the real sort is in the composition: `useAllCollections` defaults to
 * 'recent', which reverses discovery order, so the old `.slice(0, 50)` took the 50 NEWEST — and the
 * oldest collection, the one most likely to hold a long-standing position, was the first evicted.
 */

const COUNT = 60

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

function card(i: number): ProjectCard {
  return {
    instance: addr(i),
    name: `collection-${i}`,
    metadataURI: '',
    creator: addr(9000),
    registeredAt: BigInt(i),
    factory: addr(9001),
    contractType: 'ERC721',
    factoryTitle: '',
    vault: addr(1000 + i),
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: true,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
  }
}

/** Discovery (chronological) order, as `useAllCollectionsRaw` returns it: oldest first. */
const raw: ProjectCard[] = Array.from({ length: COUNT }, (_, i) => card(i + 1))

vi.mock('../../lib/discovery/useAllCollectionsRaw', () => ({
  useAllCollectionsRaw: () => ({ data: raw, isPending: false, isError: false }),
  allCollectionsQueryKey: ['all-collections'],
}))

const { useAllCollections } = await import('../../lib/discovery/useAllCollections')
const { derivePortfolioInputs, MAX_QUERY_LIMIT } = await import('./usePortfolio')

describe('portfolio coverage over the real collection index', () => {
  it('the index really is newest-first, so a prefix slice would drop the oldest', () => {
    const { result } = renderHook(() => useAllCollections())
    const names = result.current.data?.map((c) => c.name) ?? []
    expect(names[0]).toBe(`collection-${COUNT}`)
    expect(names[names.length - 1]).toBe('collection-1')
    // The exact shape of the old bug: collection-1 sits outside the first MAX_QUERY_LIMIT.
    expect(names.slice(0, MAX_QUERY_LIMIT)).not.toContain('collection-1')
  })

  it('asks the aggregator about every collection, oldest included', () => {
    const { result } = renderHook(() => useAllCollections())
    const { instances, vaultAddrs, truncated } = derivePortfolioInputs(result.current.data ?? [])

    expect(instances).toHaveLength(COUNT)
    expect(instances).toContain(addr(1)) // the oldest — silently unqueried before noesis-327
    expect(vaultAddrs).toHaveLength(COUNT)
    expect(truncated).toBe(false)
  })
})
