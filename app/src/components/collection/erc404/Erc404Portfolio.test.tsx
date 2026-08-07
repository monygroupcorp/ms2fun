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
      isPending: boolean
      refetch: () => void
    }
  >(),
)
vi.mock('./useErc404OwnedPieces', () => ({ useErc404OwnedPieces: mockOwnedPieces }))

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
    useWriteErc404BondingInstanceRerollSelectedNfTs: write,
    useWriteErc404BondingInstanceSetSkipNft: write,
  }
})

vi.mock('../useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

const INSTANCE = '0x2222222222222222222222222222222222222222' as const

function mount(pieces: OwnedPiece[]) {
  mockOwnedPieces.mockReturnValue({
    pieces,
    unit: UNIT,
    idLimit: 5000n,
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
