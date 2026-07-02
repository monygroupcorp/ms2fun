/**
 * EXEC (DN404) NFT holdings for the connected wallet, split so the view can PAGINATE:
 *   useExec404NftIds(owner)  — the full owned id set, reconstructed from the mirror's Transfer log
 *                              (the mirror exposes no enumerable view). Cheap: only the indexed
 *                              `to==owner`/`from==owner` logs, replayed by ownedIdsFromTransfers.
 *   useExec404NftPage(ids)   — metadata (art/name/description/traits) for ONE page of ids only, via
 *                              base `tokenURI` + fetchJson. This is the expensive part (N fetches),
 *                              so the caller passes just the current page's ids — a wallet with 300
 *                              NFTs never fetches 300 metadata blobs at once.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import {
  EXEC404_ADDRESS,
  EXEC404_CHAIN_ID,
  EXEC404_MIRROR_ADDRESS,
  exec404Abi,
  exec404MirrorAbi,
  ownedIdsFromTransfers,
  type MirrorTransfer,
} from '../../lib/exec404'
import { fetchJson } from '../../lib/metadata'

export interface Exec404Trait {
  trait_type: string
  value: string
}

export interface Exec404Nft {
  id: bigint
  image: string | undefined
  name: string | undefined
  description: string | undefined
  attributes: Exec404Trait[]
}

/** Coerce arbitrary metadata `attributes` into safe {trait_type, value} string pairs. */
function normalizeAttributes(raw: unknown): Exec404Trait[] {
  if (!Array.isArray(raw)) return []
  const out: Exec404Trait[] = []
  for (const a of raw) {
    if (a && typeof a === 'object') {
      const t = (a as Record<string, unknown>).trait_type
      const v = (a as Record<string, unknown>).value
      if (v !== undefined && v !== null) {
        out.push({ trait_type: typeof t === 'string' ? t : '', value: String(v) })
      }
    }
  }
  return out
}

export interface UseExec404NftIdsResult {
  ids: bigint[]
  isPending: boolean
  isError: boolean
  refetch: () => void
}

/** The wallet's owned EXEC NFT ids (all of them — enumeration is cheap; metadata is not). */
export function useExec404NftIds(owner: `0x${string}` | undefined): UseExec404NftIdsResult {
  const client = usePublicClient({ chainId: EXEC404_CHAIN_ID })

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['exec404-nft-ids', owner ?? null],
    enabled: !!client && !!owner,
    staleTime: 15_000,
    queryFn: async (): Promise<bigint[]> => {
      if (!client || !owner) return []
      const base = {
        address: EXEC404_MIRROR_ADDRESS,
        abi: exec404MirrorAbi,
        eventName: 'Transfer',
        fromBlock: 0n,
        toBlock: 'latest',
      } as const

      // Only logs that touch this wallet (indexed filters), inbound + outbound.
      const [inbound, outbound] = await Promise.all([
        client.getContractEvents({ ...base, args: { to: owner } }),
        client.getContractEvents({ ...base, args: { from: owner } }),
      ])

      const transfers: MirrorTransfer[] = []
      for (const log of [...inbound, ...outbound]) {
        const { from, to, id } = log.args
        if (from === undefined || to === undefined || id === undefined) continue
        if (log.blockNumber === null || log.logIndex === null) continue
        transfers.push({ from, to, id, blockNumber: log.blockNumber, logIndex: log.logIndex })
      }

      return ownedIdsFromTransfers(transfers, owner)
    },
  })

  return {
    ids: data ?? [],
    isPending: isPending && !!owner,
    isError,
    refetch: () => void refetch(),
  }
}

export interface UseExec404NftPageResult {
  nfts: Exec404Nft[]
  isPending: boolean
  isError: boolean
}

/** Metadata for ONE page of ids (caller slices). Keyed on the exact ids so paging refetches. */
export function useExec404NftPage(ids: readonly bigint[]): UseExec404NftPageResult {
  const client = usePublicClient({ chainId: EXEC404_CHAIN_ID })
  const key = ids.map((id) => id.toString()).join(',')

  const { data, isPending, isError } = useQuery({
    queryKey: ['exec404-nft-page', key],
    enabled: !!client && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Exec404Nft[]> => {
      if (!client || ids.length === 0) return []

      // Per-id art from the base's tokenURI, then resolve the metadata.
      const uris = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          address: EXEC404_ADDRESS,
          abi: exec404Abi,
          functionName: 'tokenURI' as const,
          args: [id] as const,
        })),
      })

      return Promise.all(
        ids.map(async (id, i) => {
          const uriRes = uris[i]
          const uri = uriRes && uriRes.status === 'success' ? uriRes.result : ''
          const meta = uri
            ? await fetchJson<{
                image?: string
                name?: string
                description?: string
                attributes?: unknown
              }>(uri)
            : null
          return {
            id,
            image: meta?.image,
            name: meta?.name,
            description: meta?.description,
            attributes: normalizeAttributes(meta?.attributes),
          }
        }),
      )
    },
  })

  return {
    nfts: data ?? [],
    isPending: isPending && ids.length > 0,
    isError,
  }
}
