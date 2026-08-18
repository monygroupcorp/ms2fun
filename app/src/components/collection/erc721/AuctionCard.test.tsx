/**
 * AuctionCard (noesis-212) — the settled state must show the creator's net alongside the existing
 * gross sale line, and the reclaim state must state the 1% cut before the action and never imply
 * an NFT (`reclaimUnsold` is a deposit refund, it never mints).
 *
 * AuctionCard (noesis-353) — the active-state bid form seeds its input at the minimum legal next
 * bid instead of starting empty, offers a +/- stepper that moves by the auction's own
 * `bidIncrement` and clamps at the floor, and re-seeds when the floor moves (another bid landing
 * while the card is open) as long as the bidder hasn't diverged from the seed by typing or
 * stepping.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

// Mutable, hoist-safe vault-family state so individual tests can flip between a liquidity-family
// vault (UniswapV4LP — 1% protocol / 19% vault / 80% creator) and a yield-family vault (AaveEndowment
// — 1% protocol / 80% vault / 19% creator, the flip that would misstate a creator's net by roughly 4x
// if inverted). Defaults to liquidity-family, matching this seat's fork-walk measurement.
const vaultFamilyState = vi.hoisted(() => ({ vaultType: 'UniswapV4LP' as string }))

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: true }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    data: undefined,
  }),
  useReadContract: () => ({ data: vaultFamilyState.vaultType }),
}))

vi.mock('../../../generated/contracts', () => ({
  erc721AuctionInstanceAbi: [],
  useReadErc721AuctionInstanceGenesisVault: () => ({ data: INSTANCE }),
  useReadErc721AuctionInstanceProtocolTreasury: () => ({
    data: '0x3333333333333333333333333333333333333333',
  }),
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

afterEach(() => {
  cleanup()
  vaultFamilyState.vaultType = 'UniswapV4LP'
})

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

describe('AuctionAction — settled (yield-family vault)', () => {
  it('renders the yield-family split (1% protocol / 80% vault / 19% creator), not the liquidity-family one', () => {
    vaultFamilyState.vaultType = 'AaveEndowment'
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
    // Yield-family flips vault/creator vs. liquidity-family: vault 80% (0.08), creator 19% (0.019 +
    // the 0.05 deposit returned = 0.069 net). Inverting the family here would misstate the creator's
    // net by roughly 4x (0.069 vs. the liquidity-family 0.13).
    const net = screen.getByTestId('erc721-sold-net').textContent ?? ''
    expect(net).toContain('0.069 ETH')
    expect(net).toContain('protocol 0.001 ETH')
    expect(net).toContain('vault 0.08 ETH')
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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const bidConfig: AuctionConfig = {
  lines: 1,
  baseDuration: 0n,
  timeBuffer: 0n,
  bidIncrement: 10000000000000000n, // 0.01 ETH
}

describe('AuctionAction — active (bid stepper)', () => {
  it('seeds the bid input with the minimum bid when the auction has no bids yet', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBid: 0n, highBidder: ZERO_ADDRESS })}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    // makeAuction's minBid is 0.05 ETH.
    expect(screen.getByTestId('erc721-bid-input')).toHaveValue('0.05')
  })

  it('seeds the bid input with the current high bid plus the increment when there is an existing bid', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction()} // highBid 0.1 ETH, a real bidder
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    // 0.1 ETH high bid + 0.01 ETH increment = 0.11 ETH — never the bare high bid itself.
    expect(screen.getByTestId('erc721-bid-input')).toHaveValue('0.11')
  })

  it('raises the bid by exactly bidIncrement each time the increment button is clicked', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBid: 0n, highBidder: ZERO_ADDRESS })}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    const input = screen.getByTestId('erc721-bid-input')
    fireEvent.click(screen.getByTestId('erc721-bid-increment'))
    expect(input).toHaveValue('0.06')
    fireEvent.click(screen.getByTestId('erc721-bid-increment'))
    expect(input).toHaveValue('0.07')
  })

  it('never lets the decrement button take the value below the minimum', () => {
    render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBid: 0n, highBidder: ZERO_ADDRESS })}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    const input = screen.getByTestId('erc721-bid-input')
    // Already seeded at the floor (0.05) — decrementing must clamp, not go negative/below-floor.
    fireEvent.click(screen.getByTestId('erc721-bid-decrement'))
    expect(input).toHaveValue('0.05')
  })

  it('re-seeds the untouched input when the floor moves (another bid lands while the card is open)', () => {
    const { rerender } = render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBid: 0n, highBidder: ZERO_ADDRESS })}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    expect(screen.getByTestId('erc721-bid-input')).toHaveValue('0.05')

    // A bid lands elsewhere; the parent re-renders with a moved high bid — the seeded (untouched)
    // field must follow the new floor rather than staying at a now-stale, reverting amount.
    rerender(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction()} // highBid 0.1 ETH now
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    expect(screen.getByTestId('erc721-bid-input')).toHaveValue('0.11')
  })

  it('leaves a typed value alone once the bidder has diverged from the seed', () => {
    const { rerender } = render(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction({ highBid: 0n, highBidder: ZERO_ADDRESS })}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    const input = screen.getByTestId('erc721-bid-input')
    fireEvent.change(input, { target: { value: '0.2' } })
    expect(input).toHaveValue('0.2')

    // The floor moves, but the bidder already typed a value — typing stays a first-class way to
    // bid, so it is not silently overwritten.
    rerender(
      <AuctionAction
        instance={INSTANCE}
        auction={makeAuction()}
        config={bidConfig}
        state="active"
        isOwner={false}
        refetch={() => {}}
      />,
    )
    expect(input).toHaveValue('0.2')
  })
})
