import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { masterRegistryV1Abi } from '../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../lib/addresses'
import { fetchProjectCardsBatched } from '../lib/discovery/batchRead'
import { scanBackward } from '../lib/logScan'
import type { ProjectCard } from '../lib/discovery/types'

export type { ProjectCard }

/**
 * One creator's collections. Hydrated in `MAX_QUERY_LIMIT`-wide windows for the same reason the
 * global index is: `getProjectCardsBatch` reverts on a longer array, and a prolific creator crosses
 * the cap on their own without the registry having to (see `lib/discovery/batchRead.ts`).
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

      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: forkAddresses.MasterRegistryV1,
            abi: masterRegistryV1Abi,
            eventName: 'CreatorInstanceAdded',
            args: { creator },
            fromBlock,
            toBlock,
          }),
        { latest, floor: deployBlock },
      )

      const seen = new Set<`0x${string}`>()
      const instances: `0x${string}`[] = []
      for (const log of logs) {
        const inst = log.args.instance
        if (inst && !seen.has(inst)) {
          seen.add(inst)
          instances.push(inst)
        }
      }

      return fetchProjectCardsBatched(client, instances)
    },
  })

  return { data, isPending, isError }
}
