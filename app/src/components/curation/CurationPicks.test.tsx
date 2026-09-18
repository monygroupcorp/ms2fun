/**
 * A curation's picks as they hang. Three shapes a pick can take, and the reason each renders the
 * way it does: a whole collection is the ordinary collection card, a piece names itself and links
 * to its own page, and an address no collection answers to is SHOWN rather than swallowed — the
 * set a visitor sees has to be the set the curator published.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { ProjectCard } from '../../lib/discovery'
import type { CurationItem } from '../../lib/metadata'
import { CurationPicks } from './CurationPicks'

const EDITIONS = '0x1111111111111111111111111111111111111111' as const
const TOKENS = '0x2222222222222222222222222222222222222222' as const
const GONE = '0x3333333333333333333333333333333333333333' as const

const mockCards = vi.hoisted(() => vi.fn())

vi.mock('../../lib/discovery', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectCards: mockCards,
}))
vi.mock('../useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))
vi.mock('../ui/IpfsImage', () => ({ IpfsImage: () => null }))

function card(instance: `0x${string}`, name: string, contractType: string): ProjectCard {
  return {
    instance,
    name,
    metadataURI: '',
    creator: instance,
    registeredAt: 0n,
    factory: instance,
    contractType,
    factoryTitle: '',
    vault: instance,
    vaultName: '',
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    isActive: false,
    opensAt: 0n,
    extraData: '0x',
    featuredRank: 0n,
    featuredExpires: 0n,
  }
}

const item = (o: Partial<CurationItem> & { instance: `0x${string}` }): CurationItem => ({
  tokenId: '',
  note: '',
  ...o,
})

function mount(items: CurationItem[]) {
  const { hook } = memoryLocation({ path: '/curation/1' })
  return render(
    <Router hook={hook}>
      <CurationPicks items={items} />
    </Router>,
  )
}

beforeEach(() => {
  mockCards.mockReturnValue({
    data: [card(EDITIONS, 'Zine', 'ERC1155'), card(TOKENS, 'Auction', 'ERC721')],
    isPending: false,
    isError: false,
  })
})
afterEach(cleanup)

describe('CurationPicks', () => {
  it('hangs a whole-collection pick as the ordinary collection card', () => {
    mount([item({ instance: EDITIONS })])
    expect(screen.getByRole('link', { name: /Zine/ })).toHaveAttribute('href', '/1337/zine')
  })

  it('routes a piece pick by its collection’s type', () => {
    mount([item({ instance: EDITIONS, tokenId: '4' }), item({ instance: TOKENS, tokenId: '9' })])

    expect(screen.getByTestId(`curation-piece-${EDITIONS}-4`)).toHaveAttribute(
      'href',
      '/1337/zine/edition/4',
    )
    expect(screen.getByTestId(`curation-piece-${TOKENS}-9`)).toHaveAttribute(
      'href',
      '/1337/auction/token/9',
    )
  })

  it('shows an unresolved pick instead of dropping it', () => {
    mount([item({ instance: GONE })])
    expect(screen.getByTestId(`curation-unresolved-${GONE}`)).toBeInTheDocument()
  })

  it('carries the curator’s note under the pick it belongs to', () => {
    mount([item({ instance: EDITIONS, note: 'the reason' })])
    expect(screen.getByText('the reason')).toBeInTheDocument()
  })

  it('keeps the curator’s order', () => {
    mount([item({ instance: TOKENS }), item({ instance: EDITIONS })])
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/1337/auction', '/1337/zine'])
  })

  it('says a named-but-empty set is empty, not broken', () => {
    mount([])
    expect(screen.getByTestId('curation-empty')).toHaveTextContent('Nothing hung yet')
  })

  it('reports a read failure as a network fault', () => {
    mockCards.mockReturnValue({ data: undefined, isPending: false, isError: true })
    mount([item({ instance: EDITIONS })])
    expect(screen.getByRole('alert')).toHaveTextContent('discovery unreachable')
  })
})
