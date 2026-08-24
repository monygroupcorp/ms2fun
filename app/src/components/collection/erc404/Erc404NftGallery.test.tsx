/**
 * Erc404NftGallery — the grid must browse a whole collection without paying for it up front
 * (noesis-382), and must still state the collection's TRUE piece count (noesis-381).
 *
 * The load-bearing assertion here is the READ BUDGET on mount: one chunk of candidate ids in one
 * multicall, at most one metadata resolution per surviving id in that chunk, and at most
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
import { Erc404NftGallery } from './Erc404NftGallery'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const MIRROR = '0x2222222222222222222222222222222222222222' as const

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

const chain = vi.hoisted(() => ({
  totalSupply: 0n,
  multicalls: 0,
  /** ids that have been burned by a reroll: `tokenURI` reverts for them. */
  holes: new Set<string>(),
}))

const metadata = vi.hoisted(() => ({ calls: 0, inFlight: 0, peakInFlight: 0 }))

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    readContract: async () => chain.totalSupply,
    multicall: async ({ contracts }: { contracts: { args: readonly bigint[] }[] }) => {
      chain.multicalls += 1
      return contracts.map((c) => {
        const id = c.args[0]?.toString() ?? '0'
        if (chain.holes.has(id)) return { status: 'failure' as const, error: new Error('burned') }
        return { status: 'success' as const, result: `ipfs://piece/${id}` }
      })
    },
  }),
}))

vi.mock('../../../generated/contracts', () => ({
  useReadErc404BondingInstanceMirrorErc721: () => ({ data: MIRROR }),
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionSlug: () => 'a-collection',
}))

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
      <Erc404NftGallery instance={INSTANCE} />
    </QueryClientProvider>,
  )
}

function tiles(): NodeListOf<HTMLLIElement> {
  return screen.getByTestId('erc404-nft-gallery').querySelectorAll('li')
}

beforeEach(() => {
  chain.totalSupply = 0n
  chain.multicalls = 0
  chain.holes = new Set()
  metadata.calls = 0
  metadata.inFlight = 0
  metadata.peakInFlight = 0
})

afterEach(cleanup)

test('a collection in the thousands costs one chunk on mount, not a fan-out', async () => {
  chain.totalSupply = 10_000n
  mount()

  const count = await screen.findByTestId('erc404-nft-gallery-count')
  // The true total, specifically — a grid that stated only what it had loaded would not say it.
  expect(count.textContent).toContain('10,000')
  expect(count.textContent).toBe(`${PAGE_IDS} of 10,000 pieces loaded — scroll for more`)

  await waitFor(() => expect(tiles().length).toBeGreaterThan(0))

  // One chunk of ids, one round-trip, one metadata resolution per id in that chunk — and no more,
  // however large the collection is.
  expect(chain.multicalls).toBe(1)
  expect(metadata.calls).toBe(PAGE_IDS)
  expect(metadata.peakInFlight).toBeLessThanOrEqual(METADATA_CONCURRENCY)
})

test('renders far fewer tiles than it has loaded — the window, not the whole chunk', async () => {
  chain.totalSupply = 10_000n
  mount()

  await screen.findByTestId('erc404-nft-gallery-count')
  await waitFor(() => expect(tiles().length).toBeGreaterThan(0))
  expect(tiles().length).toBeLessThan(PAGE_IDS)
})

test('burned ids leave no gaps — the row model is the surviving pieces', async () => {
  chain.totalSupply = 10_000n
  chain.holes = new Set(['3', '4', '5'])
  mount()

  const count = await screen.findByTestId('erc404-nft-gallery-count')
  expect(count.textContent).toBe(`${PAGE_IDS - 3} of 10,000 pieces loaded — scroll for more`)
  // Only the surviving ids were resolved; the holes cost nothing.
  expect(metadata.calls).toBe(PAGE_IDS - 3)

  await waitFor(() => expect(tiles().length).toBeGreaterThan(0))
  // Every rendered cell is a real piece: the list closes over the burned ids rather than leaving
  // three blank slots where 3, 4 and 5 used to be.
  const rendered = [...tiles()].map((li) => li.textContent?.match(/#(\d+)/)?.[1])
  expect(rendered.slice(0, 3)).toEqual(['1', '2', '6'])
  expect(rendered).not.toContain('3')
})

test('a collection smaller than one chunk states its count with no truncation claim', async () => {
  chain.totalSupply = 12n
  chain.holes = new Set(
    Array.from({ length: PAGE_IDS - 12 }, (_, i) => String(13 + i)), // ids 13.. do not exist
  )
  mount()

  const count = await screen.findByTestId('erc404-nft-gallery-count')
  expect(count.textContent).toBe('12 pieces')
  expect(count.textContent).not.toContain('loaded')
  expect(chain.multicalls).toBe(1)
})

test('an empty collection says so without reading the id space', async () => {
  chain.totalSupply = 0n
  mount()

  expect(await screen.findByText('no NFTs minted yet')).toBeInTheDocument()
  expect(chain.multicalls).toBe(0)
  expect(metadata.calls).toBe(0)
})
