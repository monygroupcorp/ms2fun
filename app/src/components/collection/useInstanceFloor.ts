import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { deployBlockForChain, type SupportedChainId } from '../../lib/addresses'
import { findInstanceCreatedBlock } from '../../lib/discovery/instanceCreatedBlock'

/**
 * The floor for `instance`'s own history scans: the block it was registered in
 * (`findInstanceCreatedBlock`). `undefined` while the lookup runs, so a scan waits for it rather than
 * starting at the protocol's deploy block and walking windows that cannot hold the collection's
 * events. If the lookup fails the floor is the deploy block, which is always correct, only wider.
 */
export function useInstanceFloor(
  instance: `0x${string}` | undefined,
  chainId: SupportedChainId,
): bigint | undefined {
  const client = usePublicClient({ chainId })
  const { data, isError } = useQuery({
    queryKey: ['instance-created-block', chainId, instance ?? null],
    enabled: !!client && instance !== undefined,
    // A registration block never changes.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: () => findInstanceCreatedBlock(client!, chainId, instance!),
  })
  if (instance === undefined || isError) return deployBlockForChain(chainId)
  return data
}
