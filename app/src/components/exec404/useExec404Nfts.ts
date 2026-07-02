/**
 * useExec404Nfts — the connected wallet's EXEC (DN404) NFT holdings, reconstructed from the mirror's
 * Transfer log (the mirror exposes no enumerable view). We pull only the logs that touch the wallet
 * (indexed `to == owner` and `from == owner` filters — cheap even over full history), replay them to
 * the live id set (ownedIdsFromTransfers), then read each id's art via base `tokenURI` + fetchJson.
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

export interface UseExec404NftsResult {
  nfts: Exec404Nft[]
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useExec404Nfts(owner: `0x${string}` | undefined): UseExec404NftsResult {
  const client = usePublicClient({ chainId: EXEC404_CHAIN_ID })

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['exec404-nfts', owner ?? null],
    enabled: !!client && !!owner,
    staleTime: 15_000,
    queryFn: async (): Promise<Exec404Nft[]> => {
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

      const ids = ownedIdsFromTransfers(transfers, owner)
      if (ids.length === 0) return []

      // Per-id art from the base's tokenURI, then resolve the metadata image.
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
    isPending: isPending && !!owner,
    isError,
    refetch: () => void refetch(),
  }
}
