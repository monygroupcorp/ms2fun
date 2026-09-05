import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { forkAddresses, forkChainId } from '../addresses'
import type { ProjectCard } from './types'
import { fetchProjectCardsBatched } from './batchRead'
import { scanAllInstances } from './scanInstances'

/**
 * Raw fetch — no filters, no sort. Scans the registry for ALL live instances, then hydrates them
 * via `QueryAggregator.getProjectCardsBatch` in windows of at most `MAX_QUERY_LIMIT` — the
 * aggregator reverts on a longer array, and the registry only grows, so a single whole-array call
 * fails permanently past the cap (see `batchRead.ts`).
 *
 * Query key: `['all-collections', forkChainId, forkAddresses.MasterRegistryV1]`
 *
 * The chainId + registry address pair acts as the chain-reset guard: if the local fork is
 * restarted and the bridge regenerates `local-deployment.json` with new addresses, the
 * MasterRegistryV1 key changes → React Query treats it as a different query and re-fetches
 * from scratch, discarding any stale data from the previous fork deployment.
 *
 * staleTime 30 s — balances freshness against redundant log scans during normal browsing.
 * After a create or feature tx, call:
 *   queryClient.invalidateQueries({ queryKey: ['all-collections'] })
 * (wire that into the wizard / admin panel — not part of W-A2).
 */
export const allCollectionsQueryKey = [
  'all-collections',
  forkChainId,
  forkAddresses.MasterRegistryV1,
] as const

export function useAllCollectionsRaw(): {
  data: ProjectCard[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending, isError } = useQuery({
    queryKey: allCollectionsQueryKey,
    enabled: !!client,
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectCard[]> => {
      if (!client) return []

      const instances = await scanAllInstances(client)

      return fetchProjectCardsBatched(client, instances)
    },
  })

  return { data, isPending, isError }
}
