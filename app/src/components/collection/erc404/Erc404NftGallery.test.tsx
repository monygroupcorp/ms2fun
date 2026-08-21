/**
 * Erc404NftGallery (noesis-381) — the grid scans a capped window of ids, so it must state the
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
import { Erc404NftGallery } from './Erc404NftGallery'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const MIRROR = '0x2222222222222222222222222222222222222222' as const

/** The cap the component scans to; kept as a literal so a change to it fails this file loudly. */
const MAX_SCAN = 100

const mockTotalSupply = vi.hoisted(() => ({ value: 0n }))

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    readContract: async () => mockTotalSupply.value,
    multicall: async ({ contracts }: { contracts: { args: readonly bigint[] }[] }) =>
      contracts.map((c) => ({
        status: 'success' as const,
        result: `ipfs://piece/${c.args[0]?.toString() ?? '0'}`,
      })),
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
      <Erc404NftGallery instance={INSTANCE} />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

test('a collection above the scan cap states its true total, not just the window', async () => {
  mockTotalSupply.value = 10_000n
  mount()

  const count = await screen.findByTestId('erc404-nft-gallery-count')
  // The true total, specifically — a window that silently rendered only the cap would not say it.
  expect(count.textContent).toContain('10,000')
  expect(count.textContent).toBe(`showing the first ${MAX_SCAN} of 10,000 pieces`)

  await waitFor(() => {
    expect(screen.getByTestId('erc404-nft-gallery').querySelectorAll('li')).toHaveLength(MAX_SCAN)
  })
})

test('a collection within the cap states its count with no truncation claim', async () => {
  mockTotalSupply.value = 12n
  mount()

  const count = await screen.findByTestId('erc404-nft-gallery-count')
  expect(count.textContent).toBe('12 pieces')
  expect(count.textContent).not.toContain('showing the first')
})
