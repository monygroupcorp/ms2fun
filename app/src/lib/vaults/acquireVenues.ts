/**
 * useAcquireVenues — the AMM each alignment target is curated on.
 *
 * A VENUE is where an alignment vault trades and provides liquidity: a collection tithes ETH, its
 * vault swaps that for the community's token through the curated route, and puts the pair in as
 * liquidity. The venue is therefore the answer to "which pool gets deeper when someone aligns here".
 *
 * The registry stores exactly ONE route per (target, asset), which is why an asset offered on two
 * AMMs is two targets on chain. That is storage shape, not something a visitor should meet — so the
 * venue is read from the route itself and named for what it IS, rather than inferred from a target's
 * title (`MS2-ZAMM`) or shown as a registry id.
 */
import { useReadContracts } from 'wagmi'
import { alignmentRegistryV1Abi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../addresses'

/** `IAlignmentRegistry.Venue` — kept in the same order as the enum it mirrors. */
export const VENUE_LABELS = ['not curated', 'Uniswap V4', 'ZAMM', 'Cypher'] as const

export function venueLabel(venue: number | undefined): string {
  if (venue === undefined) return 'venue unread'
  return VENUE_LABELS[venue] ?? `venue ${venue}`
}

export interface AcquirePair {
  targetId: bigint
  token: `0x${string}` | undefined
}

/**
 * Read the curated venue for each (target, asset) pair. Keyed by target id as a string, because a
 * bigint is not a usable Map key across renders.
 */
export function useAcquireVenues(pairs: readonly AcquirePair[]): {
  venueByTargetId: Map<string, number>
  isPending: boolean
} {
  const readable = pairs.filter((p): p is { targetId: bigint; token: `0x${string}` } => !!p.token)

  const { data, isPending } = useReadContracts({
    allowFailure: true,
    contracts: readable.map((p) => ({
      address: forkAddresses.AlignmentRegistryV1,
      abi: alignmentRegistryV1Abi,
      functionName: 'getAcquireRoute' as const,
      args: [p.targetId, p.token] as const,
      chainId: forkChainId,
    })),
    query: { enabled: readable.length > 0 },
  })

  const venueByTargetId = new Map<string, number>()
  readable.forEach((pair, i) => {
    const result = data?.[i]
    if (result?.status !== 'success') return
    const route = result.result as { venue: number } | undefined
    if (route?.venue === undefined) return
    venueByTargetId.set(pair.targetId.toString(), Number(route.venue))
  })

  return { venueByTargetId, isPending: isPending && readable.length > 0 }
}
