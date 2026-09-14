import type { PublicClient } from 'viem'
import { queryAggregatorAbi } from '../../generated/contracts'
import { forkAddresses } from '../addresses'
import type { ProjectCard } from './types'

/**
 * Client-side windowing for the aggregator's bounded array reads.
 *
 * `QueryAggregator.getProjectCardsBatch` and `getPortfolioData` both open with
 * `if (array.length > MAX_QUERY_LIMIT) revert TooManyInstances()`. That bound is a pure function of
 * the argument length, so a caller that hands over "every instance the registry ever logged" does
 * not degrade past the limit — it reverts, and keeps reverting, because the registry only grows.
 *
 * The fix is entirely client-side: slice the address list into windows no wider than the cap and
 * concatenate the results. Semantics are unchanged (every instance is still read, in the same
 * order); the cost is `ceil(n / width)` round-trips instead of one. The width actually used is
 * `QUERY_WINDOW` below, which sits under the contract cap because gas binds before the cap does.
 */

/** Aggregator hard cap on each address-array argument (`QueryAggregator.MAX_QUERY_LIMIT`). */
export const MAX_QUERY_LIMIT = 50

/**
 * Width of one aggregator window — BELOW the contract cap, because gas binds first.
 *
 * `getProjectCardsBatch` measured against 50 instances (forge, mocked instances):
 *
 *     50 × EOA (nothing hydrates)        1.82 M
 *     50 × ERC721, one auction line      1.94 M
 *     50 × ERC404                        1.99 M
 *     50 × ERC1155 @ 100 editions       99.64 M   ← over geth's 50 M `eth_call` default
 *
 * `_hydrateERC1155CardData` loops up to `MAX_EDITIONS_PER_CARD` (100) editions and makes two guarded
 * external reads per edition, so a window of ERC1155 cards is two orders of magnitude heavier than
 * the same window of anything else — and cost is superlinear in the window, from memory expansion.
 * Sweeping that worst case: 5 → 5.2 M, 10 → 11.5 M, 15 → 18.8 M, 20 → 27.2 M, 25 → 36.6 M.
 *
 * 20 is the width chosen: it holds the worst case to 27.2 M, inside geth's 50 M default with room to
 * spare and inside the 30 M ceiling some public endpoints set. The measurement is a FLOOR — the mock
 * returns its edition strings from code, where a real `ERC1155Instance.getEdition` reads them from
 * storage — which is the reason for the headroom rather than taking 25.
 *
 * This is a client-side read strategy, not a protocol constant: raising it costs availability on the
 * heaviest instances, lowering it costs round-trips. `MAX_QUERY_LIMIT` above is the contract's bound
 * and is not ours to choose.
 */
export const QUERY_WINDOW = 20

/**
 * Split `items` into consecutive windows of at most `width`, preserving order. An empty input
 * yields no windows, so callers never issue a zero-length read.
 */
export function chunk<T>(items: readonly T[], width: number = QUERY_WINDOW): T[][] {
  if (width <= 0) throw new Error('chunk width must be > 0')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += width) {
    out.push(items.slice(i, i + width))
  }
  return out
}

/**
 * `getProjectCardsBatch` over an unbounded instance list, in `ceil(n / QUERY_WINDOW)` windows.
 *
 * Windows are read sequentially rather than in parallel: a browse surface backed by a public RPC is
 * rate-limited long before it is latency-bound, and the batch read is already the heaviest call the
 * app makes.
 */
export async function fetchProjectCardsBatched(
  client: PublicClient,
  instances: readonly `0x${string}`[],
  width: number = QUERY_WINDOW,
): Promise<ProjectCard[]> {
  const cards: ProjectCard[] = []
  for (const window of chunk(instances, width)) {
    const page = (await client.readContract({
      address: forkAddresses.QueryAggregator,
      abi: queryAggregatorAbi,
      functionName: 'getProjectCardsBatch',
      args: [window as `0x${string}`[]],
    })) as ProjectCard[]
    cards.push(...page)
  }
  return cards
}
