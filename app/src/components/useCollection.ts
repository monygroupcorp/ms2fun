import { useReadQueryAggregatorGetProjectCardsBatch } from '../generated/contracts'
import { forkAddresses, forkChainId, type Addresses, type SupportedChainId } from '../lib/addresses'
import type { ProjectCard } from './useCreatorCollections'

/**
 * Reads a single project card by instance address. Defaults to the fork chain/addresses (used by
 * the legacy `/collection/:instance` redirector, which is chain-blind by design — Step 8 of
 * chain-scoped-slug-routes). Route-scoped callers (inside `CollectionChainProvider`) pass the
 * route chainId/addresses explicitly so the read targets the resolved chain, not always the fork.
 */
export function useCollection(
  instance: `0x${string}` | undefined,
  scope: { chainId: SupportedChainId; addresses: Addresses } = {
    chainId: forkChainId,
    addresses: forkAddresses,
  },
): {
  data: ProjectCard | undefined
  isPending: boolean
  isError: boolean
} {
  const { data, isPending, isError } = useReadQueryAggregatorGetProjectCardsBatch({
    address: scope.addresses.QueryAggregator,
    chainId: scope.chainId,
    args: [instance ? [instance] : []],
    query: { enabled: !!instance },
  })

  return {
    data: data?.[0] as ProjectCard | undefined,
    isPending,
    isError,
  }
}
