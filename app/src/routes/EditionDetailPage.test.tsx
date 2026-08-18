/**
 * EditionDetailPage — the share control's mount, and the state it must not offer a link from.
 *
 * `ShareLink` is the app's only share mechanic and the whole propagation strategy depends on
 * someone posting the link it produces. Its own suite is a pure isolation suite: it proves the
 * component works, never that it is *used*. Deleting every call site left the app suite green
 * (measured, `AUDIT-2026-08-18.md` finding 1). This file gates one of the four call sites; the
 * collection route's is gated in `CollectionPage.test.tsx`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { EditionView } from '../components/collection/useEditions'
import { EditionDetailPage } from './EditionDetailPage'

const INSTANCE = '0x00000000000000000000000000000000000000ab' as const

// ── Mocks ────────────────────────────────────────────────────────────────────
// Slug → instance resolution (the route's first read, shared with CollectionPage).
const mockResolveName = vi.hoisted(() =>
  vi.fn<() => { data: `0x${string}` | undefined; isPending: boolean; isError: boolean }>(),
)
vi.mock('../generated/contracts', () => ({
  useReadMasterRegistryV1ResolveName: mockResolveName,
}))

const mockUseEditions = vi.hoisted(() =>
  vi.fn<
    () => {
      data: readonly EditionView[]
      isPending: boolean
      isError: boolean
      refetch: () => void
    }
  >(),
)
vi.mock('../components/collection/useEditions', () => ({
  useEditions: mockUseEditions,
}))

// The edition's metadata JSON — fetched through react-query; not what this suite is about.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}))

// Wallet state — unconnected, so RouteWrongChainBanner stays silent.
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false, error: undefined }),
}))

// The mint surface carries its own generated-contract reads; stubbed to keep the render
// deterministic. The share control is not inside it.
vi.mock('../components/collection/erc1155/MintPanel', () => ({ MintPanel: () => null }))

afterEach(() => {
  cleanup()
  mockResolveName.mockReset()
  mockUseEditions.mockReset()
})

function edition(id: bigint): EditionView {
  return {
    id,
    pieceTitle: 'a piece',
    metadataURI: '',
    supply: 10n,
    minted: 3n,
    currentPrice: 0n,
    pricingModel: 0,
  } as unknown as EditionView
}

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true })
  render(
    <Router hook={hook}>
      <Switch>
        <Route path="/:chainId/:slug/edition/:id" component={EditionDetailPage} />
      </Switch>
    </Router>,
  )
}

// ── The share control ────────────────────────────────────────────────────────

test('a resolved edition offers the share control', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseEditions.mockReturnValue({
    data: [edition(1n)],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })

  renderAt('/1337/foo/edition/1')

  await screen.findByTestId('edition-detail')
  // Either affordance counts: the button, or the read-only input it degrades to when
  // `navigator.clipboard` is unavailable. What must not happen is neither.
  expect(
    screen.queryByTestId('share-link') ?? screen.queryByTestId('share-link-fallback'),
  ).not.toBe(null)
})

test('an edition that does not exist does not offer a link to it', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseEditions.mockReturnValue({
    data: [edition(2n)],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })

  renderAt('/1337/foo/edition/1')

  await screen.findByTestId('edition-detail')
  expect(screen.queryByTestId('share-link')).toBe(null)
  expect(screen.queryByTestId('share-link-fallback')).toBe(null)
})
