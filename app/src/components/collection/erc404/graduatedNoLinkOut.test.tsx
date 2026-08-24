/**
 * The graduated surface offers a TRADE, never a redirect (noesis-349).
 *
 * Before this, a graduated collection whose venue was not one of the two zRouter-native ones
 * rendered a link to an unrelated exchange, with the chain hardcoded into the URL. Two things were
 * wrong with that at once: a Cypher-graduated token has no pool on that exchange, so the link is a
 * dead end; and the URL named a chain regardless of which chain the collection was being rendered
 * on. These cases pin both away — a resolvable venue trades in site, and an unresolvable one says so
 * in words with no outbound trade link anywhere on the surface.
 *
 * The assertions are deliberately about the RENDERED DOM rather than about a component's props: an
 * `href` to somebody else's exchange is the defect, wherever in the tree it comes from.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BondingView } from './bondingPhase'
import { BondingSurface } from './BondingSurface'
import type { GraduatedVenue } from './useGraduatedVenue'

const NOW = 1_000_000n
const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const DEPLOYER = '0x3333333333333333333333333333333333333333' as const
const POOL = '0x4444444444444444444444444444444444444444' as const
const WETH = '0x5555555555555555555555555555555555555555' as const
const ROUTER = '0x6666666666666666666666666666666666666666' as const
const TRADER = '0x7777777777777777777777777777777777777777' as const

const venueRef = vi.hoisted(() => ({ current: undefined as GraduatedVenue | undefined }))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ address: TRADER, isConnected: true }),
  usePublicClient: () => ({
    getBlockNumber: async () => 1_000n,
    getContractEvents: async () => [],
  }),
  useWaitForTransactionReceipt: () => ({ data: undefined }),
  useSimulateContract: () => ({ data: undefined, error: null, isFetching: false }),
  useWriteContract: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
}))

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc404BondingInstanceDecimals: () => ({ data: 18 }),
  useReadErc404BondingInstanceGatingActive: () => ({ data: false }),
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps: () => ({ data: 0 }),
  useReadErc404BondingInstanceSymbol: () => ({ data: 'DEMO' }),
  useReadErc404BondingInstanceAllowance: () => ({ data: 0n, refetch: vi.fn() }),
  useReadErc404BondingInstanceBalanceOf: () => ({ data: 0n, refetch: vi.fn() }),
  useSimulateZRouterSwapV4: () => ({ data: undefined, error: null, isFetching: false }),
  useSimulateZRouterSwapVz: () => ({ data: undefined, error: null, isFetching: false }),
  useWriteErc404BondingInstanceApprove: () => ({ isPending: false, writeContract: vi.fn() }),
  useWriteZRouterSwapV4: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
  useWriteZRouterSwapVz: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
}))

// A collection rendered on the local fork chain — deliberately NOT mainnet, so any URL that names a
// chain of its own is visibly naming the wrong one.
vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionAddresses: () => ({ zRouter: ROUTER, CypherSwapRouter: ROUTER }),
}))

vi.mock('./useBondingData', () => ({
  useBondingData: () => ({
    view: {
      bondingActive: false,
      bondingOpenTime: NOW - 100n,
      bondingMaturityTime: NOW - 50n,
      graduated: true,
      totalBondingSupply: 1000n,
      maxSupply: 1000n,
    } satisfies BondingView,
    curveParams: undefined,
    unit: 1n,
    feeBps: 0,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('./useNowSec', () => ({ useNowSec: () => NOW }))
vi.mock('./useCurveComputer', () => ({
  useCurveComputer: () => ({ address: undefined, isPending: false }),
}))
vi.mock('./useGraduatedVenue', () => ({
  useGraduatedVenue: () => ({ venue: venueRef.current, isPending: false }),
}))
vi.mock('./SwapPanel', () => ({ SwapPanel: () => null }))
vi.mock('./FreeMintPanel', () => ({ FreeMintPanel: () => null }))
vi.mock('./StakingPanel', () => ({ StakingPanel: () => null }))
vi.mock('../../../lib/carveReceipt', () => ({
  useCarveSettlement: () => ({ data: undefined, isPending: false, isError: true }),
}))

function mount(venue: GraduatedVenue): HTMLElement {
  venueRef.current = venue
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <BondingSurface instance={INSTANCE} />
    </QueryClientProvider>,
  )
  return container
}

/** Every `href` the graduated surface renders, whatever element carries it. */
function renderedHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[href]')).map((el) => el.getAttribute('href') ?? '')
}

const CYPHER: GraduatedVenue = { kind: 'cypher', deployer: DEPLOYER, pool: POOL, weth: WETH }
const UNI: GraduatedVenue = { kind: 'uniV4', deployer: DEPLOYER, poolFee: 3000, tickSpacing: 60 }
const ZAMM: GraduatedVenue = { kind: 'zamm', deployer: DEPLOYER, feeOrHook: 100n }
const UNKNOWN: GraduatedVenue = { kind: 'unknown', deployer: DEPLOYER }

beforeEach(() => {
  venueRef.current = undefined
})
afterEach(cleanup)

test('a cypher venue renders the embedded swap panel, not a link to another exchange', () => {
  const container = mount(CYPHER)
  expect(screen.getByTestId('erc404-graduated-swap')).toBeTruthy()
  expect(screen.queryByTestId('erc404-graduated-no-route')).toBeNull()
  for (const href of renderedHrefs(container)) {
    expect(href).not.toContain('app.uniswap.org')
  }
})

test('an unresolvable venue says so and offers no exchange link at all', () => {
  const container = mount(UNKNOWN)
  const note = screen.getByTestId('erc404-graduated-no-route')
  expect(note.textContent).toContain('graduated to a pool we can’t resolve yet')
  expect(screen.queryByTestId('erc404-graduated-swap')).toBeNull()
  expect(renderedHrefs(container)).toEqual([])
})

test('no rendered href names a chain — on a non-mainnet collection or on any other', () => {
  for (const venue of [CYPHER, UNI, ZAMM, UNKNOWN]) {
    const container = mount(venue)
    for (const href of renderedHrefs(container)) {
      expect(href).not.toContain('chain=mainnet')
      expect(href).not.toContain('app.uniswap.org')
    }
    cleanup()
  }
})

test('each venue is named from its own kind rather than falling through to another', () => {
  const expected: Array<[GraduatedVenue, string]> = [
    [UNI, 'Uniswap V4 pool'],
    [ZAMM, 'ZAMM pool'],
    [CYPHER, 'Cypher pool'],
  ]
  for (const [venue, label] of expected) {
    mount(venue)
    expect(screen.getByTestId('erc404-graduated-venue-label').textContent).toBe(label)
    cleanup()
  }
})
