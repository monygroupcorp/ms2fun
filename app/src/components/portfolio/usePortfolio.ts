import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { ContractFunctionReturnType } from 'viem'
import { queryAggregatorAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { useAllCollections } from '../../lib/discovery'
import { chunk, MAX_QUERY_LIMIT, QUERY_WINDOW } from '../../lib/discovery/batchRead'

/**
 * usePortfolio (W-F) — the connected wallet's holdings across ALL registered collections.
 *
 * Data flow:
 *  1. `useAllCollections()` enumerates every registered instance (W-A2 event-scan index) and
 *     exposes each card's `instance` + `vault` address.
 *  2. We collect the instance list + the DEDUPED set of non-zero vault addresses and feed them,
 *     with the connected `user`, to `QueryAggregator.getPortfolioData(user, instances, vaultAddrs)`.
 *
 * The call returns five values: the ERC404, ERC1155 and vault legs, `totalClaimable`, and the ERC721
 * auction-escrow leg (index 4). Read by INDEX, not by position-in-a-tuple-you-remember.
 *
 * The aggregator caps each address-array at `MAX_QUERY_LIMIT` (50) on-chain; passing more reverts.
 * We therefore read in windows of at most that width and concatenate, rather than clipping. Clipping
 * a NEWEST-FIRST index meant asking about the 50 most recent collections: a position in an older one
 * was answered "nothing held", and each new registration past 50 evicted another, with no user
 * action. Windowing removes the question of WHICH 50 by asking about all of them.
 *
 * Read idiom mirrors `useAllCollectionsRaw`: a React Query around `publicClient.readContract`,
 * keyed on chainId + user + the instance/vault sets so a chain reset or account switch refetches.
 */

const ZERO = '0x0000000000000000000000000000000000000000'

export { MAX_QUERY_LIMIT }

export type PortfolioData = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getPortfolioData'
>

export type Erc404Holding = PortfolioData[0][number]
export type Erc1155Holding = PortfolioData[1][number]
export type VaultPosition = PortfolioData[2][number]
/**
 * ETH the user has escrowed inside an ERC721 auction — a high bid, or a creator's queue deposit.
 * Escrow is held by the auction until it settles or is reclaimed, so it is deliberately NOT part of
 * `totalClaimable` (index 3) and must never be added to it here.
 */
export type AuctionPosition = PortfolioData[4][number]

export interface PortfolioInputs {
  instances: `0x${string}`[]
  vaultAddrs: `0x${string}`[]
  truncated: boolean
}

/**
 * Pure: derive the aggregator call args from the all-collections cards.
 *
 * - `instances` = every card's instance address.
 * - `vaultAddrs` = the deduped set of NON-zero vault addresses (a vault is shared across many
 *   instances; the aggregator wants the distinct vaults to read positions once each).
 * - Neither array is clipped: `fetchPortfolioDataBatched` windows them at the aggregator's cap, so
 *   the read covers every collection. `truncated` is retained as the signal the panels warn on and
 *   is false by construction here — nothing on this path drops a collection any more.
 *
 * Extracted from the hook so it can be unit-tested without a chain.
 */
export function derivePortfolioInputs(
  cards: { instance: `0x${string}`; vault: `0x${string}` }[],
): PortfolioInputs {
  const instances = cards.map((c) => c.instance)

  const seen = new Set<string>()
  const vaultAddrs: `0x${string}`[] = []
  for (const c of cards) {
    const v = c.vault.toLowerCase()
    if (c.vault !== ZERO && !seen.has(v)) {
      seen.add(v)
      vaultAddrs.push(c.vault)
    }
  }

  return { instances, vaultAddrs, truncated: false }
}

/** Empty portfolio in the aggregator's five-value shape. */
const EMPTY_PORTFOLIO = [[], [], [], 0n, []] as unknown as PortfolioData

/**
 * `getPortfolioData` over unbounded instance/vault sets, in windows of at most `QUERY_WINDOW`.
 *
 * The five return values compose cleanly across windows because each address contributes to exactly
 * one of them: instances produce the ERC404, ERC1155 and auction legs, vaults produce the vault leg,
 * and `totalClaimable` is the sum of the ERC404 pending rewards and the vault claimables the call
 * saw. Every address appears in exactly one window, so concatenating the arrays and summing the
 * scalar reproduces the single-call answer exactly.
 *
 * Instance and vault windows are zipped rather than crossed — pass `i` carries instance window `i`
 * and vault window `i`, with an empty array once one side runs out — so the read costs
 * `max(ceil(i/50), ceil(v/50))` round-trips, not their product.
 */
export async function fetchPortfolioDataBatched(
  read: (instances: `0x${string}`[], vaultAddrs: `0x${string}`[]) => Promise<PortfolioData>,
  instances: readonly `0x${string}`[],
  vaultAddrs: readonly `0x${string}`[],
  width: number = QUERY_WINDOW,
): Promise<PortfolioData> {
  const instanceWindows = chunk(instances, width)
  const vaultWindows = chunk(vaultAddrs, width)
  const passes = Math.max(instanceWindows.length, vaultWindows.length)
  if (passes === 0) return EMPTY_PORTFOLIO

  const erc404: Erc404Holding[] = []
  const erc1155: Erc1155Holding[] = []
  const vaults: VaultPosition[] = []
  const auctions: AuctionPosition[] = []
  let totalClaimable = 0n

  for (let i = 0; i < passes; i++) {
    const page = await read(instanceWindows[i] ?? [], vaultWindows[i] ?? [])
    erc404.push(...page[0])
    erc1155.push(...page[1])
    vaults.push(...page[2])
    totalClaimable += page[3]
    auctions.push(...page[4])
  }

  return [erc404, erc1155, vaults, totalClaimable, auctions] as unknown as PortfolioData
}

/**
 * Pure: build the portfolio query key from its inputs.
 *
 * Keyed on the array CONTENTS (joined), not their lengths — two instance sets of equal size but
 * different membership must produce different keys, or React Query treats distinct reads as the
 * same cache entry. `instances`/`vaultAddrs` are already lowercase-normalised addresses in a
 * deterministic order (see `derivePortfolioInputs`), so a plain `.join(',')` is stable.
 *
 * Extracted from the hook so it can be unit-tested without a chain.
 */
export function portfolioQueryKey(
  chainId: number,
  user: `0x${string}` | undefined,
  instances: `0x${string}`[],
  vaultAddrs: `0x${string}`[],
): readonly unknown[] {
  return ['portfolio', chainId, user ?? null, instances.join(','), vaultAddrs.join(',')]
}

/** The user's auction escrow positions, ordered as the aggregator returned them. */
export function auctionPositions(data: PortfolioData | undefined): readonly AuctionPosition[] {
  return data?.[4] ?? []
}

/** True when the user has ETH escrowed in at least one auction. */
export function hasAuctionEscrow(data: PortfolioData | undefined): boolean {
  return auctionPositions(data).some((p) => p.amount > 0n)
}

/**
 * True when the portfolio has nothing worth showing (every section empty).
 *
 * Auction escrow counts: ETH sitting in a bid or a queue deposit is the user's money, so a portfolio
 * carrying one is not empty even when no token balance is held.
 */
export function isPortfolioEmpty(data: PortfolioData | undefined): boolean {
  if (!data) return true
  const [erc404, erc1155, vaults] = data
  const has404 = erc404.some(
    (h) =>
      h.tokenBalance > 0n || h.nftBalance > 0n || h.stakedBalance > 0n || h.pendingRewards > 0n,
  )
  const has1155 = erc1155.some((h) => h.balances.some((b) => b > 0n))
  const hasVault = vaults.some((v) => v.contribution > 0n || v.shares > 0n || v.claimable > 0n)
  return !has404 && !has1155 && !hasVault && !hasAuctionEscrow(data)
}

export interface UsePortfolioResult {
  data: PortfolioData | undefined
  isPending: boolean
  isError: boolean
  /**
   * True when the collection index was clipped and holdings may be missing. False by construction
   * since the read was windowed (noesis-327) — kept as the panels' fail-safe so any future path that
   * does drop collections has a correct notice already wired to it.
   */
  truncated: boolean
  /** No connected wallet — caller should render the connect gate. */
  noWallet: boolean
}

export function usePortfolio(user: `0x${string}` | undefined): UsePortfolioResult {
  const client = usePublicClient({ chainId: forkChainId })
  const { data: cards, isPending: cardsPending, isError: cardsError } = useAllCollections()

  const { instances, vaultAddrs, truncated } = derivePortfolioInputs(cards ?? [])

  const enabled = !!client && !!user && cards !== undefined

  const { data, isPending, isError } = useQuery({
    queryKey: portfolioQueryKey(forkChainId, user, instances, vaultAddrs),
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<PortfolioData> => {
      if (!client || !user) throw new Error('portfolio query ran without client/user')
      return fetchPortfolioDataBatched(
        async (windowInstances, windowVaults) =>
          (await client.readContract({
            address: forkAddresses.QueryAggregator,
            abi: queryAggregatorAbi,
            functionName: 'getPortfolioData',
            args: [user, windowInstances, windowVaults],
          })) as PortfolioData,
        instances,
        vaultAddrs,
      )
    },
  })

  return {
    data,
    // While the collection index is loading the aggregator query is disabled — surface that as pending.
    isPending: !!user && (cardsPending || (enabled && isPending)),
    isError: cardsError || isError,
    truncated,
    noWallet: !user,
  }
}
