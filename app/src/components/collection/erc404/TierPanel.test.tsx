/**
 * TierPanel — self-hiding, id-eligibility, and claim-affordance behavior (noesis-171). The chain
 * reads (`useTierPosition`, `useErc404OwnedPieces`) and the write hooks are mocked; what is under
 * test is what a holder is shown and offered.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { OwnedPiece } from './useErc404OwnedPieces'
import type { TierPosition, TierPositionBandPiece } from './useTierPosition'
import type { TierBand } from './tierPosition'
import { TierPanel } from './TierPanel'

const UNIT = 1_000_000_000_000_000_000n

const mockTierPosition = vi.hoisted(() => vi.fn<() => TierPosition>())
vi.mock('./useTierPosition', () => ({ useTierPosition: mockTierPosition }))

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

let connected = true
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: connected ? '0x1111111111111111111111111111111111111111' : undefined,
    isConnected: connected,
  }),
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
    useWriteErc404BondingInstanceMintUp: write,
    useWriteErc404BondingInstanceMintDown: write,
    useWriteErc404BondingInstanceClaimReleasedEscrow: write,
  }
})

vi.mock('../useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

const INSTANCE = '0x2222222222222222222222222222222222222222' as const

function ladder(weights: bigint[]): TierBand[] {
  let start = 5001n
  return weights.map((weight) => {
    const idStart = start
    const idEnd = start
    start += 1n
    return { idStart, idEnd, weight }
  })
}

function mountPosition(opts: {
  tiered: boolean
  ladder?: TierBand[]
  bandPieces?: TierPositionBandPiece[]
  pendingEscrowRelease?: bigint
  isPending?: boolean
  balance?: bigint
}) {
  mockTierPosition.mockReturnValue({
    tiered: opts.tiered,
    ladder: opts.ladder ?? [],
    bandPieces: opts.bandPieces ?? [],
    balance: opts.balance ?? 10n * UNIT,
    holdings: 12n * UNIT,
    localHoldings: 12n * UNIT,
    pendingEscrowRelease: opts.pendingEscrowRelease,
    isPending: opts.isPending ?? false,
    refetch: vi.fn(),
  })
}

function mountOwned(pieces: OwnedPiece[]) {
  mockOwnedPieces.mockReturnValue({
    pieces,
    unit: UNIT,
    idLimit: 5000n,
    balance: 10n * UNIT,
    isPending: false,
    refetch: vi.fn(),
  })
}

const ordinary = (id: bigint): OwnedPiece => ({ id, image: undefined, isTier: false })
const tier = (id: bigint): OwnedPiece => ({ id, image: undefined, isTier: true })

afterEach(() => {
  cleanup()
  connected = true
  mockTierPosition.mockReset()
  mockOwnedPieces.mockReset()
})

test('renders nothing on an untiered instance', () => {
  mountPosition({ tiered: false })
  mountOwned([ordinary(1n)])
  render(<TierPanel instance={INSTANCE} />)
  expect(screen.queryByTestId('erc404-tier-panel')).not.toBeInTheDocument()
})

test('renders nothing while disconnected', () => {
  connected = false
  mountPosition({ tiered: true, ladder: ladder([2n]) })
  mountOwned([ordinary(1n)])
  render(<TierPanel instance={INSTANCE} />)
  expect(screen.queryByTestId('erc404-tier-panel')).not.toBeInTheDocument()
})

test('renders nothing while the ladder probe is still pending', () => {
  mountPosition({ tiered: false, isPending: true })
  mountOwned([ordinary(1n)])
  render(<TierPanel instance={INSTANCE} />)
  expect(screen.queryByTestId('erc404-tier-panel')).not.toBeInTheDocument()
})

test('mint-up id picker offers only non-band owned ids', () => {
  mountPosition({ tiered: true, ladder: ladder([2n, 3n]) })
  mountOwned([ordinary(1n), ordinary(2n), tier(5001n)])

  render(<TierPanel instance={INSTANCE} />)

  const select = screen.getByTestId('tier-panel-zero-id-select')
  const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
  expect(options).toContain('#1')
  expect(options).toContain('#2')
  expect(options).not.toContain('#5001')
})

test('mint-down picker offers only owned band ids', () => {
  mountPosition({
    tiered: true,
    ladder: ladder([2n, 3n]),
    bandPieces: [{ id: 5001n, tierN: 1, weight: 2n }],
  })
  mountOwned([ordinary(1n), tier(5001n)])

  render(<TierPanel instance={INSTANCE} />)

  const select = screen.getByTestId('tier-panel-band-select')
  const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
  expect(options.some((o) => o?.includes('#5001'))).toBe(true)
  expect(options.some((o) => o?.includes('#1)'))).toBe(false)
})

test('claim affordance shows only when pendingEscrowRelease is non-zero', () => {
  mountPosition({ tiered: true, ladder: ladder([2n]), pendingEscrowRelease: 0n })
  mountOwned([ordinary(1n)])
  const { rerender } = render(<TierPanel instance={INSTANCE} />)
  expect(screen.queryByTestId('tier-panel-claim')).not.toBeInTheDocument()

  mountPosition({ tiered: true, ladder: ladder([2n]), pendingEscrowRelease: 3n * UNIT })
  rerender(<TierPanel instance={INSTANCE} />)
  expect(screen.getByTestId('tier-panel-claim')).toBeEnabled()
})

test('mint up is refused, in words, when the escrow exceeds the transferable balance', () => {
  // Tier 1 at weight 100 escrows 99 units; the holder can transfer 10. On-chain this reverts in
  // mintUp's first leg and reaches the user as the causeless `TierOpFailed()`, so it must be
  // refused here instead.
  mountPosition({ tiered: true, ladder: ladder([100n]), balance: 10n * UNIT })
  mountOwned([ordinary(1n)])

  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('tier-panel-zero-id-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-mint-up-short')).toHaveTextContent(
    /not enough transferable/i,
  )
  expect(screen.getByTestId('tier-panel-mint-up')).toBeDisabled()
})

test('mint up stays available when the balance covers the escrow', () => {
  // Same shape, affordable: weight 2 escrows 1 unit against a 10-unit balance.
  mountPosition({ tiered: true, ladder: ladder([2n]), balance: 10n * UNIT })
  mountOwned([ordinary(1n)])

  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('tier-panel-zero-id-select'), { target: { value: '1' } })

  expect(screen.queryByTestId('tier-panel-mint-up-short')).toBeNull()
  expect(screen.getByTestId('tier-panel-mint-up')).not.toBeDisabled()
})
