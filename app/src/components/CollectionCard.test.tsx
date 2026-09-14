import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { ProjectCard } from '../lib/discovery/types'
import { CollectionCard } from './CollectionCard'

// The chip is the subject; the art and the metadata fetch are not.
vi.mock('./useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))
vi.mock('./ui/IpfsImage', () => ({ IpfsImage: () => null }))

afterEach(cleanup)

const ADDR = '0x1111111111111111111111111111111111aAaA' as const

function card(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    instance: ADDR,
    name: 'Specimen',
    metadataURI: '',
    creator: ADDR,
    registeredAt: 0n,
    factory: ADDR,
    contractType: 'ERC404',
    factoryTitle: '',
    vault: ADDR,
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

function renderCard(c: ProjectCard) {
  const { hook } = memoryLocation({ path: '/collections' })
  return render(
    <Router hook={hook}>
      <CollectionCard card={c} />
    </Router>,
  )
}

/** The chip element itself — `.st` is the `.noesis-card` device's status slot. */
function chip(container: HTMLElement) {
  return container.querySelector('.st')
}

// Per family, because each one reaches these two fields by a different route in the lens — a
// bonding curve's open time and buyable ceiling, an edition set's per-edition openTime and supply —
// and the card must not be able to tell them apart.
describe.each([
  ['ERC-404 curve', 'ERC404'],
  ['ERC-1155 editions', 'ERC1155'],
])('CollectionCard status chip — %s', (_label, contractType) => {
  it('reads Live while it is buyable', () => {
    const { container } = renderCard(card({ contractType, isActive: true, opensAt: 0n }))
    expect(chip(container)).toHaveTextContent('Live')
  })

  it('reads Soon while the opening is still ahead', () => {
    const { container } = renderCard(
      card({ contractType, isActive: false, opensAt: 1_700_000_000n }),
    )
    expect(chip(container)).toHaveTextContent('Soon')
  })

  it('draws no chip once the collection is over', () => {
    // A curve bought out or graduated, an edition run fully minted: the card falls silent rather
    // than shouting "Ended" — the minted figure beside it already carries that news.
    const { container } = renderCard(card({ contractType, isActive: false, opensAt: 0n }))
    expect(chip(container)).toBeNull()
    expect(screen.queryByText('Ended')).toBeNull()
  })
})

describe('CollectionCard status chip — ERC-721 auctions', () => {
  // Auctions have no scheduled start, so the lens leaves `opensAt` at 0 for the whole family: a
  // settled or never-queued collection is over, never Soon.
  it('draws no chip when no auction is running', () => {
    const { container } = renderCard(card({ contractType: 'ERC721', isActive: false, opensAt: 0n }))
    expect(chip(container)).toBeNull()
  })

  it('reads Live while an auction is running', () => {
    const { container } = renderCard(card({ contractType: 'ERC721', isActive: true, opensAt: 0n }))
    expect(chip(container)).toHaveTextContent('Live')
  })
})
