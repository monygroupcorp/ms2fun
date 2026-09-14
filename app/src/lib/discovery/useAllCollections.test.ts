import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ProjectCard } from './types'

// ── vault filter, case-insensitivity (noesis-332) ───────────────────────────────────────────────
//
// `useAllCollectionsRaw` returns `c.vault` EIP-55 checksummed (from a live contract read). A caller
// may pass a lowercase address (e.g. `/vault/:address` from a route param, which is validated but
// not canonicalised). The filter must match regardless of casing on either side.

const CHECKSUMMED = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9' as const
const INSTANCE_A = '0x1111111111111111111111111111111111aAaA' as const
const INSTANCE_B = '0x2222222222222222222222222222222222bBbB' as const

function card(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    instance: INSTANCE_A,
    name: '',
    metadataURI: '',
    creator: INSTANCE_A,
    registeredAt: 0n,
    factory: INSTANCE_A,
    contractType: 'ERC721',
    factoryTitle: '',
    vault: INSTANCE_A,
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: true,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
    ...overrides,
  }
}

const CREATOR_A = '0xCd3B766CCDd6AE721141F452C550Ca635964ce71' as const
const CREATOR_B = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30' as const

const raw: ProjectCard[] = [
  card({ instance: INSTANCE_A, vault: CHECKSUMMED, creator: CREATOR_A, name: 'Aligned card' }),
  card({
    instance: INSTANCE_B,
    vault: '0x0000000000000000000000000000000000dEaD',
    creator: CREATOR_B,
    name: 'Unrelated card',
  }),
]

vi.mock('./useAllCollectionsRaw', () => ({
  useAllCollectionsRaw: () => ({ data: raw, isPending: false, isError: false }),
}))

const { useAllCollections } = await import('./useAllCollections')

describe('useAllCollections vault filter', () => {
  it('matches a checksummed vault filter', () => {
    const { result } = renderHook(() => useAllCollections({ vault: CHECKSUMMED }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })

  it('matches the same vault filter lowercased', () => {
    const { result } = renderHook(() =>
      useAllCollections({ vault: CHECKSUMMED.toLowerCase() as `0x${string}` }),
    )
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })
})

// ── search matches name OR creator (noesis-325 clause 2) ────────────────────────────────────────
//
// The box is labelled "Search collections, creators…". A pasted creator address must return that
// creator's collections, not an empty wall.

describe('useAllCollections search', () => {
  it('matches a name substring, case-insensitively', () => {
    const { result } = renderHook(() => useAllCollections({ search: 'aligned' }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })

  it('matches a full creator address', () => {
    const { result } = renderHook(() => useAllCollections({ search: CREATOR_A }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })

  it('matches a creator address pasted lowercased', () => {
    const { result } = renderHook(() => useAllCollections({ search: CREATOR_A.toLowerCase() }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })

  it('matches a creator address prefix', () => {
    const { result } = renderHook(() => useAllCollections({ search: CREATOR_B.slice(0, 12) }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Unrelated card'])
  })

  it('ignores surrounding whitespace on a pasted address', () => {
    const { result } = renderHook(() => useAllCollections({ search: `  ${CREATOR_A}  ` }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card'])
  })

  it('returns nothing for an address no card carries', () => {
    const { result } = renderHook(() =>
      useAllCollections({ search: '0x000000000000000000000000000000000000beef' }),
    )
    expect(result.current.data).toEqual([])
  })
})

// ── every sort the control offers is a real, distinct ordering (noesis-326 clause 4) ────────────
//
// The /collections TVL chip was removed because it silently aliased 'recent'. These pin that the
// two sorts left are each backed by a field on the card, and that they genuinely differ — a sort
// that quietly falls through to another would fail the last case here.

describe('useAllCollections sort', () => {
  it("orders 'recent' newest-registered first (discovery order reversed)", () => {
    const { result } = renderHook(() => useAllCollections({ sort: 'recent' }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Unrelated card', 'Aligned card'])
  })

  it("orders 'name' alphabetically", () => {
    const { result } = renderHook(() => useAllCollections({ sort: 'name' }))
    expect(result.current.data?.map((c) => c.name)).toEqual(['Aligned card', 'Unrelated card'])
  })

  it('gives a different order per sort, so no chip aliases another', () => {
    const recent = renderHook(() => useAllCollections({ sort: 'recent' }))
    const byName = renderHook(() => useAllCollections({ sort: 'name' }))
    expect(recent.result.current.data?.map((c) => c.name)).not.toEqual(
      byName.result.current.data?.map((c) => c.name),
    )
  })
})
