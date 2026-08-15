/**
 * AuctionCard (noesis-212) — the settled state must show the creator's net alongside the existing
 * gross sale line, and the reclaim state must state the 1% cut before the action and never imply
 * an NFT (`reclaimUnsold` is a deposit refund, it never mints).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuctionAction } from './AuctionCard'
import type { ActiveAuction, AuctionConfig } from './useAuctions'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const WINNER = '0x2222222222222222222222222222222222222222' as const

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1337,
}))

vi.mock('./useBidHistory', () => ({
  useBidHistory: () => ({ data: [], isPending: false }),
}))

vi.mock('../../ui/useTxAction', () => ({
  useTxAction: () => ({
    send: vi.fn(),
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
  txErrorReason: () => undefined,
}))

// A liquidity-family vault (UniswapV4LP) — matches the 1% protocol / 19% vault / 80% creator split
// this seat measured on its fork walk.
vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: true }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false, isError: false }),
  useReadContract: () => ({ data: 'UniswapV4LP' }),
}))

vi.mock('../../../generated/contracts', () => ({
  erc721AuctionInstanceAbi: [],
  useReadErc721AuctionInstanceGenesisVault: () => ({ data: INSTANCE }),
  useWriteErc721AuctionInstanceCreateBid: () => ({
    writeContract: vi.fn(),
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
}))

function makeAuction(overrides: Partial<ActiveAuction> = {}): ActiveAuction {
  return {
    line: 0,
    tokenId: 1n,
    tokenURI: '',
    minBid: 50000000000000000n, // 0.05 ETH deposit
    highBid: 100000000000000000n, // 0.1 ETH winning bid
    highBidder: WINNER,
    startTime: 0n,
    endTime: 0n,
    settled: true,
    ...overrides,
  }
}

const config: AuctionConfig = { lines: 1, baseDuration: 0n, timeBuffer: 0n, bidIncrement: 0n }

afterEach(cleanup)

describe('AuctionAction — settled', () => {
  it('renders the creator net alongside the existing gross sale line', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction()}
        config={config}
        state="settled"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    // The existing gross line stays — it's true and useful.
    expect(screen.getByTestId('erc721-sold').textContent).toContain('0.1 ETH')
    // But it is no longer the only number: the creator's net (80% of 0.1 + the 0.05 deposit
    // returned = 0.13 ETH) is now shown too.
    const net = screen.getByTestId('erc721-sold-net').textContent ?? ''
    expect(net).toContain('0.13 ETH')
    expect(net).toContain('protocol 0.001 ETH')
    expect(net).toContain('vault 0.019 ETH')
  })
})

describe('AuctionAction — endedNoBids (owner)', () => {
  it('states the 1% protocol cut before the action, and never implies an NFT', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBidder: '0x0000000000000000000000000000000000000000' })}
        config={config}
        state="endedNoBids"
        isOwner={true}
        refetch={() => {}}
      />,
    )
    const note = screen.getByText(/reclaim your deposit/i).textContent ?? ''
    expect(note).toContain('1%')
    expect(note.toLowerCase()).not.toContain('piece')
  })
})
