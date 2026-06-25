import { useReadQueryAggregatorGetProjectCardsBatch } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import type { ProjectCard } from './useCreatorCollections'

export function useCollection(instance: `0x${string}` | undefined): {
  data: ProjectCard | undefined
  isPending: boolean
  isError: boolean
} {
  const { data, isPending, isError } = useReadQueryAggregatorGetProjectCardsBatch({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [instance ? [instance] : []],
    query: { enabled: !!instance },
  })

  return {
    data: data?.[0] as ProjectCard | undefined,
    isPending,
    isError,
  }
}
