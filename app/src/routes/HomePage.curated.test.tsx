/**
 * The home page's unpaid wall.
 *
 * Until this existed, the landing page had exactly one grid and one way onto it:
 * `PromotionBadges.purchaseBadge` / the featured queue, ordered by `featuredRank` — a wei score of
 * what the slot paid. This suite is the standing proof that a second way exists and that it is not
 * the first way wearing a different label: the curations rendered here carry no rank, no badge and
 * no payment of any kind, and the wall still hangs them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { HomePage } from './HomePage'

const CURATOR = '0x1111111111111111111111111111111111111111' as const
const VIEWER = '0x2222222222222222222222222222222222222222' as const

const mockLatest = vi.hoisted(() => vi.fn())

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: VIEWER }),
  usePublicClient: () => undefined,
}))

// The featured grid is the other wall, and it is not the subject: an empty one keeps this suite
// about what reaches the page for free.
vi.mock('../generated/contracts', () => ({
  useReadQueryAggregatorGetHomePageData: () => ({
    data: [[]],
    isPending: false,
    isError: false,
  }),
}))

vi.mock('../components/home/ActivityPreview', () => ({ ActivityPreview: () => null }))

vi.mock('../components/curation/useCurations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  curationsAvailable: true,
  useLatestCurations: mockLatest,
  useCurationMetadata: () => ({
    schemaVersion: 1,
    name: 'Blues',
    description: '',
    image: '',
    items: [],
  }),
}))

function row(id: bigint, updatedAt: bigint) {
  return {
    id,
    curation: { curator: CURATOR, updatedAt, retired: false, uri: 'ipfs://QmSet' },
  }
}

function mount() {
  const { hook } = memoryLocation({ path: '/' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <HomePage />
      </Router>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockLatest.mockReturnValue({ data: [], isPending: false, isError: false })
})
afterEach(cleanup)

describe('the home page’s curated wall', () => {
  /** The clause: a set reaches the landing page carrying nothing that was bought. */
  it('hangs a curation that paid nothing and holds no badge', () => {
    mockLatest.mockReturnValue({
      data: [row(1n, 100n)],
      isPending: false,
      isError: false,
    })
    mount()

    const wall = screen.getByTestId('home-curated')
    expect(wall).toHaveTextContent('Curated')
    expect(screen.getByTestId('curation-card-1')).toBeInTheDocument()
  })

  it('labels the two walls against each other, in words', () => {
    mockLatest.mockReturnValue({ data: [row(1n, 100n)], isPending: false, isError: false })
    mount()

    expect(screen.getByText(/paid placement, labelled/i)).toBeInTheDocument()
    expect(screen.getByText(/nobody paid to be here/i)).toBeInTheDocument()
  })

  it('leads to the whole wall', () => {
    mockLatest.mockReturnValue({ data: [row(1n, 100n)], isPending: false, isError: false })
    mount()

    expect(screen.getByTestId('curations-link')).toHaveAttribute('href', '/curations')
  })

  /** An empty wall under a confident heading advertises that nobody is using it. */
  it('draws nothing at all when no curation has been published', () => {
    mount()
    expect(screen.queryByTestId('home-curated')).toBeNull()
  })

  it('draws nothing while the read is in flight or failed', () => {
    mockLatest.mockReturnValue({ data: undefined, isPending: true, isError: false })
    const { unmount } = mount()
    expect(screen.queryByTestId('home-curated')).toBeNull()
    unmount()

    mockLatest.mockReturnValue({ data: undefined, isPending: false, isError: true })
    mount()
    expect(screen.queryByTestId('home-curated')).toBeNull()
  })
})
