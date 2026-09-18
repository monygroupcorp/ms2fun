import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ContractFunctionReturnType } from 'viem'
import {
  curationRegistryAbi,
  useReadCurationRegistryCanEdit,
  useReadCurationRegistryCurationIdsOf,
  useReadCurationRegistryGetCuration,
  useReadCurationRegistryGetCurations,
  useReadCurationRegistryLatestCurations,
  useReadCurationRegistryTotalCurations,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { orderCurations } from '../../lib/curation'
import { fetchJson, isResolvableUri, jsonOrNull, parseCuration } from '../../lib/metadata'
import type { CurationMetadata } from '../../lib/metadata'

/** One curation's on-chain record, derived from the ABI so there is no hand-written duplicate. */
export type CurationRecord = ContractFunctionReturnType<
  typeof curationRegistryAbi,
  'view',
  'getCuration'
>

/** A record paired with the id it answers to — what every curation surface actually renders. */
export interface IdentifiedCuration {
  id: bigint
  curation: CurationRecord
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Whether this build's chain has a curation registry at all.
 *
 * The contract is newer than the deployments that carry it, so a build pointed at a chain deployed
 * before it resolves the zero address here. Every surface checks this and says the registry is not
 * on this network, rather than issuing a read that fails and rendering it as "unreachable".
 */
export const curationsAvailable: boolean = forkAddresses.CurationRegistry !== ZERO_ADDRESS

const base = { address: forkAddresses.CurationRegistry, chainId: forkChainId } as const

/**
 * The curations that are on view, most recently worked on first — the discovery read.
 *
 * Two orderings meet here, and they are not the same one. The CONTRACT pages by id, descending:
 * publication order, which is stable and is the only thing an on-chain walk can page by without
 * sorting storage. The WALL is ordered by `updatedAt`, so a curator who returns to an old set and
 * adds to it moves it back up — see `lib/curation/curationOrder` for why that is the only signal
 * this surface will take. The re-sort therefore applies WITHIN the page the contract returned: at
 * one page it is the whole ordering, and a second page would need the offset to walk `updatedAt`
 * on-chain before it could claim more than that.
 *
 * The contract does the filtering and the trimming (`latestCurations` skips retired curations and
 * returns a short last page rather than zero rows), so that half costs no client-side pass.
 */
export function useLatestCurations(limit: number): {
  data: IdentifiedCuration[] | undefined
  isPending: boolean
  isError: boolean
} {
  const { data, isPending, isError } = useReadCurationRegistryLatestCurations({
    ...base,
    args: [0n, BigInt(limit)],
    query: { enabled: curationsAvailable && limit > 0 },
  })

  const rows = useMemo((): IdentifiedCuration[] | undefined => {
    if (data === undefined) return undefined
    const [ids, curations] = data
    const paired = ids.map((id, i) => ({
      id,
      curation: curations[i] as CurationRecord,
      updatedAt: (curations[i] as CurationRecord).updatedAt,
    }))
    return orderCurations(paired).map(({ id, curation }) => ({ id, curation }))
  }, [data])

  if (!curationsAvailable) return { data: [], isPending: false, isError: false }
  return { data: rows, isPending, isError }
}

/** One curation by id. `undefined` while loading, and `isError` for an id nobody published. */
export function useCuration(id: bigint | undefined): {
  data: CurationRecord | undefined
  isPending: boolean
  isError: boolean
  queryKey: readonly unknown[]
} {
  const { data, isPending, isError, queryKey } = useReadCurationRegistryGetCuration({
    ...base,
    args: [id ?? 0n],
    query: { enabled: curationsAvailable && id !== undefined && id > 0n },
  })
  return { data, isPending, isError, queryKey }
}

/**
 * Every curation an address has published, newest first — including its retired ones.
 *
 * The retired ones are deliberately here where `useLatestCurations` drops them: this backs a
 * curator's own shelf, and a curation you took off view is still yours to find and put back.
 * Callers that render someone else's shelf filter them out.
 */
export function useCurationsOf(curator: `0x${string}` | undefined): {
  data: IdentifiedCuration[] | undefined
  isPending: boolean
  isError: boolean
  queryKey: readonly unknown[]
} {
  const enabled = curationsAvailable && curator !== undefined
  const {
    data: ids,
    isPending: idsPending,
    isError: idsError,
    queryKey,
  } = useReadCurationRegistryCurationIdsOf({
    ...base,
    args: [curator ?? ZERO_ADDRESS],
    query: { enabled },
  })

  // Newest first: `curationIdsOf` returns publication order, and ids are monotonic.
  const newestFirst = useMemo(() => (ids === undefined ? undefined : [...ids].reverse()), [ids])

  const {
    data: records,
    isPending: recordsPending,
    isError: recordsError,
  } = useReadCurationRegistryGetCurations({
    ...base,
    args: [newestFirst ?? []],
    query: { enabled: enabled && newestFirst !== undefined && newestFirst.length > 0 },
  })

  const rows = useMemo((): IdentifiedCuration[] | undefined => {
    if (newestFirst === undefined) return undefined
    if (newestFirst.length === 0) return []
    if (records === undefined) return undefined
    return newestFirst.map((id, i) => ({ id, curation: records[i] as CurationRecord }))
  }, [newestFirst, records])

  if (!curationsAvailable) {
    return { data: [], isPending: false, isError: false, queryKey }
  }
  return {
    data: rows,
    isPending:
      idsPending || (newestFirst !== undefined && newestFirst.length > 0 && recordsPending),
    isError: idsError || recordsError,
    queryKey,
  }
}

/**
 * How many curations have ever been published — every one, including those a curator has taken off
 * view. It is deliberately NOT the length of the wall: the wall shows what is on view, and a count
 * that quietly meant something narrower than its label would be the wrong number to put beside it.
 * Surfaces render it as "published", which is exactly what the registry counts.
 */
export function useCurationCount(): bigint | undefined {
  const { data } = useReadCurationRegistryTotalCurations({
    ...base,
    query: { enabled: curationsAvailable },
  })
  return data
}

/**
 * Whether `who` may repoint curation `id` — asked of the contract, never inferred.
 *
 * The edit controls are drawn from this, so the button set a wallet is offered cannot be wider than
 * the rules the registry would actually enforce: a collaborator revoked in another tab loses the
 * control on the next read rather than on a failed signature.
 */
export function useCurationCanEdit(
  id: bigint | undefined,
  who: `0x${string}` | undefined,
): { data: boolean | undefined } {
  const { data } = useReadCurationRegistryCanEdit({
    ...base,
    args: [id ?? 0n, who ?? ZERO_ADDRESS],
    query: { enabled: curationsAvailable && id !== undefined && who !== undefined },
  })
  return { data }
}

/**
 * Resolve a curation's on-chain pointer to its JSON — the same path `useProfileMetadata` takes, and
 * the same guarantee: coerced to a safe shape, never thrown on, whatever a gateway answers.
 */
export function useCurationMetadata(uri: string | undefined): CurationMetadata | undefined {
  const { data } = useQuery({
    queryKey: ['curation-metadata', uri],
    enabled: isResolvableUri(uri),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) =>
      parseCuration(jsonOrNull(await fetchJson(uri as string, signal))),
  })
  return data
}
