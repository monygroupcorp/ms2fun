import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { forkChainId } from '../lib/addresses'
import { fetchProjectCardsBatched } from '../lib/discovery/batchRead'
import { scanCreatorInstances } from '../lib/discovery/scanInstances'
import type { ProjectCard } from '../lib/discovery/types'

export type { ProjectCard }

/**
 * One creator's collections.
 *
 * Enumerated by `scanCreatorInstances`, which subtracts revoked instances the same way the global
 * index does. This page used to scan `CreatorInstanceAdded` alone, so a revoked collection kept its
 * slot here after disappearing from every other listing — and hydrated with an empty name and a zero
 * creator, which strips the attribution rather than removing the collection.
 *
 * Hydrated in `QUERY_WINDOW`-wide windows for the same reason the global index is:
 * `getProjectCardsBatch` reverts past the aggregator's cap, and a prolific creator crosses it on
 * their own without the registry having to (see `lib/discovery/batchRead.ts`).
 */
export function useCreatorCollections(creator: `0x${string}` | undefined): {
  data: ProjectCard[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending, isError } = useQuery({
    queryKey: ['creator-collections', creator],
    enabled: !!creator && !!client,
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectCard[]> => {
      if (!creator || !client) return []

      const instances = await scanCreatorInstances(client, creator)
      return fetchProjectCardsBatched(client, instances)
    },
  })

  return { data, isPending, isError }
}
