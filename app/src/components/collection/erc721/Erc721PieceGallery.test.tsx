/**
 * Erc721PieceGallery — the grid must browse a whole collection without paying for it up front
 * (noesis-382), and must still state the collection's TRUE piece count (noesis-381).
 *
 * The load-bearing assertion here is the READ BUDGET on mount: one chunk of candidate ids in one
 * multicall, at most one metadata resolution per resolved id in that chunk, and at most
 * METADATA_CONCURRENCY of those in flight at a time. That is what fails if the grid ever goes back
 * to fanning out across the collection.
 *
 * Vacuity check — would this still pass if virtualization were removed and every loaded piece
 * rendered eagerly? No: `renders far fewer tiles than it has loaded` compares the DOM tile count
 * against the loaded set, and an eager grid renders all of them.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { METADATA_CONCURRENCY } from '../../../lib/metadata/pool'
import { Erc721PieceGallery } from './Erc721PieceGallery'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const NOBODY = '0x0000000000000000000000000000000000000000' as const

/** The chunk the component walks per multicall; a literal so a change to it fails this file loudly. */
const PAGE_IDS = 60

/**
 * jsdom has no layout engine, so every element measures 0×0 and a virtualizer would compute an
 * empty window. Give the scroll container a viewport so the rendered band is a real one.
 */
const VIEWPORT = { width: 800, height: 300 }

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => VIEWPORT.width,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT.height,
  })
  // The virtualizer measures its scroll element through `offsetWidth`/`offsetHeight`.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => VIEWPORT.width,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => VIEWPORT.height,
  })
})

/** jsdom has no ResizeObserver; the virtualizer observes the scroll element's rect through one. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

const chain = vi.hoisted(() => ({ nextTokenId: 0n, multicalls: 0, idsRead: 0 }))
const metadata = vi.hoisted(() => ({ calls: 0, inFlight: 0, peakInFlight: 0 }))

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    multicall: async ({ contracts }: { contracts: unknown[] }) => {
      chain.multicalls += 1
      chain.idsRead += contracts.length
      return contracts.map(() => ({
        status: 'success' as const,
        result: {
          tokenURI: 'ipfs://piece',
          startTime: 1n,
          endTime: 2n,
          highBidder: NOBODY,
          settled: true,
        },
      }))
    },
  }),
}))

vi.mock('../../../generated/contracts', () => ({
  erc721AuctionInstanceAbi: [],
  useReadErc721AuctionInstanceNextTokenId: () => ({ data: chain.nextTokenId }),
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionSlug: () => 'a-collection',
}))

vi.mock('./useNowSec', () => ({ useNowSec: () => 10n }))

vi.mock('../../../lib/metadata', () => ({
  fetchJson: async () => {
    metadata.calls += 1
    metadata.inFlight += 1
    metadata.peakInFlight = Math.max(metadata.peakInFlight, metadata.inFlight)
    await new Promise((resolve) => setTimeout(resolve, 0))
    metadata.inFlight -= 1
    return { ok: true, value: { image: 'ipfs://art' } }
  },
  jsonOrNull: (r: { ok: boolean; value: unknown }) => (r.ok ? r.value : null),
}))

vi.mock('wouter', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}))

vi.mock('../../ui/IpfsImage', () => ({
  IpfsImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Erc721PieceGallery instance={INSTANCE} />
    </QueryClientProvider>,
  )
}

function tiles(): NodeListOf<HTMLLIElement> {
  return screen.getByTestId('erc721-piece-gallery').querySelectorAll('li')
}

beforeEach(() => {
  chain.nextTokenId = 0n
  chain.multicalls = 0
  chain.idsRead = 0
  metadata.calls = 0
  metadata.inFlight = 0
  metadata.peakInFlight = 0
})

afterEach(cleanup)

test('a collection in the thousands costs one chunk on mount, not a fan-out', async () => {
  chain.nextTokenId = 4001n // ids 1..4000
  mount()

  const count = await screen.findByTestId('erc721-piece-gallery-count')
  // The true total, specifically — a grid that stated only what it had loaded would not say it.
  expect(count.textContent).toContain('4,000')
  expect(count.textContent).toBe(`${PAGE_IDS} of 4,000 pieces loaded — scroll for more`)

  await waitFor(() => expect(tiles().length).toBeGreaterThan(0))

  expect(chain.multicalls).toBe(1)
  expect(chain.idsRead).toBe(PAGE_IDS)
  expect(metadata.calls).toBe(PAGE_IDS)
  expect(metadata.peakInFlight).toBeLessThanOrEqual(METADATA_CONCURRENCY)
})

test('renders far fewer tiles than it has loaded — the window, not the whole chunk', async () => {
  chain.nextTokenId = 4001n
  mount()

  await screen.findByTestId('erc721-piece-gallery-count')
  await waitFor(() => expect(tiles().length).toBeGreaterThan(0))
  expect(tiles().length).toBeLessThan(PAGE_IDS)
})

test('a collection smaller than one chunk states its count with no truncation claim', async () => {
  chain.nextTokenId = 8n // ids 1..7
  mount()

  const count = await screen.findByTestId('erc721-piece-gallery-count')
  expect(count.textContent).toBe('7 pieces')
  expect(count.textContent).not.toContain('loaded')
  // The chunk is clipped to the collection — no reads past the last minted id.
  expect(chain.idsRead).toBe(7)
})

test('an empty collection says so without reading the id space', async () => {
  chain.nextTokenId = 1n // nothing minted
  mount()

  expect(await screen.findByText('no pieces minted yet')).toBeInTheDocument()
  expect(chain.multicalls).toBe(0)
  expect(metadata.calls).toBe(0)
})
