import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { forkAddresses, forkChainId } from '../addresses'
import { fetchProjectCardsBatched } from './batchRead'
import type { ProjectCard } from './types'

/**
 * Hydrate a NAMED set of instances, rather than every instance the registry ever logged.
 *
 * `useAllCollectionsRaw` scans the registry first because it does not know what it is looking for.
 * A curation does: its picks name their addresses, so the scan is skipped entirely and the only
 * cost is `ceil(n / QUERY_WINDOW)` aggregator reads — which is what makes a curation page cheap to
 * open however long the registry has grown.
 *
 * An address the aggregator does not answer for is simply absent from the result; callers match by
 * address and render a miss as unresolved rather than assuming positional alignment.
 */
export function useProjectCards(instances: readonly `0x${string}`[] | undefined): {
  data: ProjectCard[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  // Sorted + deduped so two orderings of the same picks share one cache entry, and so reordering a
  // curation does not re-read the chain.
  const key = [...new Set((instances ?? []).map((a) => a.toLowerCase()))].sort()

  const { data, isPending, isError } = useQuery({
    queryKey: ['project-cards', forkChainId, forkAddresses.QueryAggregator, key],
    enabled: !!client && instances !== undefined,
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectCard[]> => {
      if (!client || key.length === 0) return []
      return fetchProjectCardsBatched(client, key as `0x${string}`[])
    },
  })

  return { data, isPending, isError }
}
