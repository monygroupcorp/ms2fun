/**
 * BondingSurface — the post-graduation carve disclosure (noesis-220).
 *
 * The graduated surface is PUBLIC: a buyer who priced the declared carve ceiling in before buying
 * needs to be able to see what actually left the pool, after the fact and from any wallet. That means
 * the figure must come from chain history, not from a transaction in flight — these tests mount with
 * no tx hash anywhere and assert the figure survives a full remount. `useWaitForTransactionReceipt`
 * is spied on precisely so an in-session read can never satisfy this file.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem'
import type { BondingView } from './bondingPhase'
import { BondingSurface } from './BondingSurface'
import { liquidityDeployerModuleAbi } from '../../../generated/contracts'

const NOW = 1_000_000n
const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const CREATOR = '0x2222222222222222222222222222222222222222' as const
const DEPLOYER = '0x3333333333333333333333333333333333333333' as const

const mockGetContractEvents = vi.hoisted(() => vi.fn())
const mockWaitForReceipt = vi.hoisted(() => vi.fn(() => ({ data: undefined })))

vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  usePublicClient: () => ({
    getBlockNumber: async () => 1_000n,
    getContractEvents: mockGetContractEvents,
  }),
  // The whole point of piece 3: the graduated surface must not depend on this.
  useWaitForTransactionReceipt: mockWaitForReceipt,
}))

vi.mock('../../../generated/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../generated/contracts')>()),
  useReadErc404BondingInstanceDecimals: () => ({ data: 18 }),
  useReadErc404BondingInstanceGatingActive: () => ({ data: false }),
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps: () => ({ data: 2500 }),
  useReadErc404BondingInstanceLiquidityDeployer: () => ({ data: DEPLOYER }),
}))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
  useCollectionAddresses: () => ({}),
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
  useGraduatedVenue: () => ({ venue: { kind: 'unknown', deployer: DEPLOYER }, isPending: false }),
}))
vi.mock('./SwapPanel', () => ({ SwapPanel: () => null }))
vi.mock('./FreeMintPanel', () => ({ FreeMintPanel: () => null }))
vi.mock('./StakingPanel', () => ({ StakingPanel: () => null }))
vi.mock('./GraduatedSwapPanel', () => ({ GraduatedSwapPanel: () => null }))

// viem has no one-call `encodeEventLog`: indexed args go through `encodeEventTopics`, the wei amounts
// are non-indexed and go through `encodeAbiParameters`.
function carvePaidLog(paid: bigint): Log {
  return {
    topics: encodeEventTopics({
      abi: liquidityDeployerModuleAbi,
      eventName: 'CreatorCarvePaid',
      args: { instance: INSTANCE, creator: CREATOR },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [paid, paid]),
  } as unknown as Log
}

function excessTithedLog(amount: bigint): Log {
  return {
    topics: encodeEventTopics({
      abi: liquidityDeployerModuleAbi,
      eventName: 'GraduationExcessTithed',
      args: { instance: INSTANCE },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  } as unknown as Log
}

/** Each mount gets a fresh cache, so a "remount" really re-reads rather than replaying a hit. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <BondingSurface instance={INSTANCE} />
    </QueryClientProvider>,
  )
}

/** Chain history holding one graduation: 1 ETH requested carve plus 0.5 ETH of tithed excess. */
function historyWithCarve() {
  mockGetContractEvents.mockImplementation(async ({ eventName }: { eventName: string }) =>
    eventName === 'CreatorCarvePaid'
      ? [carvePaidLog(1_000_000_000_000_000_000n)]
      : [excessTithedLog(500_000_000_000_000_000n)],
  )
}

/**
 * The receipt element exists immediately in its loading state — wait for the READ to settle before
 * asserting, so a still-pending scan can never be mistaken for an answer.
 */
async function settledReceipt(): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = screen.getByTestId('erc404-carve-receipt')
    if (/reading the graduation record/.test(el.textContent ?? '')) {
      throw new Error('carve receipt still loading')
    }
    return el
  })
}

beforeEach(() => {
  mockGetContractEvents.mockReset()
  mockWaitForReceipt.mockClear()
})

afterEach(cleanup)

test('leg 4 — the graduated surface shows the carve figure with no transaction in flight', async () => {
  historyWithCarve()
  mount()

  const receipt = await settledReceipt()
  // 1.5 ETH gross, tithed 1/19/80 → 0.015 protocol, 0.285 vault, 1.2 to the creator.
  expect(receipt).toHaveTextContent('1.5 ETH gross')
  expect(receipt).toHaveTextContent('1.2 ETH net to the creator')
  expect(receipt).toHaveTextContent('0.285 ETH to the vault')
  expect(receipt).toHaveTextContent('0.015 ETH to the protocol')
  // Read from logs, not from a receipt hook — a tx hash is not part of this path at all.
  expect(mockWaitForReceipt).not.toHaveBeenCalled()
})

test('leg 4 — the figure survives a full remount with a cold cache', async () => {
  historyWithCarve()
  mount()
  await settledReceipt()
  cleanup()

  mount()
  const receipt = await settledReceipt()
  expect(receipt).toHaveTextContent('1.5 ETH gross')
  expect(mockWaitForReceipt).not.toHaveBeenCalled()
})

test('leg 4 — the union is read, not just the requested leg: an excess-only graduation still reports', async () => {
  mockGetContractEvents.mockImplementation(async ({ eventName }: { eventName: string }) =>
    eventName === 'CreatorCarvePaid' ? [] : [excessTithedLog(500_000_000_000_000_000n)],
  )
  mount()
  const receipt = await settledReceipt()
  expect(receipt).toHaveTextContent('0.5 ETH gross')
  expect(receipt).toHaveTextContent('0.4 ETH net to the creator')
})

test('leg 5 — a graduation with no carve renders its own sentence, not an empty node', async () => {
  mockGetContractEvents.mockResolvedValue([])
  mount()
  const receipt = await settledReceipt()
  expect(receipt).toHaveTextContent('graduated with no creator carve — the full LP share pooled.')
})

test('a failed read reads as a failed read, never as a zero carve', async () => {
  mockGetContractEvents.mockRejectedValue(new Error('rpc unavailable'))
  mount()
  const receipt = await settledReceipt()
  expect(receipt).toHaveTextContent(/could not be read/i)
  expect(receipt).not.toHaveTextContent(/no creator carve/i)
})

test('the immutable declared ceiling stays on the page after graduation', async () => {
  historyWithCarve()
  mount()
  await settledReceipt()
  expect(screen.getByTestId('erc404-phase-graduated')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-carve-disclosure')).toHaveTextContent(/may take up to 25%/i)
})
