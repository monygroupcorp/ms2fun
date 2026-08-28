/**
 * FeaturedPanel — the closed Boost control's summary indicator (noesis-429). The chain reads are
 * mocked; what is under test is what the CLOSED Disclosure summary shows for the three states —
 * featured, expired, and never-featured — without opening the panel.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { FeaturedPanel } from './FeaturedPanel'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const

const mockGetRentalInfo = vi.hoisted(() => vi.fn())

vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../generated/contracts', () => ({
  featuredQueueManagerAbi: [],
  useReadFeaturedQueueManagerGetRentalInfo: mockGetRentalInfo,
  useReadFeaturedQueueManagerQuoteDurationCost: () => ({ data: undefined }),
}))

afterEach(() => {
  cleanup()
  mockGetRentalInfo.mockReset()
})

const RENTER = '0x2222222222222222222222222222222222222222' as const

function mount(rental: readonly [string, bigint, bigint, boolean] | undefined) {
  mockGetRentalInfo.mockReturnValue({ data: rental, refetch: vi.fn() })
  return render(<FeaturedPanel instance={INSTANCE} />)
}

test('a featured slot shows a featured badge on the closed control', () => {
  const future = BigInt(Math.floor(Date.now() / 1000) + 100_000)
  mount([RENTER, 3n, future, true])

  const badge = screen.getByTestId('featured-summary-badge')
  expect(badge).toHaveTextContent(/featured/i)
})

test('an expired slot shows an expired badge, distinct from featured', () => {
  const past = BigInt(Math.floor(Date.now() / 1000) - 100_000)
  mount([RENTER, 3n, past, true])

  const badge = screen.getByTestId('featured-summary-badge')
  expect(badge).toHaveTextContent(/expired/i)
})

test('a never-featured collection shows no badge on the closed control', () => {
  mount([RENTER, 0n, 0n, false])

  expect(screen.queryByTestId('featured-summary-badge')).not.toBeInTheDocument()
  expect(screen.getByTestId('featured-panel')).toHaveTextContent('BOOST')
})
