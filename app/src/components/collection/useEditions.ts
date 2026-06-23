/**
 * useEditions — fetches all ERC1155 editions for a given instance via the QueryAggregator
 * batch call. Editions are 1-indexed; the count is read first so we can issue a single
 * `getERC1155EditionsBatch(instance, 1, count)` request rather than individual per-edition
 * reads.
 */
import type { ContractFunctionReturnType } from 'viem'
import {
  queryAggregatorAbi,
  useReadErc1155InstanceGetEditionCount,
  useReadQueryAggregatorGetErc1155EditionsBatch,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'

/** Derived from the ABI — no hand-written shape, no `any`. */
export type EditionView = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getERC1155EditionsBatch'
>[number]

export interface UseEditionsResult {
  data: readonly EditionView[]
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useEditions(instance: `0x${string}` | undefined): UseEditionsResult {
  const {
    data: countData,
    isPending: countPending,
    isError: countError,
    refetch: refetchCount,
  } = useReadErc1155InstanceGetEditionCount({
    ...(instance ? { address: instance } : {}),
    chainId: forkChainId,
    query: { enabled: !!instance },
  })

  const count = countData ?? 0n
  const hasEditions = count > 0n

  const {
    data: editionsData,
    isPending: editionsPending,
    isError: editionsError,
    refetch: refetchEditions,
  } = useReadQueryAggregatorGetErc1155EditionsBatch({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: instance ? [instance, 1n, count] : undefined,
    query: { enabled: !!instance && hasEditions },
  })

  function refetch(): void {
    void refetchCount()
    void refetchEditions()
  }

  // While count is still loading, surface pending state.
  if (!instance) {
    return { data: [], isPending: false, isError: false, refetch }
  }

  if (countPending) {
    return { data: [], isPending: true, isError: false, refetch }
  }

  if (countError) {
    return { data: [], isPending: false, isError: true, refetch }
  }

  // Count loaded, no editions.
  if (!hasEditions) {
    return { data: [], isPending: false, isError: false, refetch }
  }

  // Count loaded, waiting on batch.
  if (editionsPending) {
    return { data: [], isPending: true, isError: false, refetch }
  }

  if (editionsError) {
    return { data: [], isPending: false, isError: true, refetch }
  }

  return {
    data: editionsData ?? [],
    isPending: false,
    isError: false,
    refetch,
  }
}
