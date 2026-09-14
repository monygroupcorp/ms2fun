import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import {
  auctionPositions,
  derivePortfolioInputs,
  fetchPortfolioDataBatched,
  hasAuctionEscrow,
  isPortfolioEmpty,
  MAX_QUERY_LIMIT,
  portfolioQueryKey,
  type AuctionPosition,
  type PortfolioData,
} from './usePortfolio'
import { HeldPanel, VaultsPanel } from './PortfolioPanels'

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

  it('keeps every instance and vault past MAX_QUERY_LIMIT — no clipping, no truncation flag', () => {
    // noesis-327: this used to `.slice(0, 50)`. Because `useAllCollections` sorts newest-first, the
    // prefix was the 50 NEWEST collections, so a holding in an older one was reported as "nothing
    // held" and each new registration evicted another. The read is windowed now, so nothing drops.
    const cards = Array.from({ length: MAX_QUERY_LIMIT + 5 }, (_, i) => ({
      instance: addr(i + 1),
      vault: addr(1000 + i), // each unique → vaults also exceed the cap
    }))
    const { instances, vaultAddrs, truncated } = derivePortfolioInputs(cards)
    expect(instances).toHaveLength(MAX_QUERY_LIMIT + 5)
    expect(vaultAddrs).toHaveLength(MAX_QUERY_LIMIT + 5)
    expect(instances).toContain(addr(1)) // the oldest — the one the prefix slice evicted first
    expect(truncated).toBe(false)
  })

  it('handles an empty card list', () => {
    expect(derivePortfolioInputs([])).toEqual({
      instances: [],
      vaultAddrs: [],
      truncated: false,
    })
  })
})

describe('portfolioQueryKey', () => {
  it('differs for two equal-length instance sets with different membership', () => {
    const chainId = 31337
    const user = addr(1)
    const windowA = Array.from({ length: MAX_QUERY_LIMIT }, (_, i) => addr(i + 1))
    const windowB = Array.from({ length: MAX_QUERY_LIMIT }, (_, i) => addr(i + 11))
    const keyA = portfolioQueryKey(chainId, user, windowA, [])
    const keyB = portfolioQueryKey(chainId, user, windowB, [])
    expect(windowA).toHaveLength(windowB.length)
    expect(keyA).not.toEqual(keyB)
  })

  it('matches for the same instances regardless of vault set', () => {
    const chainId = 31337
    const user = addr(1)
    const instances = [addr(1), addr(2)]
    expect(portfolioQueryKey(chainId, user, instances, [addr(9)])).not.toEqual(
      portfolioQueryKey(chainId, user, instances, [addr(10)]),
    )
    expect(portfolioQueryKey(chainId, user, instances, [addr(9)])).toEqual(
      portfolioQueryKey(chainId, user, [...instances], [addr(9)]),
    )
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

describe('fetchPortfolioDataBatched', () => {
  /**
   * A read that mirrors the aggregator's own bound (`instances.length > MAX_QUERY_LIMIT ||
   * vaultAddrs.length > MAX_QUERY_LIMIT` → revert) and answers as the contract does: instances
   * produce the ERC404 / ERC1155 / auction legs, vaults produce the vault leg, and `totalClaimable`
   * is the sum of what THAT call saw.
   */
  function boundedRead() {
    const widths: [number, number][] = []
    const read = async (
      instances: `0x${string}`[],
      vaultAddrs: `0x${string}`[],
    ): Promise<PortfolioData> => {
      widths.push([instances.length, vaultAddrs.length])
      if (instances.length > MAX_QUERY_LIMIT || vaultAddrs.length > MAX_QUERY_LIMIT) {
        throw new Error('TooManyInstances')
      }
      return [
        instances.map((instance) => ({
          instance,
          name: '',
          tokenBalance: 1n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 2n,
        })),
        instances.map((instance) => ({ instance, name: '', editionIds: [1n], balances: [1n] })),
        vaultAddrs.map((vault) => ({
          vault,
          name: '',
          contribution: 0n,
          shares: 0n,
          claimable: 3n,
        })),
        BigInt(instances.length) * 2n + BigInt(vaultAddrs.length) * 3n,
        instances.map((instance) => ({
          instance,
          name: '',
          tokenId: 1n,
          amount: 1n,
          isCreatorDeposit: false,
          endTime: 0n,
          settleable: false,
          reclaimable: false,
        })),
      ] as unknown as PortfolioData
    }
    return { read, widths }
  }

  it('covers every instance and vault past the cap, in order', async () => {
    const instances = Array.from({ length: 123 }, (_, i) => addr(i + 1))
    const vaults = Array.from({ length: 60 }, (_, i) => addr(1000 + i))
    const { read, widths } = boundedRead()

    const data = await fetchPortfolioDataBatched(read, instances, vaults)

    expect(data[0].map((h) => h.instance)).toEqual(instances)
    expect(data[1].map((h) => h.instance)).toEqual(instances)
    expect(data[2].map((v) => v.vault)).toEqual(vaults)
    expect(data[4].map((p) => p.instance)).toEqual(instances)
    // The scalar composes: every address is counted exactly once across the windows.
    expect(data[3]).toBe(BigInt(instances.length) * 2n + BigInt(vaults.length) * 3n)
    // Instance and vault windows are ZIPPED, not crossed: 7 passes, not 7 × 3.
    expect(widths).toEqual([
      [20, 20],
      [20, 20],
      [20, 20],
      [20, 0],
      [20, 0],
      [20, 0],
      [3, 0],
    ])
  })

  it('returns the same answer at a perturbed window width', async () => {
    const instances = Array.from({ length: 123 }, (_, i) => addr(i + 1))
    const vaults = Array.from({ length: 60 }, (_, i) => addr(1000 + i))
    const wide = await fetchPortfolioDataBatched(boundedRead().read, instances, vaults)
    const narrow = await fetchPortfolioDataBatched(boundedRead().read, instances, vaults, 7)
    expect(narrow[0].map((h) => h.instance)).toEqual(wide[0].map((h) => h.instance))
    expect(narrow[2].map((v) => v.vault)).toEqual(wide[2].map((v) => v.vault))
    expect(narrow[3]).toBe(wide[3])
  })

  it('issues no read when there is nothing to ask about', async () => {
    const { read, widths } = boundedRead()
    expect(await fetchPortfolioDataBatched(read, [], [])).toEqual([[], [], [], 0n, []])
    expect(widths).toEqual([])
  })
})

// noesis-327: the notice sat BELOW the `isPortfolioEmpty` early return, so the one case where it is
// load-bearing — a portfolio hidden entirely, rendering "nothing held yet" — was the one case it
// could never appear in. A partially-hidden portfolio warns; a fully-hidden one asserted the
// opposite.
describe('HeldPanel truncation notice', () => {
  afterEach(cleanup)

  const empty: PortfolioData = [[], [], [], 0n, []]

  it('renders the notice alongside the empty state when truncated', () => {
    render(
      createElement(HeldPanel, { data: empty, isPending: false, isError: false, truncated: true }),
    )
    expect(screen.getByTestId('portfolio-empty')).toBeInTheDocument()
    expect(screen.getByTestId('portfolio-truncated')).toBeInTheDocument()
  })

  it('says what was CHECKED, not what is shown — nothing is shown in the empty case', () => {
    render(
      createElement(HeldPanel, { data: empty, isPending: false, isError: false, truncated: true }),
    )
    expect(screen.getByTestId('portfolio-truncated')).toHaveTextContent(
      /some collections could not be checked/i,
    )
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument()
  })

  it('names no collection count — the read width is not a number the copy may pin', () => {
    render(
      createElement(HeldPanel, { data: empty, isPending: false, isError: false, truncated: true }),
    )
    expect(screen.getByTestId('portfolio-truncated').textContent).not.toMatch(/\d/)
  })

  it('omits the notice when the read covered everything', () => {
    render(
      createElement(HeldPanel, { data: empty, isPending: false, isError: false, truncated: false }),
    )
    expect(screen.queryByTestId('portfolio-truncated')).not.toBeInTheDocument()
  })
})
