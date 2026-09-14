/**
 * The EXEC404 swap panel shows the floor it is actually signing at, and admits how much the
 * approval hands over. Same two defects as the graduated ERC-404 surface, in the fossil's panel:
 *
 *  - `minOut` is the `amountLimit` the swap is signed with — below it the transaction reverts — and
 *    it was computed, sent on the wire, and never rendered. The only figure on screen was the
 *    mid-quote. That gap matters more here than anywhere else in the app, because EXEC carries a
 *    ~4% transfer tax and therefore ships a DEFAULT 6% tolerance: the number the trader reads and
 *    the number they are protected at are always several percent apart, before they touch the box.
 *  - The panel said nothing at all about the approval, which is `approve(zRouter, maxUint256)`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { Exec404SwapPanel } from './Exec404SwapPanel'

const TRADER = '0x7777777777777777777777777777777777777777' as const

// 1000 whole EXEC quoted out — large enough that the 6% default moves the figure well clear of
// `formatTokenAmount`'s 4 fractional digits, so the two rows cannot coincide by rounding.
const QUOTE_OUT = 1_000n * 10n ** 18n

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ address: TRADER, isConnected: true }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
  // Allowance and balance both read through this; zero allowance parks a sell on the approve step.
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data: functionName === 'allowance' ? 0n : QUOTE_OUT,
    refetch: vi.fn(),
  }),
  useWriteContract: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
}))

vi.mock('../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generated/contracts')>()),
  // swapV2 simulates to (amountIn, amountOut) — index 1 is what the trader receives.
  useSimulateZRouterSwapV2: () => ({
    data: { result: [1n, QUOTE_OUT] },
    error: null,
    isFetching: false,
  }),
  useWriteZRouterSwapV2: () => ({
    data: undefined,
    error: null,
    isPending: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
}))

/** Mount the panel and put an amount in the box, which is what enables the quote. */
function mountWithAmount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <Exec404SwapPanel />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByTestId('exec404-amount-input'), { target: { value: '1' } })
}

afterEach(cleanup)

test('the signed floor is on screen in its own row, labelled apart from the quote', () => {
  mountWithAmount()

  const receive = screen.getByTestId('exec404-quote')
  const floor = screen.getByTestId('exec404-min-out')

  expect(receive).not.toBe(floor)
  expect(receive.textContent).toContain('receive')
  expect(floor.textContent).toContain('min received')

  // 1000 EXEC quoted, 6% default tolerance → a 940 EXEC floor, and it is the SMALLER of the two.
  expect(receive.textContent).toContain('1000 EXEC')
  expect(floor.textContent).toContain('940 EXEC')
  expect(floor.textContent).not.toContain('1000 EXEC')
})

test('a wider tolerance moves the floor on screen while the quote stays put', () => {
  mountWithAmount()

  fireEvent.change(screen.getByTestId('exec404-slippage-input'), { target: { value: '25' } })

  expect(screen.getByTestId('exec404-quote').textContent).toContain('1000 EXEC')
  expect(screen.getByTestId('exec404-min-out').textContent).toContain('750 EXEC')
})

test('the panel says the approval it requests is an unlimited standing allowance', () => {
  mountWithAmount()

  fireEvent.click(screen.getByTestId('exec404-direction-sell'))
  expect(screen.getByTestId('exec404-approve')).toBeTruthy()

  const surface = screen.getByTestId('exec404-swap').textContent ?? ''
  expect(surface).toContain('unlimited')
  expect(surface).toContain('until you revoke it')
})
