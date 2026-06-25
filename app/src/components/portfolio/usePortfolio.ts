import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { ContractFunctionReturnType } from 'viem'
import { queryAggregatorAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { useAllCollections } from '../../lib/discovery'

/**
 * usePortfolio (W-F) — the connected wallet's holdings across ALL registered collections.
 *
 * Data flow:
 *  1. `useAllCollections()` enumerates every registered instance (W-A2 event-scan index) and
 *     exposes each card's `instance` + `vault` address.
 *  2. We collect the instance list + the DEDUPED set of non-zero vault addresses and feed them,
 *     with the connected `user`, to `QueryAggregator.getPortfolioData(user, instances, vaultAddrs)`.
 *
 * The aggregator caps each address-array at `MAX_QUERY_LIMIT` (50) on-chain; passing more reverts.
 * We therefore slice both arrays to MAX and set `truncated` when either was clipped, so the page
 * can warn that some holdings are not shown. (A paged variant is future work — not part of W-F.)
 *
 * Read idiom mirrors `useAllCollectionsRaw`: a React Query around `publicClient.readContract`,
 * keyed on chainId + user + the instance/vault sets so a chain reset or account switch refetches.
 */

const ZERO = '0x0000000000000000000000000000000000000000'

/** Aggregator hard cap on each address-array argument (QueryAggregator.MAX_QUERY_LIMIT). */
export const MAX_QUERY_LIMIT = 50

export type PortfolioData = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getPortfolioData'
>

export type Erc404Holding = PortfolioData[0][number]
export type Erc1155Holding = PortfolioData[1][number]
export type VaultPosition = PortfolioData[2][number]

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
 * - Both arrays are capped at `MAX_QUERY_LIMIT`; `truncated` is true if either was clipped.
 *
 * Extracted from the hook so it can be unit-tested without a chain.
 */
export function derivePortfolioInputs(
  cards: { instance: `0x${string}`; vault: `0x${string}` }[],
): PortfolioInputs {
  const allInstances = cards.map((c) => c.instance)

  const seen = new Set<string>()
  const allVaults: `0x${string}`[] = []
  for (const c of cards) {
    const v = c.vault.toLowerCase()
    if (c.vault !== ZERO && !seen.has(v)) {
      seen.add(v)
      allVaults.push(c.vault)
    }
  }

  const instances = allInstances.slice(0, MAX_QUERY_LIMIT)
  const vaultAddrs = allVaults.slice(0, MAX_QUERY_LIMIT)
  const truncated = allInstances.length > MAX_QUERY_LIMIT || allVaults.length > MAX_QUERY_LIMIT

  return { instances, vaultAddrs, truncated }
}

/** True when the portfolio has nothing worth showing (every section empty). */
export function isPortfolioEmpty(data: PortfolioData | undefined): boolean {
  if (!data) return true
  const [erc404, erc1155, vaults] = data
  const has404 = erc404.some(
    (h) =>
      h.tokenBalance > 0n || h.nftBalance > 0n || h.stakedBalance > 0n || h.pendingRewards > 0n,
  )
  const has1155 = erc1155.some((h) => h.balances.some((b) => b > 0n))
  const hasVault = vaults.some((v) => v.contribution > 0n || v.shares > 0n || v.claimable > 0n)
  return !has404 && !has1155 && !hasVault
}

export interface UsePortfolioResult {
  data: PortfolioData | undefined
  isPending: boolean
  isError: boolean
  /** True when the underlying collection index exceeded MAX_QUERY_LIMIT and was clipped. */
  truncated: boolean
  /** No connected wallet — caller should render the connect gate. */
  noWallet: boolean
}

export function usePortfolio(user: `0x${string}` | undefined): UsePortfolioResult {
  const client = usePublicClient({ chainId: forkChainId })
  const { data: cards, isPending: cardsPending, isError: cardsError } = useAllCollections()

  const { instances, vaultAddrs, truncated } = derivePortfolioInputs(cards ?? [])

  const enabled = !!client && !!user && cards !== undefined
  if (truncated) {
    console.warn(
      `[usePortfolio] collection index exceeds MAX_QUERY_LIMIT (${MAX_QUERY_LIMIT}); ` +
        `holdings beyond the cap are not shown.`,
    )
  }

  const { data, isPending, isError } = useQuery({
    queryKey: ['portfolio', forkChainId, user ?? null, instances.length, vaultAddrs.length],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<PortfolioData> => {
      if (!client || !user) throw new Error('portfolio query ran without client/user')
      const result = await client.readContract({
        address: forkAddresses.QueryAggregator,
        abi: queryAggregatorAbi,
        functionName: 'getPortfolioData',
        args: [user, instances, vaultAddrs],
      })
      return result as PortfolioData
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
