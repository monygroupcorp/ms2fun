import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import {
  auctionPositions,
  derivePortfolioInputs,
  hasAuctionEscrow,
  isPortfolioEmpty,
  MAX_QUERY_LIMIT,
  type AuctionPosition,
  type PortfolioData,
} from './usePortfolio'
import { VaultsPanel } from './PortfolioPanels'

const ZERO = '0x0000000000000000000000000000000000000000' as const
const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

describe('derivePortfolioInputs', () => {
  it('collects all instances and dedupes non-zero vaults', () => {
    const vaultA = addr(0xaa)
    const cards = [
      { instance: addr(1), vault: vaultA },
      { instance: addr(2), vault: vaultA }, // same vault → deduped
      { instance: addr(3), vault: ZERO }, // zero vault → excluded
      { instance: addr(4), vault: addr(0xbb) },
    ]
    const { instances, vaultAddrs, truncated } = derivePortfolioInputs(cards)
    expect(instances).toEqual([addr(1), addr(2), addr(3), addr(4)])
    expect(vaultAddrs).toEqual([vaultA, addr(0xbb)])
    expect(truncated).toBe(false)
  })

  it('dedupes vaults case-insensitively', () => {
    const lower = '0x00000000000000000000000000000000000000ab' as `0x${string}`
    const upper = '0x00000000000000000000000000000000000000AB' as `0x${string}`
    const { vaultAddrs } = derivePortfolioInputs([
      { instance: addr(1), vault: lower },
      { instance: addr(2), vault: upper },
    ])
    expect(vaultAddrs).toHaveLength(1)
  })

  it('caps both arrays at MAX_QUERY_LIMIT and flags truncation', () => {
    const cards = Array.from({ length: MAX_QUERY_LIMIT + 5 }, (_, i) => ({
      instance: addr(i + 1),
      vault: addr(1000 + i), // each unique → vaults also exceed the cap
    }))
    const { instances, vaultAddrs, truncated } = derivePortfolioInputs(cards)
    expect(instances).toHaveLength(MAX_QUERY_LIMIT)
    expect(vaultAddrs).toHaveLength(MAX_QUERY_LIMIT)
    expect(truncated).toBe(true)
  })

  it('handles an empty card list', () => {
    expect(derivePortfolioInputs([])).toEqual({
      instances: [],
      vaultAddrs: [],
      truncated: false,
    })
  })
})

describe('isPortfolioEmpty', () => {
  const empty: PortfolioData = [[], [], [], 0n, []]

  it('is empty for undefined or all-empty sections', () => {
    expect(isPortfolioEmpty(undefined)).toBe(true)
    expect(isPortfolioEmpty(empty)).toBe(true)
  })

  it('is empty when every balance is zero', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'A',
          tokenBalance: 0n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [{ instance: addr(2), name: 'B', editionIds: [1n], balances: [0n] }],
      [{ vault: addr(3), name: 'V', contribution: 0n, shares: 0n, claimable: 0n }],
      0n,
      [],
    ]
    expect(isPortfolioEmpty(data)).toBe(true)
  })

  it('is non-empty when an ERC404 token balance is held', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'A',
          tokenBalance: 5n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
      [],
    ]
    expect(isPortfolioEmpty(data)).toBe(false)
  })

  it('is non-empty when an ERC1155 edition balance is held', () => {
    const data: PortfolioData = [
      [],
      [{ instance: addr(2), name: 'B', editionIds: [1n], balances: [3n] }],
      [],
      0n,
      [],
    ]
    expect(isPortfolioEmpty(data)).toBe(false)
  })

  it('is non-empty when a vault contribution exists', () => {
    const data: PortfolioData = [
      [],
      [],
      [{ vault: addr(3), name: 'V', contribution: 1n, shares: 0n, claimable: 0n }],
      0n,
      [],
    ]
    expect(isPortfolioEmpty(data)).toBe(false)
  })
})

describe('auction escrow', () => {
  const position = (over: Partial<AuctionPosition> = {}): AuctionPosition => ({
    instance: addr(9),
    name: 'Auction House',
    tokenId: 1n,
    amount: 2n * 10n ** 18n,
    isCreatorDeposit: false,
    endTime: 1_700_000_000n,
    settleable: false,
    reclaimable: false,
    ...over,
  })

  const withPositions = (positions: AuctionPosition[]): PortfolioData => [[], [], [], 0n, positions]

  it('reads the escrow leg by index, not by tuple position', () => {
    const p = position()
    expect(auctionPositions(withPositions([p]))).toEqual([p])
    expect(auctionPositions(undefined)).toEqual([])
  })

  it('a standing high bid makes the portfolio non-empty', () => {
    // The empty state invites the user to bid; it must not claim "nothing held" once they have.
    expect(isPortfolioEmpty(withPositions([position()]))).toBe(false)
    expect(hasAuctionEscrow(withPositions([position()]))).toBe(true)
  })

  it("a creator's queue deposit makes the portfolio non-empty", () => {
    const data = withPositions([position({ isCreatorDeposit: true, amount: 5n * 10n ** 17n })])
    expect(isPortfolioEmpty(data)).toBe(false)
  })

  it('a zero-amount position is not escrow', () => {
    const data = withPositions([position({ amount: 0n })])
    expect(hasAuctionEscrow(data)).toBe(false)
    expect(isPortfolioEmpty(data)).toBe(true)
  })
})

// noesis-331: the vaults tab never mounted with `truncated` before this file — F-W2's window
// notice was reachable only in HeldPanel. VaultsPanel is a .tsx component but this file stays
// .ts (its established home per the plan), so the elements are built with `createElement` rather
// than JSX.
describe('VaultsPanel truncation notice', () => {
  afterEach(cleanup)

  const empty: PortfolioData = [[], [], [], 0n, []]

  it('shows the truncation notice alongside the empty inbound state when truncated', () => {
    render(
      createElement(VaultsPanel, {
        data: empty,
        isPending: false,
        isError: false,
        truncated: true,
      }),
    )
    expect(screen.getByTestId('vaults-truncated')).toBeInTheDocument()
    expect(screen.getByText(/nothing aligns to you yet/)).toBeInTheDocument()
  })

  it('omits the notice when not truncated', () => {
    render(
      createElement(VaultsPanel, {
        data: empty,
        isPending: false,
        isError: false,
        truncated: false,
      }),
    )
    expect(screen.queryByTestId('vaults-truncated')).not.toBeInTheDocument()
  })
})
