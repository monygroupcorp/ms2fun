/**
 * The three places a collector is asked for money — an ERC1155 mint price, an ERC404 bonding-curve
 * quote, an ERC721 auction bid — each rendered with one live ETH/USD round, asserting the dollar
 * equivalent lands beside the ETH figure on every one of them.
 *
 * This is deliberately a cross-surface file rather than three additions to three suites: the claim
 * under test is that the drop quotes fiat EVERYWHERE money is asked for, and a claim about coverage
 * is only ever as good as the one place that enumerates what it covers. A fourth money surface added
 * later belongs here.
 *
 * The rate is a single fixture — $4,200.00 per ETH, one minute old — shared by all three, so each
 * assertion is arithmetic anyone can check by hand against the ETH figure beside it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MintPanel } from './erc1155/MintPanel'
import { SwapPanel } from './erc404/SwapPanel'
import { AuctionCard } from './erc721/AuctionCard'
import type { BondingView } from './erc404/bondingPhase'
import type { CurveParamsTuple } from './erc404/useBondingData'
import type { EditionView } from './useEditions'
import type { ActiveAuction, AuctionConfig } from './erc721/useAuctions'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const HOLDER = '0x2222222222222222222222222222222222222222' as const
const NOW = 1_800_000_000n
/** $4,200.00 at the 8 decimals an ETH/USD aggregator reports. */
const ANSWER = 420_000_000_000n
const ONE_ETH = 10n ** 18n

/**
 * The one wagmi seam all three surfaces share. `useReadContracts` answers the rate batch —
 * [decimals, latestRoundData, chain clock] — with a round stamped a minute behind chain time, which
 * is the only shape `useEthUsdRate` treats as usable.
 */
vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: true, address: HOLDER }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    data: undefined,
  }),
  // The buy-side inverse solve probes `calculateCost` through this. A linear curve — one token per
  // 100 wei — keeps the bisection's answer exact arithmetic rather than a fixture to eyeball.
  usePublicClient: () => ({
    readContract: async ({ args }: { args: readonly unknown[] }) => (args[2] as bigint) / 100n,
  }),
  useReadContracts: () => ({
    data: [
      { status: 'success', result: 8 },
      { status: 'success', result: [1n, ANSWER, NOW - 60n, NOW - 60n, 1n] },
      { status: 'success', result: NOW },
    ],
  }),
}))

vi.mock('./useCollectionChain', () => ({
  useCollectionChainId: () => 1,
  useCollectionAddresses: () => ({}),
}))

// ── ERC1155 mint ────────────────────────────────────────────────────────────────────────────────
/** 0.01 ETH — the mint price under test. */
const MINT_COST = ONE_ETH / 100n

vi.mock('./erc1155/useMerkleAllowlist', () => ({
  useMerkleAllowlistProof: () => ({ status: 'no-list' as const }),
}))

// ── ERC404 bonding curve ────────────────────────────────────────────────────────────────────────
/** 0.05 ETH of refund on the sell side. */
const SELL_REFUND = ONE_ETH / 20n

vi.mock('./erc404/useMerkleAllowlist', () => ({
  useMerkleAllowlistProof: () => ({ status: 'no-list' as const }),
}))

vi.mock('./erc404/useTierPosition', () => ({
  useTierPosition: () => ({
    tiered: false,
    holdings: undefined,
    pendingEscrowRelease: undefined,
    bandPieces: [],
    balance: undefined,
  }),
}))

vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send: vi.fn(),
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
  txErrorReason: () => undefined,
  invalidateInstanceQueries: vi.fn(),
}))

// ── ERC721 auction ──────────────────────────────────────────────────────────────────────────────
vi.mock('./erc721/useBidHistory', () => ({
  useBidHistory: () => ({ data: [], isPending: false }),
}))

const writeStub = {
  writeContract: vi.fn(),
  data: undefined,
  isPending: false,
  isError: false,
  error: undefined,
  reset: vi.fn(),
}

vi.mock('../../generated/contracts', () => ({
  erc1155InstanceAbi: [],
  erc721AuctionInstanceAbi: [],
  curveParamsComputerAbi: [],
  useReadErc1155InstanceCalculateMintCost: () => ({ data: MINT_COST, isPending: false }),
  useReadErc1155InstanceGatingModule: () => ({ data: undefined }),
  useReadErc1155InstanceGatingScope: () => ({ data: undefined }),
  useWriteErc1155InstanceMint: () => writeStub,
  useReadCurveParamsComputerCalculateRefund: () => ({ data: SELL_REFUND }),
  useReadErc404BondingInstanceBalanceOf: () => ({ data: 10n * ONE_ETH, refetch: vi.fn() }),
  useWriteErc404BondingInstanceBuyBonding: () => writeStub,
  useWriteErc404BondingInstanceSellBonding: () => writeStub,
  useReadErc721AuctionInstanceProtocolTreasury: () => ({
    data: '0x3333333333333333333333333333333333333333',
  }),
  useWriteErc721AuctionInstanceCreateBid: () => writeStub,
}))

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a mint price', () => {
  // `EditionView` is the aggregator's full batch row; MintPanel reads exactly two fields off it —
  // the edition id it mints and the open time it gates the button on. Supplying only those keeps the
  // fixture from asserting a shape this test does not exercise.
  const edition = { id: 1n, openTime: 0n } as unknown as EditionView

  it('shows the dollar cost beside the ETH cost', () => {
    wrap(<MintPanel instance={INSTANCE} edition={edition} refetch={() => {}} />)
    // 0.01 ETH at $4,200 = $42.00.
    expect(screen.getByTestId('erc1155-mint-cost-fiat')).toHaveTextContent('$42.00')
  })

  it('names Chainlink and the round’s age on the figure itself', () => {
    wrap(<MintPanel instance={INSTANCE} edition={edition} refetch={() => {}} />)
    expect(screen.getByTestId('erc1155-mint-cost-fiat').getAttribute('title')).toContain(
      'Chainlink ETH/USD — $4,200.00 per ETH',
    )
  })
})

describe('a bonding-curve quote', () => {
  const view: BondingView = {
    bondingActive: true,
    bondingOpenTime: 0n,
    bondingMaturityTime: NOW + 10_000n,
    graduated: false,
    totalBondingSupply: 0n,
    maxSupply: 1_000_000n * ONE_ETH,
    liquidityReserve: 0n,
    freeMintAllocation: 0n,
    unit: ONE_ETH,
  }
  const curveParams: CurveParamsTuple = [1n, 1n, 1n]

  function panel() {
    return (
      <SwapPanel
        instance={INSTANCE}
        view={view}
        curveParams={curveParams}
        curveComputer="0x4444444444444444444444444444444444444444"
        decimals={18}
        feeBps={100n}
        gatingActive={false}
        refetch={() => {}}
      />
    )
  }

  it('prices the buy cost in dollars once the ETH spend resolves to an amount', async () => {
    const { getByTestId } = wrap(panel())
    fireEvent.change(getByTestId('erc404-amount-input'), { target: { value: '0.05' } })
    // The solve is debounced, then bisects the linear probe to a cost of exactly 0.05 ETH,
    // which is $210.00 at the fixture rate.
    await waitFor(() => expect(getByTestId('erc404-buy-cost-fiat')).toHaveTextContent('$210.00'), {
      timeout: 3_000,
    })
  })

  it('prices the sell refund in dollars beside its ETH figure', async () => {
    const { getByTestId } = wrap(panel())
    fireEvent.click(getByTestId('erc404-direction-sell'))
    fireEvent.change(getByTestId('erc404-amount-input'), { target: { value: '1' } })
    // 0.05 ETH refunded at $4,200 = $210.00.
    await waitFor(() => expect(getByTestId('erc404-sell-refund-fiat')).toHaveTextContent('$210.00'))
  })
})

describe('an auction bid', () => {
  const auction: ActiveAuction = {
    line: 0,
    tokenId: 1n,
    tokenURI: '',
    minBid: ONE_ETH / 20n, // 0.05 ETH
    highBid: ONE_ETH / 10n, // 0.1 ETH
    highBidder: HOLDER,
    startTime: 0n,
    endTime: NOW + 10_000n,
    settled: false,
  }
  const config: AuctionConfig = {
    lines: 1,
    baseDuration: 0n,
    timeBuffer: 0n,
    bidIncrement: ONE_ETH / 100n,
  }

  it('prices the standing high bid and the bid about to be placed', () => {
    wrap(
      <AuctionCard
        instance={INSTANCE}
        auction={auction}
        config={config}
        nowSec={NOW}
        isOwner={false}
        refetch={() => {}}
      />,
    )
    // The standing high bid: 0.1 ETH = $420.00.
    expect(screen.getByTestId('erc721-auction-stat-fiat')).toHaveTextContent('$420.00')
    // The floor the bidder must clear: 0.1 + 0.01 = 0.11 ETH = $462.00, which is also what the
    // input is seeded at — so the typed-bid line stays out of the way until they raise it.
    expect(screen.getByTestId('erc721-min-bid-fiat')).toHaveTextContent('$462.00')
    expect(screen.queryByTestId('erc721-bid-fiat')).toBeNull()
  })

  it('prices the bid the wallet is about to sign, once it is raised above the floor', () => {
    wrap(
      <AuctionCard
        instance={INSTANCE}
        auction={auction}
        config={config}
        nowSec={NOW}
        isOwner={false}
        refetch={() => {}}
      />,
    )
    // One click of the auction's own increment: 0.11 → 0.12 ETH = $504.00.
    fireEvent.click(screen.getByTestId('erc721-bid-increment'))
    expect(screen.getByTestId('erc721-bid-fiat')).toHaveTextContent('$504.00')
  })
})
