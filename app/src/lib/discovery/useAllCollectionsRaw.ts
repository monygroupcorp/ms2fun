import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { queryAggregatorAbi } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../addresses'
import type { ProjectCard } from './types'
import { scanAllInstances } from './scanInstances'

/**
 * Raw fetch — no filters, no sort. Scans `MasterRegistryV1.CreatorInstanceAdded` for ALL
 * instances, then hydrates them via `QueryAggregator.getProjectCardsBatch` in one call.
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

      if (instances.length === 0) return []

      const cards = await client.readContract({
        address: forkAddresses.QueryAggregator,
        abi: queryAggregatorAbi,
        functionName: 'getProjectCardsBatch',
        args: [instances],
      })

      return cards as ProjectCard[]
    },
  })

  return { data, isPending, isError }
}
