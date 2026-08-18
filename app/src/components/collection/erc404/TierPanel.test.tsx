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

// The shared invalidation seam (noesis-352) needs a QueryClient; these tests aren't exercising
// caching, so a stub with a spy-able `invalidateQueries` is enough (no QueryClientProvider needed).
const mockInvalidateQueries = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

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
  ownedOrder?: readonly bigint[] | undefined
  orderPending?: boolean
}) {
  mockTierPosition.mockReturnValue({
    tiered: opts.tiered,
    ladder: opts.ladder ?? [],
    bandPieces: opts.bandPieces ?? [],
    // `ownedIdsOf` order (noesis-356). Ten entries by default, matching the ten-unit balance below:
    // DN404 keeps `ownedLength == balance / unit`, so a mock that disagreed would model a position
    // the chain cannot hold.
    ownedOrder: opts.orderPending
      ? undefined
      : (opts.ownedOrder ?? [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]),
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
  mountPosition({ tiered: true, ladder: ladder([2n, 3n]), ownedOrder: [1n, 2n, 5001n] })
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

// ── The sacrifice preview (noesis-356) ────────────────────────────────────────────────────────────

const ORDER_8 = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]
const PIECES_8 = ORDER_8.map((id) => ({ id, image: `ipfs://art/${id}`, isTier: false }))

function mountWeight5() {
  // Weight 5 escrows 4 units, so the escrow leg burns the last 4 of the 8 owned pieces; ids 1-4 are
  // outside that tail and therefore selectable.
  mountPosition({ tiered: true, ladder: ladder([5n]), ownedOrder: ORDER_8, balance: 10n * UNIT })
  mockOwnedPieces.mockReturnValue({
    pieces: PIECES_8,
    unit: UNIT,
    idLimit: 5000n,
    balance: 10n * UNIT,
    isPending: false,
    refetch: vi.fn(),
  })
}

test('mint up names one id and shows all five pieces that leave, as art', () => {
  mountWeight5()
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  const tiles = screen.getAllByTestId('tier-panel-sacrifice-tile')
  expect(tiles).toHaveLength(5)
  // The named id plus the burn tail, in owned-array order — not a set, and not a list of numbers.
  expect(tiles.map((t) => t.textContent)).toEqual([
    expect.stringContaining('#1'),
    expect.stringContaining('#5'),
    expect.stringContaining('#6'),
    expect.stringContaining('#7'),
    expect.stringContaining('#8'),
  ])
  expect(screen.getByTestId('tier-panel-sacrifice').querySelectorAll('img')).toHaveLength(5)
})

test('mint up defaults to a low-index id the burn tail cannot reach', () => {
  mountWeight5()
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-zero-id-select')).toHaveValue('1')
  expect(screen.getByTestId('tier-panel-mint-up')).not.toBeDisabled()
})

test('mint up refuses a tail id in words rather than letting it revert', () => {
  mountWeight5()
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('tier-panel-zero-id-select'), { target: { value: '8' } })

  expect(screen.getByTestId('tier-panel-mint-up-tail-id')).toBeInTheDocument()
  expect(screen.getByTestId('tier-panel-mint-up')).toBeDisabled()
  expect(screen.queryByTestId('tier-panel-sacrifice')).toBeNull()
})

test('mint up refuses outright when every ordinary id sits in the burn tail', () => {
  // Exactly `weight` pieces held: the tail is everything but index 0, and index 0 is a band.
  mountPosition({
    tiered: true,
    ladder: ladder([5n]),
    ownedOrder: [5001n, 2n, 3n, 4n, 5n],
    balance: 10n * UNIT,
  })
  mockOwnedPieces.mockReturnValue({
    pieces: [tier(5001n), ordinary(2n), ordinary(3n), ordinary(4n), ordinary(5n)],
    unit: UNIT,
    idLimit: 5000n,
    balance: 10n * UNIT,
    isPending: false,
    refetch: vi.fn(),
  })
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-mint-up-no-safe-id')).toBeInTheDocument()
  expect(screen.getByTestId('tier-panel-mint-up')).toBeDisabled()
})

test('the sacrifice set states that pinned art travels with the id', () => {
  mountWeight5()
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-sacrifice-fate')).toHaveTextContent(
    /commission already paid for is not cleared/i,
  )
})

test('band holding is disclosed as conditional before a band is ever minted', () => {
  mountWeight5()
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-band-permanence')).toHaveTextContent(
    /most recently minted one sits in the protected slot/i,
  )
})

test('mint up waits for the owned-order read rather than offering a call it cannot describe', () => {
  mountPosition({ tiered: true, ladder: ladder([2n]), balance: 10n * UNIT, orderPending: true })
  mountOwned([ordinary(1n)])
  render(<TierPanel instance={INSTANCE} />)
  fireEvent.change(screen.getByTestId('tier-panel-tier-select'), { target: { value: '1' } })

  expect(screen.getByTestId('tier-panel-order-pending')).toBeInTheDocument()
  expect(screen.getByTestId('tier-panel-mint-up')).toBeDisabled()
})
