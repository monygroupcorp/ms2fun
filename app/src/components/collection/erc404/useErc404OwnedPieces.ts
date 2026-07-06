/**
 * The connected wallet's owned NFT pieces for a bonding ERC404 collection — the data behind the
 * holder "portfolio" (reroll's keep-selection grid, T2). Same technique as the EXEC portfolio: the
 * DN404 mirror exposes no enumeration, so we replay the mirror's Transfer log filtered to the owner
 * (`ownedIdsFromTransfers`, pure + tested) to get the held ids, then read `tokenURI` for each to show
 * the art. Parameterised by the instance (mirror resolved from it), so it works for any collection.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { useReadErc404BondingInstanceMirrorErc721 } from '../../../generated/contracts'
import { deployBlock, forkChainId } from '../../../lib/addresses'
import { exec404MirrorAbi, ownedIdsFromTransfers, type MirrorTransfer } from '../../../lib/exec404'
import { scanBackward } from '../../../lib/logScan'
import { fetchJson } from '../../../lib/metadata'

/** Minimal `tokenURI` read on the DN404 mirror (exec404MirrorAbi carries the Transfer event + reads,
 *  but not tokenURI). */
const mirrorTokenUriAbi = [
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
] as const

export interface OwnedPiece {
  id: bigint
  image: string | undefined
}

export function useErc404OwnedPieces(
  instance: `0x${string}`,
  owner: `0x${string}` | undefined,
): {
  pieces: OwnedPiece[]
  isPending: boolean
  refetch: () => void
} {
  const client = usePublicClient({ chainId: forkChainId })
  const { data: mirror } = useReadErc404BondingInstanceMirrorErc721({
    address: instance,
    chainId: forkChainId,
  })

  const { data, isPending, refetch } = useQuery({
    queryKey: ['erc404-owned-pieces', instance, mirror ?? null, owner ?? null],
    enabled: !!client && !!mirror && !!owner,
    staleTime: 15_000,
    queryFn: async (): Promise<OwnedPiece[]> => {
      if (!client || !mirror || !owner) return []

      // Owned-set reconstruction: full Transfer replay touching this wallet (can't early-stop), but
      // floored at our deploy block (ADR-0010, not `0n`) and windowed (cap-safe).
      const latest = await client.getBlockNumber()
      const scan = (args: { to: `0x${string}` } | { from: `0x${string}` }) =>
        scanBackward(
          (fromBlock, toBlock) =>
            client.getContractEvents({
              address: mirror,
              abi: exec404MirrorAbi,
              eventName: 'Transfer',
              args,
              fromBlock,
              toBlock,
            }),
          { latest, floor: deployBlock },
        )

      const [inbound, outbound] = await Promise.all([scan({ to: owner }), scan({ from: owner })])

      const transfers: MirrorTransfer[] = []
      for (const log of [...inbound, ...outbound]) {
        const { from, to, id } = log.args
        if (from === undefined || to === undefined || id === undefined) continue
        if (log.blockNumber === null || log.logIndex === null) continue
        transfers.push({ from, to, id, blockNumber: log.blockNumber, logIndex: log.logIndex })
      }

      const ids = ownedIdsFromTransfers(transfers, owner)
      if (ids.length === 0) return []

      const uris = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          address: mirror,
          abi: mirrorTokenUriAbi,
          functionName: 'tokenURI' as const,
          args: [id] as const,
        })),
      })

      return Promise.all(
        ids.map(async (id, i): Promise<OwnedPiece> => {
          const res = uris[i]
          const uri = res && res.status === 'success' ? res.result : ''
          const meta = uri ? await fetchJson<{ image?: string }>(uri) : null
          return { id, image: meta?.image }
        }),
      )
    },
  })

  return { pieces: data ?? [], isPending: isPending && !!owner, refetch: () => void refetch() }
}
