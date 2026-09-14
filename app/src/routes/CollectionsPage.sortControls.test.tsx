import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionFilters } from '../lib/discovery'

// ── Every sort chip does what its label says ────────────────────────────────────────────────────
//
// /collections used to offer a TVL chip. `ProjectCard` carries no value figure, so the option fell
// through to 'recent' ordering: the wall reordered under a label that described nothing it had
// read. The chip is gone, and this suite is what keeps it gone — a sort control may only offer an
// axis `useAllCollections` really sorts on.

const mockUseAllCollections = vi.hoisted(() =>
  vi.fn((_filters?: CollectionFilters) => ({
    data: [],
    isPending: false,
    isError: false,
    total: 0,
  })),
)
vi.mock('../lib/discovery', () => ({ useAllCollections: mockUseAllCollections }))

// The wall's card body is not what this suite tests; the empty result above renders none of it,
// but the metadata hook is imported at module scope and would reach for a chain client.
vi.mock('../components/useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))

const { CollectionsPage } = await import('./CollectionsPage')

function sortChips(): string[] {
  const group = screen.getByRole('group', { name: 'sort' })
  return within(group)
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
}

beforeEach(() => {
  mockUseAllCollections.mockClear()
})

afterEach(cleanup)

describe('CollectionsPage sort control', () => {
  it('offers exactly the sorts useAllCollections implements', () => {
    render(<CollectionsPage />)
    expect(sortChips()).toEqual(['Recent', 'Name'])
  })

  it('offers no TVL sort — no card read backs one', () => {
    render(<CollectionsPage />)
    expect(screen.queryByRole('button', { name: /tvl/i })).toBeNull()
  })

  it('dispatches the sort its chip is labelled for', () => {
    render(<CollectionsPage />)
    expect(mockUseAllCollections.mock.calls.at(-1)?.[0]?.sort).toBe('recent')

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(mockUseAllCollections.mock.calls.at(-1)?.[0]?.sort).toBe('name')

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))
    expect(mockUseAllCollections.mock.calls.at(-1)?.[0]?.sort).toBe('recent')
  })
})
