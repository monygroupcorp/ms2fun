/**
 * The connected wallet's owned NFT pieces for a bonding ERC404 collection — the data behind the
 * holder "portfolio" (reroll's keep-selection grid, T2). Same technique as the EXEC portfolio: the
 * DN404 mirror exposes no enumeration, so we replay the mirror's Transfer log filtered to the owner
 * (`ownedIdsFromTransfers`, pure + tested) to get the held ids, then read `tokenURI` for each to show
 * the art. Parameterised by the instance (mirror resolved from it), so it works for any collection.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import {
  useReadErc404BondingInstanceMirrorErc721,
  useReadErc404BondingInstanceTotalSupply,
  useReadErc404BondingInstanceUnit,
} from '../../../generated/contracts'
import { deployBlock } from '../../../lib/addresses'
import { useCollectionChainId } from '../useCollectionChain'
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
  /** True when the id sits above `idLimit` — a tier (band) NFT rather than an ordinary piece. */
  isTier: boolean
}

export interface OwnedPieces {
  pieces: OwnedPiece[]
  /** Coin per whole NFT (`unit()`), needed by the reroll arithmetic. Undefined until the read lands. */
  unit: bigint | undefined
  /** `totalSupply / unit` — the top of the ordinary id space. Undefined until both reads land. */
  idLimit: bigint | undefined
  isPending: boolean
  refetch: () => void
}

export function useErc404OwnedPieces(
  instance: `0x${string}`,
  owner: `0x${string}` | undefined,
): OwnedPieces {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })
  const { data: mirror } = useReadErc404BondingInstanceMirrorErc721({
    address: instance,
    chainId: chainId,
  })

  // Tier awareness, derived rather than enumerated. `tierBands` is a public array with no length
  // getter, so the app never walks it; the contract's own pre-filter is the whole test we need —
  // band ids live STRICTLY above `idLimit = totalSupply / unit`, and DN404 bounds every ordinary
  // auto-minted id with `_wrapNFTId(.., idLimit)`. `totalSupply` is fixed at `maxSupply` for the
  // instance's life, so `idLimit` is stable. On an untiered instance no id can exceed it, so the
  // flag is uniformly false and every surface below behaves exactly as it did before.
  const { data: totalSupply } = useReadErc404BondingInstanceTotalSupply({
    address: instance,
    chainId: chainId,
  })
  const { data: unit } = useReadErc404BondingInstanceUnit({
    address: instance,
    chainId: chainId,
  })
  const idLimit =
    totalSupply !== undefined && unit !== undefined && unit > 0n ? totalSupply / unit : undefined

  const { data, isPending, refetch } = useQuery({
    queryKey: [
      'erc404-owned-pieces',
      instance,
      mirror ?? null,
      owner ?? null,
      idLimit?.toString() ?? null,
    ],
    // `idLimit` gates the query as well: labelling a piece before it is known would render an
    // ordinary piece as protected (or the reverse) for one frame.
    enabled: !!client && !!mirror && !!owner && idLimit !== undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<OwnedPiece[]> => {
      if (!client || !mirror || !owner || idLimit === undefined) return []

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
          return { id, image: meta?.image, isTier: id > idLimit }
        }),
      )
    },
  })

  return {
    pieces: data ?? [],
    unit,
    idLimit,
    isPending: isPending && !!owner,
    refetch: () => void refetch(),
  }
}
