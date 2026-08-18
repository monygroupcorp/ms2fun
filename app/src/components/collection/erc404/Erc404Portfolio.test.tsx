/**
 * Erc404Portfolio — the three tier-aware holder surfaces (noesis-159). The chain reads and the
 * owned-pieces replay are mocked; what is under test is what a holder is shown and whether the
 * submit is reachable.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { OwnedPiece } from './useErc404OwnedPieces'
import { Erc404Portfolio } from './Erc404Portfolio'

const UNIT = 1_000_000_000_000_000_000n

const mockOwnedPieces = vi.hoisted(() =>
  vi.fn<
    () => {
      pieces: OwnedPiece[]
      unit: bigint | undefined
      idLimit: bigint | undefined
      balance: bigint | undefined
      isPending: boolean
      refetch: () => void
    }
  >(),
)
vi.mock('./useErc404OwnedPieces', () => ({ useErc404OwnedPieces: mockOwnedPieces }))

interface MockBandPiece {
  id: bigint
  tierN: number
  weight: bigint
}

// noesis-172: mocked directly (per the item spec) rather than the chain reads underneath it —
// this component only consumes `bandPieces`.
const mockTierPosition = vi.hoisted(() =>
  vi.fn<
    () => {
      tiered: boolean
      ladder: unknown[]
      bandPieces: MockBandPiece[]
      balance: bigint | undefined
      holdings: bigint | undefined
      localHoldings: bigint | undefined
      pendingEscrowRelease: bigint | undefined
      isPending: boolean
      refetch: () => void
    }
  >(),
)
vi.mock('./useTierPosition', () => ({ useTierPosition: mockTierPosition }))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111', isConnected: true }),
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isLoading: false }),
}))

vi.mock('../../../generated/contracts', () => {
  const write = () => ({
    writeContract: vi.fn(),
    reset: vi.fn(),
    data: undefined,
    error: null,
    isPending: false,
  })
  return {
    useReadErc404BondingInstanceDecimals: () => ({ data: 18 }),
    useReadErc404BondingInstanceGetSkipNft: () => ({ data: false, refetch: vi.fn() }),
    useReadErc404BondingInstanceBalanceOf: () => ({ data: undefined }),
    useWriteErc404BondingInstanceRerollSelectedNfTs: write,
    useWriteErc404BondingInstanceSetSkipNft: write,
  }
})

vi.mock('../useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

// The shared invalidation seam (noesis-352) needs a QueryClient; these tests aren't exercising
// caching, so a stub with a spy-able `invalidateQueries` is enough (no QueryClientProvider needed).
const mockInvalidateQueries = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

const INSTANCE = '0x2222222222222222222222222222222222222222' as const

function mount(
  pieces: OwnedPiece[],
  opts: { balance?: bigint; bandPieces?: MockBandPiece[] } = {},
) {
  mockOwnedPieces.mockReturnValue({
    pieces,
    unit: UNIT,
    idLimit: 5000n,
    balance: opts.balance,
    isPending: false,
    refetch: vi.fn(),
  })
  mockTierPosition.mockReturnValue({
    tiered: (opts.bandPieces?.length ?? 0) > 0,
    ladder: [],
    bandPieces: opts.bandPieces ?? [],
    balance: opts.balance,
    holdings: undefined,
    localHoldings: undefined,
    pendingEscrowRelease: undefined,
    isPending: false,
    refetch: vi.fn(),
  })
  return render(<Erc404Portfolio instance={INSTANCE} />)
}

const ordinary = (id: bigint): OwnedPiece => ({ id, image: undefined, isTier: false })
const tier = (id: bigint): OwnedPiece => ({ id, image: undefined, isTier: true })

afterEach(() => {
  cleanup()
  mockOwnedPieces.mockReset()
  mockTierPosition.mockReset()
})

test('a tier NFT renders as a protected, non-interactive tile', () => {
  mount([ordinary(1n), ordinary(2n), tier(9001n)])

  const tierTiles = screen.getAllByTestId('erc404-portfolio-tile-tier')
  expect(tierTiles).toHaveLength(1)
  const tierTile = tierTiles[0]!
  expect(tierTile).toHaveTextContent('#9001')
  expect(tierTile).toHaveTextContent(/protected/i)
  // Not a keep toggle: it carries no button role, because the exemption is on-chain.
  expect(tierTile.tagName).not.toBe('BUTTON')
  // The ordinary pieces stay selectable.
  expect(screen.getAllByTestId('erc404-portfolio-tile')).toHaveLength(2)
})

test('a 3-unit request with one tier NFT held reports 2 ordinary pieces rerolled', () => {
  mount([ordinary(1n), ordinary(2n), ordinary(3n), tier(9001n)])

  fireEvent.change(screen.getByTestId('erc404-reroll-amount'), { target: { value: '3' } })

  const readout = screen.getByTestId('erc404-reroll-effective')
  expect(readout).toHaveTextContent('Rerolls 2 ordinary pieces')
  expect(readout).toHaveTextContent('1 exempt')
  expect(screen.getByTestId('erc404-reroll')).toBeEnabled()
})

test('an all-tier position disables reroll and explains why instead of letting it revert', () => {
  mount([tier(9001n), tier(9002n)])

  expect(screen.getByTestId('erc404-reroll')).toBeDisabled()
  const readout = screen.getByTestId('erc404-reroll-effective')
  expect(readout).toHaveTextContent(/every piece you hold is a tier nft/i)
  expect(readout).toHaveTextContent(/mintDown/)
})

test('an amount above the held balance disables reroll and states the shortfall', () => {
  mount([ordinary(1n), ordinary(2n), ordinary(3n)], { balance: 2n * UNIT })

  fireEvent.change(screen.getByTestId('erc404-reroll-amount'), { target: { value: '3' } })

  expect(screen.getByTestId('erc404-reroll')).toBeDisabled()
  const readout = screen.getByTestId('erc404-reroll-effective')
  expect(readout).toHaveTextContent('You entered 3')
  expect(readout).toHaveTextContent('hold 2')
})

test('a band tile shows its tier and denomination', () => {
  mount([ordinary(1n), tier(9001n)], { bandPieces: [{ id: 9001n, tierN: 2, weight: 3n }] })

  const tierTile = screen.getByTestId('erc404-portfolio-tile-tier')
  // weight 3 * unit 1 = 3 whole tokens: the one unit the NFT already is, plus 2 units of escrow.
  expect(tierTile).toHaveTextContent(/protected/i)
  expect(tierTile).toHaveTextContent('tier 2')
  expect(tierTile).toHaveTextContent('worth 3')
})

test('an untiered position renders no denomination chrome', () => {
  mount([ordinary(1n), ordinary(2n)])

  expect(screen.queryAllByTestId('erc404-portfolio-tile-tier')).toHaveLength(0)
  expect(screen.queryByText(/worth/i)).not.toBeInTheDocument()
})
