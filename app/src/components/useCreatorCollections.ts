import { useQuery } from '@tanstack/react-query'
import type { ContractFunctionReturnType } from 'viem'
import { usePublicClient } from 'wagmi'
import { masterRegistryV1Abi, queryAggregatorAbi } from '../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../lib/addresses'
import { scanBackward } from '../lib/logScan'

export type ProjectCard = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getProjectCardsBatch'
>[number]

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
