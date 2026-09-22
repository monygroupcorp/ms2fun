/**
 * The Curated tab of a profile plate. The one behaviour worth pinning here is whose eyes see what:
 * a curation taken off view is still the curator's, and putting it back is one click from its page
 * — so their own shelf keeps it, and a visitor's shelf does not.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { CuratorShelf } from './CuratorShelf'

const CURATOR = '0x1111111111111111111111111111111111111111' as const

const mockCurationsOf = vi.hoisted(() => vi.fn())

vi.mock('./useCurations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  curationsAvailable: true,
  useCurationsOf: mockCurationsOf,
  useCurationMetadata: () => ({
    schemaVersion: 1,
    name: 'Blues',
    description: '',
    image: '',
    items: [],
  }),
}))

function row(id: bigint, retired = false) {
  return {
    id,
    curation: { curator: CURATOR, updatedAt: 100n, retired, uri: 'ipfs://QmSet' },
  }
}

function mount(isOwn: boolean) {
  const { hook } = memoryLocation({ path: '/profile' })
  return render(
    <Router hook={hook}>
      <CuratorShelf curator={CURATOR} isOwn={isOwn} />
    </Router>,
  )
}

beforeEach(() => {
  mockCurationsOf.mockReturnValue({ data: [], isPending: false, isError: false, queryKey: [] })
})
afterEach(cleanup)

describe('CuratorShelf', () => {
  it('shows a curator their own retired curations', () => {
    mockCurationsOf.mockReturnValue({
      data: [row(2n, true), row(1n)],
      isPending: false,
      isError: false,
      queryKey: [],
    })
    mount(true)

    expect(screen.getByTestId('curation-card-2')).toBeInTheDocument()
    expect(screen.getByTestId('curation-card-1')).toBeInTheDocument()
  })

  it('hides a retired curation from a visitor', () => {
    mockCurationsOf.mockReturnValue({
      data: [row(2n, true), row(1n)],
      isPending: false,
      isError: false,
      queryKey: [],
    })
    mount(false)

    expect(screen.queryByTestId('curation-card-2')).toBeNull()
    expect(screen.getByTestId('curation-card-1')).toBeInTheDocument()
  })

  /** The invitation is the point: you do not have to have made anything to publish a set. */
  it('invites a curator with an empty shelf to make one', () => {
    mount(true)
    const empty = screen.getByTestId('curator-shelf-empty')
    expect(empty).toHaveTextContent('haven’t curated anything yet')
    expect(empty).toHaveTextContent('don’t need to have made anything')
    expect(screen.getByRole('link', { name: /create a curation/i })).toHaveAttribute(
      'href',
      '/curations',
    )
  })

  it('says nothing is curated, without inviting a visitor to curate for them', () => {
    mount(false)
    expect(screen.getByTestId('curator-shelf-empty')).toHaveTextContent('Nothing curated')
    expect(screen.queryByRole('link', { name: /create a curation/i })).toBeNull()
  })

  it('shows a visitor an empty shelf when everything on it is off view', () => {
    mockCurationsOf.mockReturnValue({
      data: [row(1n, true)],
      isPending: false,
      isError: false,
      queryKey: [],
    })
    mount(false)
    expect(screen.getByTestId('curator-shelf-empty')).toBeInTheDocument()
  })

  it('reports a read failure as a network fault', () => {
    mockCurationsOf.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      queryKey: [],
    })
    mount(true)
    expect(screen.getByRole('alert')).toHaveTextContent('could not reach the curation registry')
  })
})
