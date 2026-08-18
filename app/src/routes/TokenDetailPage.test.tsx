/**
 * TokenDetailPage — the share control's two mounts, one per token body.
 *
 * Same reason as `EditionDetailPage.test.tsx`: `ShareLink` is the app's only share mechanic, its
 * own suite is a pure isolation suite, and deleting every call site was measured to leave the
 * app gate green. This page carries two of the four call sites — the ERC-404
 * body and the ERC-721 auction body — and they are separate renders, so one test cannot cover both.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { TokenDetailPage } from './TokenDetailPage'

const INSTANCE = '0x00000000000000000000000000000000000000ab' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockResolveName = vi.hoisted(() =>
  vi.fn<() => { data: `0x${string}` | undefined; isPending: boolean; isError: boolean }>(),
)
vi.mock('../generated/contracts', () => ({
  erc721AuctionInstanceAbi: [],
  mirrorErc721Abi: [],
  useReadMasterRegistryV1ResolveName: mockResolveName,
  useReadErc404BondingInstanceMirrorErc721: () => ({ data: INSTANCE }),
}))

const mockUseCollection = vi.hoisted(() => vi.fn<() => { data: unknown }>())
vi.mock('../components/useCollection', () => ({ useCollection: mockUseCollection }))

// The token read. Both bodies fetch through react-query; the fixture is supplied per test.
const mockUseQuery = vi.hoisted(() =>
  vi.fn<() => { data: unknown; isPending: boolean; isError: boolean; refetch: () => void }>(),
)
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false, error: undefined }),
  usePublicClient: () => ({}),
}))

vi.mock('../components/collection/erc721/useAuctions', () => ({ useAuctions: () => ({}) }))
vi.mock('../components/collection/erc721/useBidHistory', () => ({
  useBidHistory: () => ({ data: [] }),
}))
vi.mock('../components/collection/erc721/AuctionCard', () => ({ AuctionAction: () => null }))
vi.mock('../components/collection/erc404/MetadataHolderPanel', () => ({
  MetadataHolderPanel: () => null,
}))
vi.mock('../components/ui/useOwnerGate', () => ({ useOwnerGate: () => ({ isOwner: false }) }))

afterEach(() => {
  cleanup()
  mockResolveName.mockReset()
  mockUseCollection.mockReset()
  mockUseQuery.mockReset()
})

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true })
  render(
    <Router hook={hook}>
      <Switch>
        <Route path="/:chainId/:slug/token/:id" component={TokenDetailPage} />
      </Switch>
    </Router>,
  )
}

function auctionFixture() {
  return {
    auction: {
      tokenURI: '',
      minBid: 0n,
      highBid: 0n,
      highBidder: ZERO,
      startTime: 0n,
      endTime: 0n,
      settled: false,
    },
    image: undefined,
    name: 'a work',
  }
}

// ── The share control ────────────────────────────────────────────────────────
// Either affordance counts: the button, or the read-only input it degrades to when
// `navigator.clipboard` is unavailable. What must not happen is neither.
function shareControl() {
  return screen.queryByTestId('share-link') ?? screen.queryByTestId('share-link-fallback')
}

test('a resolved ERC-404 token offers the share control', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: { name: 'foo', contractType: 'ERC404' } })
  mockUseQuery.mockReturnValue({
    data: { image: undefined, owner: undefined },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })

  renderAt('/1337/foo/token/1')

  await screen.findByTestId('token-detail')
  expect(shareControl()).not.toBe(null)
})

test('a resolved ERC-721 auction token offers the share control', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: { name: 'foo', contractType: 'ERC721' } })
  mockUseQuery.mockReturnValue({
    data: auctionFixture(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })

  renderAt('/1337/foo/token/1')

  await screen.findByTestId('token-detail')
  expect(shareControl()).not.toBe(null)
})

test('a token that failed to load does not offer a link to it', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: { name: 'foo', contractType: 'ERC721' } })
  mockUseQuery.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch: vi.fn(),
  })

  renderAt('/1337/foo/token/1')

  await screen.findByTestId('token-detail')
  expect(shareControl()).toBe(null)
})
