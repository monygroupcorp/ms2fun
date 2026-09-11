import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionFilters } from '../lib/discovery'
import type { ProjectCard } from '../lib/discovery/types'

// ── The registry list agrees with the grid about what a collection is doing ─────────────────────
//
// Grid and list are the same data read two ways, so they must not disagree about status. The list's
// Status column is a fixed grid cell rather than a chip: a collection with nothing to announce gets
// the column's own em dash — the same placeholder the Aligned column already uses — and never the
// word Ended, which used to stand in for a finished curve, a graduated collection, a settled
// auction and a finished edition run alike.

const ADDR = '0x1111111111111111111111111111111111aAaA' as const

function card(name: string, overrides: Partial<ProjectCard>): ProjectCard {
  return {
    instance: `0x${name.charCodeAt(0).toString(16).padStart(40, '0')}` as `0x${string}`,
    name,
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

const rows: ProjectCard[] = [
  card('live', { isActive: true }),
  card('scheduled', { opensAt: 1_900_000_000n }),
  card('exhausted', {}),
  card('settled auction', { contractType: 'ERC721' }),
  card('finished editions', { contractType: 'ERC1155' }),
]

const mockUseAllCollections = vi.hoisted(() =>
  vi.fn((_filters?: CollectionFilters) => ({
    data: [] as ProjectCard[],
    isPending: false,
    isError: false,
    total: 0,
  })),
)
vi.mock('../lib/discovery', () => ({ useAllCollections: mockUseAllCollections }))
vi.mock('../components/useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))
vi.mock('../components/ui/IpfsImage', () => ({ IpfsImage: () => null }))

const { CollectionsPage } = await import('./CollectionsPage')

/** The Status cell of every registry row, in wall order. `.row` is the registry device's row. */
function statusCells(container: HTMLElement): (string | undefined)[] {
  return Array.from(container.querySelectorAll('a.row')).map(
    (row) => row.children[3]?.textContent ?? undefined,
  )
}

function renderList() {
  mockUseAllCollections.mockReturnValue({
    data: rows,
    isPending: false,
    isError: false,
    total: rows.length,
  })
  const view = render(<CollectionsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  return view
}

afterEach(cleanup)

describe('CollectionsPage registry row status', () => {
  it('spells Live and Soon, and nothing for the states that are over', () => {
    const { container } = renderList()
    expect(statusCells(container)).toEqual(['Live', 'Soon', '—', '—', '—'])
  })

  it('never prints Ended over a finished curve, auction or edition run', () => {
    // Scoped to the wall: `Ended` is also the name of a status FILTER chip in the header, and that
    // control is a bucket selector, not a claim about any one collection.
    renderList()
    const list = screen.getByTestId('collections-list')
    expect(within(list).queryByText('Ended')).toBeNull()
  })
})
