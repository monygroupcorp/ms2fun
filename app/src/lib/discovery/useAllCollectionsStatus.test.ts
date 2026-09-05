import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { cardStatus } from '../cardStatus'
import type { ProjectCard } from './types'

// ── /collections status buckets agree with the chip ─────────────────────────────────────────────
//
// The failure this pins is a filter and a card disagreeing about the same collection: the buckets
// were `active` / `ended` over a single boolean, so a drop scheduled for next week — which the card
// now labels Soon — was swept into "Ended" and read as something that had already happened. Each
// bucket is asserted to be exactly the set of cards whose chip carries that bucket's name (and
// `ended` exactly the set with no chip), so the two cannot drift apart again.

const A = '0x1111111111111111111111111111111111aAaA' as const

function card(name: string, overrides: Partial<ProjectCard>): ProjectCard {
  return {
    instance: `0x${name.charCodeAt(0).toString(16).padStart(40, '0')}` as `0x${string}`,
    name,
    metadataURI: '',
    creator: A,
    registeredAt: 0n,
    factory: A,
    contractType: 'ERC404',
    factoryTitle: '',
    vault: A,
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: false,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
    ...overrides,
  }
}

const OPEN_LATER = 1_900_000_000n

const raw: ProjectCard[] = [
  card('live curve', { isActive: true }),
  card('scheduled curve', { opensAt: OPEN_LATER }),
  card('exhausted curve', {}),
  card('live editions', { contractType: 'ERC1155', isActive: true }),
  card('scheduled editions', { contractType: 'ERC1155', opensAt: OPEN_LATER }),
  card('finished editions', { contractType: 'ERC1155' }),
  // Live now with another edition dated later: it belongs in Live, the bucket its chip names.
  card('live editions with a sequel', {
    contractType: 'ERC1155',
    isActive: true,
    opensAt: OPEN_LATER,
  }),
  card('settled auction', { contractType: 'ERC721' }),
]

vi.mock('./useAllCollectionsRaw', () => ({
  useAllCollectionsRaw: () => ({ data: raw, isPending: false, isError: false }),
}))

const { useAllCollections } = await import('./useAllCollections')

function namesFor(status: 'live' | 'soon' | 'ended' | 'ALL') {
  const { result } = renderHook(() => useAllCollections({ status }))
  return result.current.data?.map((c) => c.name).sort()
}

/** The same set computed from the chip, so the expectation is the rendering rule and not a copy. */
function namesWithChip(chip: 'Live' | 'Soon' | null) {
  return raw
    .filter((c) => cardStatus(c) === chip)
    .map((c) => c.name)
    .sort()
}

describe('useAllCollections status buckets', () => {
  it('Live holds exactly the cards showing a Live chip', () => {
    expect(namesFor('live')).toEqual(namesWithChip('Live'))
    expect(namesFor('live')).toEqual(['live curve', 'live editions', 'live editions with a sequel'])
  })

  it('Soon holds exactly the cards showing a Soon chip', () => {
    expect(namesFor('soon')).toEqual(namesWithChip('Soon'))
    expect(namesFor('soon')).toEqual(['scheduled curve', 'scheduled editions'])
  })

  it('Ended holds exactly the cards showing no chip', () => {
    expect(namesFor('ended')).toEqual(namesWithChip(null))
    expect(namesFor('ended')).toEqual(['exhausted curve', 'finished editions', 'settled auction'])
  })

  it('keeps a scheduled collection out of Ended', () => {
    // The defect itself: with one boolean, `ended` meant `!isActive` and collected every Soon card.
    expect(namesFor('ended')).not.toContain('scheduled curve')
    expect(namesFor('ended')).not.toContain('scheduled editions')
  })

  it('partitions the wall — every card lands in exactly one bucket', () => {
    const buckets = [namesFor('live'), namesFor('soon'), namesFor('ended')].flat()
    expect(buckets.sort()).toEqual(namesFor('ALL'))
  })
})
