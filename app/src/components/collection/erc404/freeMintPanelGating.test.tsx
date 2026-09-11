/**
 * The free-mint panel offers the claim only where `claimFreeMint` would take it.
 *
 * `ERC404BondingOps.claimFreeMint` refuses in three states the panel used to render identically to
 * a claimable one — an enabled button under the line "you have an unclaimed free allocation":
 *
 *  - `BondingNotConfigured`, while `bondingOpenTime` is still 0 and no date has been set;
 *  - `TooEarly`, at any time before `bondingOpenTime`;
 *  - `FreeMintExhausted`, once `freeMintsClaimed` reaches `freeMintAllocation`.
 *
 * The first two were invisible because the panel took `bondingOpenTime` as a prop and never read
 * it. The third was invisible because it read only `freeMintClaimed(wallet)` — this wallet's own
 * flag, which says nothing about a pool shared with everyone else's.
 *
 * These cases assert the RENDERED DOM and the button's enabled state, because the defect is what a
 * visitor can read and press before they spend gas on a revert.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { FreeMintPanel } from './FreeMintPanel'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const CLAIMER = '0x7777777777777777777777777777777777777777' as const

const NOW = 1_000_000n
const OPEN_LATER = NOW + 3_600n
const OPEN_ALREADY = NOW - 3_600n
const ALLOCATION = 50n

/** Chain state the mocked reads answer from; each case sets what it is about before mounting. */
const chain = { allocation: ALLOCATION, poolClaimed: 0n }

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useAccount: () => ({ address: CLAIMER, isConnected: true }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc404BondingInstanceFreeMintAllocation: () => ({ data: chain.allocation }),
  useReadErc404BondingInstanceFreeMintClaimed: () => ({ data: false, refetch: vi.fn() }),
  useReadErc404BondingInstanceFreeMintsClaimed: () => ({ data: chain.poolClaimed }),
  useWriteErc404BondingInstanceClaimFreeMint: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    reset: vi.fn(),
    writeContract: vi.fn(),
  }),
}))

vi.mock('../useCollectionChain', () => ({ useCollectionChainId: () => 1337 }))
vi.mock('./useNowSec', () => ({ useNowSec: () => NOW }))
vi.mock('./useMerkleAllowlist', () => ({
  useMerkleAllowlistProof: () => ({ status: 'eligible', proof: [], maxQty: 1n, maxQtyNfts: 1n }),
}))

afterEach(() => {
  cleanup()
  chain.allocation = ALLOCATION
  chain.poolClaimed = 0n
})

function mount(bondingOpenTime: bigint): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FreeMintPanel
        instance={INSTANCE}
        bondingOpenTime={bondingOpenTime}
        gatingActive={false}
        refetch={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

const claimButton = (): HTMLButtonElement =>
  screen.getByTestId('erc404-freemint-claim') as HTMLButtonElement

test('an open curve with allocation left offers the claim', () => {
  mount(OPEN_ALREADY)
  expect(claimButton().disabled).toBe(false)
  expect(screen.getByText(/unclaimed free allocation/i)).toBeTruthy()
  expect(screen.queryByTestId('erc404-freemint-preopen')).toBeNull()
  expect(screen.queryByTestId('erc404-freemint-exhausted')).toBeNull()
})

test('before the curve opens the claim is disabled and the panel says when it opens', () => {
  mount(OPEN_LATER)
  expect(claimButton().disabled).toBe(true)
  expect(screen.getByTestId('erc404-freemint-preopen').textContent).toMatch(/not yet claimable/i)
})

test('an unset open time is not treated as open at the epoch', () => {
  // `bondingOpenTime === 0n` is `BondingNotConfigured`, not "opened long ago" — a `now >= openTime`
  // comparison alone would call it open and re-enable the button this test exists to keep disabled.
  mount(0n)
  expect(claimButton().disabled).toBe(true)
  expect(screen.getByTestId('erc404-freemint-unconfigured').textContent).toMatch(/no date is set/i)
})

test('an exhausted pool says claimed out rather than claiming an allocation is waiting', () => {
  chain.poolClaimed = ALLOCATION
  mount(OPEN_ALREADY)
  expect(claimButton().disabled).toBe(true)
  expect(screen.getByTestId('erc404-freemint-exhausted').textContent).toMatch(/claimed out/i)
  expect(screen.queryByText(/you have an unclaimed free allocation/i)).toBeNull()
})

test('a pool counted past its allocation is still exhausted, not wrapped back to available', () => {
  chain.poolClaimed = ALLOCATION + 1n
  mount(OPEN_ALREADY)
  expect(claimButton().disabled).toBe(true)
  expect(screen.getByTestId('erc404-freemint-exhausted')).toBeTruthy()
})

test('a pool with one left is still claimable', () => {
  chain.poolClaimed = ALLOCATION - 1n
  mount(OPEN_ALREADY)
  expect(claimButton().disabled).toBe(false)
  expect(screen.queryByTestId('erc404-freemint-exhausted')).toBeNull()
})
