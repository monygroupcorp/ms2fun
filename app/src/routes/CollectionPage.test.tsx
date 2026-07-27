import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { ProjectCard } from '../components/useCreatorCollections'
import { CollectionPage, LegacyCollectionRedirect } from './CollectionPage'

// ── Mocks ────────────────────────────────────────────────────────────────────
// The resolver read (chain-scoped-slug-routes noesis-079's core new surface).
const mockResolveName = vi.hoisted(() =>
  vi.fn<() => { data: `0x${string}` | undefined; isPending: boolean; isError: boolean }>(),
)
vi.mock('../generated/contracts', () => ({
  useReadMasterRegistryV1ResolveName: mockResolveName,
}))

// The card read (used by both the resolved body and the legacy chain-blind redirector).
const mockUseCollection = vi.hoisted(() =>
  vi.fn<() => { data: ProjectCard | undefined; isPending: boolean; isError: boolean }>(),
)
vi.mock('../components/useCollection', () => ({
  useCollection: mockUseCollection,
}))

vi.mock('../components/useCollectionMetadata', () => ({
  useCollectionMetadata: () => undefined,
}))

// Wallet state — unconnected by default, so RouteWrongChainBanner stays silent and CollectionBody's
// composer footer renders its "connect your wallet" prompt.
const mockUseAccount = vi.hoisted(() => vi.fn(() => ({ address: undefined })))
const mockUseSwitchChain = vi.hoisted(() =>
  vi.fn(() => ({ switchChain: vi.fn(), isPending: false, error: undefined })),
)
vi.mock('wagmi', () => ({
  useAccount: mockUseAccount,
  useSwitchChain: mockUseSwitchChain,
}))

// Heavy subtree panels — not what this suite tests (route resolution), stubbed to keep renders
// deterministic and free of their own generated-contracts hooks.
vi.mock('../components/MessageComposer', () => ({ MessageComposer: () => null }))
vi.mock('../components/MessageFeed', () => ({ MessageFeed: () => null }))
vi.mock('../components/collection/VaultPanel', () => ({ VaultPanel: () => null }))
vi.mock('../components/featured/FeaturedPanel', () => ({ FeaturedPanel: () => null }))
vi.mock('../components/collection/ProjectStyle', () => ({ ProjectStyle: () => null }))
vi.mock('../components/collection/types/collectionSurfaces', () => ({
  resolveCollectionSurfaces: () => ({
    Primary: null,
    Charts: null,
    Portfolio: null,
    Gallery: null,
    Admin: null,
  }),
}))

afterEach(() => {
  cleanup()
  mockResolveName.mockReset()
  mockUseCollection.mockReset()
  mockUseAccount.mockReset().mockReturnValue({ address: undefined })
  mockUseSwitchChain
    .mockReset()
    .mockReturnValue({ switchChain: vi.fn(), isPending: false, error: undefined })
})

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const INSTANCE = '0x1111111111111111111111111111111111111111' as const

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    instance: INSTANCE,
    name: 'foo',
    creator: '0x2222222222222222222222222222222222222222',
    contractType: 'ERC1155',
    metadataURI: '',
    isActive: true,
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    vault: ZERO_ADDRESS,
    vaultName: '',
    ...overrides,
  } as unknown as ProjectCard
}

/** Renders the app's chain-scoped + legacy collection routes at `path`, in a recording memory
 * location so redirects are observable via `history`. */
function renderAt(path: string) {
  const { hook, history } = memoryLocation({ path, record: true })
  render(
    <Router hook={hook}>
      <Switch>
        {/* Legacy route listed first — see the ordering note in App.tsx (regexparam@3 doesn't
            support `:param(regex)`, so route order is the real disambiguator). */}
        <Route path="/collection/:instance" component={LegacyCollectionRedirect} />
        <Route path="/:chainId/:slug" component={CollectionPage} />
      </Switch>
    </Router>,
  )
  return { history }
}

test('/1337/foo resolves and renders the collection', async () => {
  mockResolveName.mockReturnValue({ data: INSTANCE, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: card(), isPending: false, isError: false })

  renderAt('/1337/foo')

  expect(await screen.findByTestId('collection-detail')).toBeInTheDocument()
})

test('/1337/nope resolves to no collection by that name', async () => {
  mockResolveName.mockReturnValue({ data: ZERO_ADDRESS, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: undefined, isPending: false, isError: false })

  renderAt('/1337/nope')

  expect(await screen.findByText(/no collection by that name/i)).toBeInTheDocument()
})

test('/999/foo — unsupported chain — renders the unknown-network state', async () => {
  mockResolveName.mockReturnValue({ data: undefined, isPending: false, isError: false })
  mockUseCollection.mockReturnValue({ data: undefined, isPending: false, isError: false })

  renderAt('/999/foo')

  expect(await screen.findByText(/doesn.t serve chain 999/i)).toBeInTheDocument()
})

test('/collection/0x… — legacy address route — redirects to /1337/<name>', async () => {
  mockUseCollection.mockReturnValue({
    data: card({ name: 'foo' }),
    isPending: false,
    isError: false,
  })
  // The redirect lands on /1337/foo, which the same test Switch also matches (CollectionPage) —
  // give its resolver read a shape so that post-redirect render doesn't crash.
  mockResolveName.mockReturnValue({ data: undefined, isPending: true, isError: false })

  const { history } = renderAt(`/collection/${INSTANCE}`)

  await waitFor(() => expect(history.at(-1)).toBe('/1337/foo'))
})

test('/1337/Foo — mixed-case slug — redirects to the lowercase form', async () => {
  // The resolve read is disabled while a case-redirect is pending, so its mock value is unused —
  // but the mock still needs a shape to satisfy the hook's return type.
  mockResolveName.mockReturnValue({ data: undefined, isPending: true, isError: false })
  mockUseCollection.mockReturnValue({ data: undefined, isPending: false, isError: false })

  const { history } = renderAt('/1337/Foo')

  await waitFor(() => expect(history.at(-1)).toBe('/1337/foo'))
})
