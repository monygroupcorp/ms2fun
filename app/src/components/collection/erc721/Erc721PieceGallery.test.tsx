/**
 * Erc721PieceGallery (noesis-381) — the grid scans a capped window of ids, so it must state the
 * collection's TRUE piece count. A collection far above the cap renders a cap-sized grid; without
 * the count line that grid is indistinguishable from a collection that holds exactly that many
 * pieces, and the viewer is told something untrue about the work.
 *
 * The guard asserts the STATED TOTAL, not merely that some text is present: a grid that dropped the
 * cap and rendered every piece would not produce this line, which is what keeps the test honest.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { Erc721PieceGallery } from './Erc721PieceGallery'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const NOBODY = '0x0000000000000000000000000000000000000000' as const

/** The cap the component scans to; kept as a literal so a change to it fails this file loudly. */
const MAX_SCAN = 100

const mockNextTokenId = vi.hoisted(() => ({ value: 0n }))

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    multicall: async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({
        status: 'success' as const,
        result: {
          tokenURI: 'ipfs://piece',
          startTime: 1n,
          endTime: 2n,
          highBidder: NOBODY,
          settled: true,
        },
      })),
  }),
}))

vi.mock('../../../generated/contracts', () => ({
  erc721AuctionInstanceAbi: [],
  useReadErc721AuctionInstanceNextTokenId: () => ({ data: mockNextTokenId.value }),
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionSlug: () => 'a-collection',
}))

vi.mock('./useNowSec', () => ({ useNowSec: () => 10n }))

vi.mock('../../../lib/metadata', () => ({
  fetchJson: async () => ({ ok: true, value: { image: 'ipfs://art' } }),
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

afterEach(cleanup)

test('a collection above the scan cap states its true total, not just the window', async () => {
  mockNextTokenId.value = 4001n // ids 1..4000

  mount()

  const count = await screen.findByTestId('erc721-piece-gallery-count')
  // The true total, specifically — a window that silently rendered only the cap would not say it.
  expect(count.textContent).toContain('4,000')
  expect(count.textContent).toBe(`showing the first ${MAX_SCAN} of 4,000 pieces`)

  await waitFor(() => {
    expect(screen.getByTestId('erc721-piece-gallery').querySelectorAll('li')).toHaveLength(MAX_SCAN)
  })
})

test('a collection within the cap states its count with no truncation claim', async () => {
  mockNextTokenId.value = 8n // ids 1..7

  mount()

  const count = await screen.findByTestId('erc721-piece-gallery-count')
  expect(count.textContent).toBe('7 pieces')
  expect(count.textContent).not.toContain('showing the first')
})
