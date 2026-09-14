/**
 * The graduated swap surface shows the trader the floor it is actually signing at, and admits how
 * much of their token the approval hands over.
 *
 * Two separate ways the panel used to understate what a trade commits to:
 *
 *  - It rendered ONE number, `receive`, which is the mid-quote. The amount the swap is actually
 *    signed with is `minOut` — the `amountLimit` below which the transaction reverts, and therefore
 *    the only figure the trader is protected at. It was computed, sent on the wire, and never put
 *    on screen, so a trader with a wide slippage box could accept far less than the quote they read
 *    and never see the number they had agreed to.
 *  - The approve copy said "approve {symbol} once", which reads as a one-trade permission. The call
 *    is `approve(router, maxUint256)` — an unlimited, standing allowance.
 *
 * These cases assert the RENDERED DOM rather than the props: the defect is what the trader can read
 * before they sign, wherever in the tree it comes from.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { BondingView } from './bondingPhase'
import { BondingSurface } from './BondingSurface'
import type { GraduatedVenue } from './useGraduatedVenue'

const NOW = 1_000_000n
const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const DEPLOYER = '0x3333333333333333333333333333333333333333' as const
const ROUTER = '0x6666666666666666666666666666666666666666' as const
const TRADER = '0x7777777777777777777777777777777777777777' as const

// 1000 whole tokens quoted out. Big enough that the default 1% tolerance moves the figure by more
// than `formatTokenAmount`'s 4 fractional digits, so "receive" and "min received" cannot coincide
// by rounding and the assertion below is about the math rather than about the formatter.
const QUOTE_OUT = 1_000n * 10n ** 18n

// The seller's allowance is zero, so the sell direction sits on the approve step.
const ALLOWANCE = 0n

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
  useReadErc404BondingInstanceAllowance: () => ({ data: ALLOWANCE, refetch: vi.fn() }),
  useReadErc404BondingInstanceBalanceOf: () => ({ data: QUOTE_OUT, refetch: vi.fn() }),
  useSimulateZRouterSwapV4: () => ({ data: undefined, error: null, isFetching: false }),
  // The zamm venue quotes through swapVZ, which returns (amountIn, amountOut).
  useSimulateZRouterSwapVz: () => ({
    data: { result: [1n, QUOTE_OUT] },
    error: null,
    isFetching: false,
  }),
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
  useGraduatedVenue: () => ({ venue: ZAMM, isPending: false }),
}))
vi.mock('./SwapPanel', () => ({ SwapPanel: () => null }))
vi.mock('./FreeMintPanel', () => ({ FreeMintPanel: () => null }))
vi.mock('./StakingPanel', () => ({ StakingPanel: () => null }))
vi.mock('../../../lib/carveReceipt', () => ({
  useCarveSettlement: () => ({ data: undefined, isPending: false, isError: true }),
}))

const ZAMM: GraduatedVenue = { kind: 'zamm', deployer: DEPLOYER, feeOrHook: 100n }

/** Mount the graduated surface and put an amount in the box, which is what enables the quote. */
function mountWithAmount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <BondingSurface instance={INSTANCE} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByTestId('erc404-graduated-amount-input'), {
    target: { value: '1' },
  })
}

afterEach(cleanup)

test('the floor the swap is signed at is on screen, in its own row, not folded into the quote', () => {
  mountWithAmount()

  const receive = screen.getByTestId('erc404-graduated-quote')
  const floor = screen.getByTestId('erc404-graduated-min-out')

  // Two distinct rows, labelled apart — a trader must be able to tell which number is which.
  expect(receive).not.toBe(floor)
  expect(receive.textContent).toContain('receive')
  expect(floor.textContent).toContain('min received')
  expect(floor.textContent).not.toContain('receive ')

  // 1000 DEMO quoted, default 1% tolerance → the signed floor is 990 DEMO, and it is the SMALLER
  // of the two. If the panel ever renders the mid-quote in this row the second assertion fails.
  expect(receive.textContent).toContain('1000 DEMO')
  expect(floor.textContent).toContain('990 DEMO')
  expect(floor.textContent).not.toContain('1000 DEMO')
})

test('a wider tolerance moves the signed floor on screen, so the box has a visible consequence', () => {
  mountWithAmount()

  fireEvent.change(screen.getByTestId('erc404-graduated-slippage-input'), {
    target: { value: '25' },
  })

  // 25% tolerance → 750 DEMO. The quote itself is unchanged; only the floor moves.
  expect(screen.getByTestId('erc404-graduated-quote').textContent).toContain('1000 DEMO')
  expect(screen.getByTestId('erc404-graduated-min-out').textContent).toContain('750 DEMO')
})

test('the approve copy says the allowance it actually requests is unlimited', () => {
  mountWithAmount()

  // Sells are the approve-then-swap direction; the allowance mocked above is zero.
  fireEvent.click(screen.getByTestId('erc404-graduated-direction-sell'))
  expect(screen.getByTestId('erc404-graduated-approve')).toBeTruthy()

  const surface = screen.getByTestId('erc404-graduated-swap').textContent ?? ''
  expect(surface).toContain('unlimited')
  // "once" on its own reads as a single-trade permission; it may stay only if the standing,
  // revocable nature of the grant is said in the same breath.
  expect(surface).toContain('until you revoke it')
})
