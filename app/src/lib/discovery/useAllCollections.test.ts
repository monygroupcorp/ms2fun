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
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
    ...overrides,
  }
}

const raw: ProjectCard[] = [
  card({ instance: INSTANCE_A, vault: CHECKSUMMED, name: 'Aligned card' }),
  card({
    instance: INSTANCE_B,
    vault: '0x0000000000000000000000000000000000dEaD',
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
