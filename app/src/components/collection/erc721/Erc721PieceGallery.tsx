/**
 * Erc721PieceGallery (W-D3) — the full set of an ERC721 auction collection's pieces (not just the
 * live ones useAuctions surfaces). `nextTokenId` is the minted-count cursor: ids run `1..next-1`.
 * Per id we read the `getAuction(id)` struct (which carries the piece's tokenURI + auction fields)
 * in one `multicall({allowFailure:true})`, derive a state badge via `deriveAuctionState`, and link
 * each tile to the shareable token detail page. Read idiom mirrors useAuctions.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { usePublicClient } from 'wagmi'
import {
  erc721AuctionInstanceAbi,
  useReadErc721AuctionInstanceNextTokenId,
} from '../../../generated/contracts'
import { useCollectionChainId, useCollectionSlug } from '../useCollectionChain'
import { fetchJson } from '../../../lib/metadata'
import { IpfsImage } from '../../ui/IpfsImage'
import { deriveAuctionState } from './auctionState'
import { useNowSec } from './useNowSec'
import styles from './Erc721PieceGallery.module.css'

/** Pragmatic cap on the id scan — galleries show a representative window, not the whole chain. */
const MAX_SCAN = 100

/** Raw auction fields cached by the query; the state BADGE is derived at render (per nowSec tick). */
interface Piece {
  id: bigint
  image: string | undefined
  startTime: bigint
  endTime: bigint
  highBidder: `0x${string}`
  settled: boolean
}

export function Erc721PieceGallery({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const slug = useCollectionSlug()
  const client = usePublicClient({ chainId })
  const nowSec = useNowSec()
  const { data: next } = useReadErc721AuctionInstanceNextTokenId({
    address: instance,
    chainId,
  })

  const { data, isPending, isError } = useQuery({
    // Time-independent read; the state badge is derived from nowSec at render, not keyed here (else
    // the whole multicall + image fetch would re-run every second).
    queryKey: ['erc721-piece-gallery', instance, next?.toString() ?? null],
    enabled: !!client && next !== undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<Piece[]> => {
      if (!client || next === undefined) return []
      const count = Number(next) - 1
      if (count <= 0) return []

      const scan = Math.min(count, MAX_SCAN)
      const ids = Array.from({ length: scan }, (_, i) => BigInt(i + 1))
      const base = { address: instance, abi: erc721AuctionInstanceAbi } as const

      const structs = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          ...base,
          functionName: 'getAuction' as const,
          args: [Number(id)] as const,
        })),
      })

      const raw: { id: bigint; tokenURI: string; piece: Omit<Piece, 'image'> }[] = []
      structs.forEach((r, i) => {
        const id = ids[i]
        if (r.status !== 'success' || id === undefined) return
        const a = r.result
        raw.push({
          id,
          tokenURI: a.tokenURI,
          piece: {
            id,
            startTime: BigInt(a.startTime),
            endTime: BigInt(a.endTime),
            highBidder: a.highBidder,
            settled: a.settled,
          },
        })
      })

      // Resolve images in parallel; soft-fail to a glyph tile on any miss.
      return Promise.all(
        raw.map(async ({ tokenURI, piece }): Promise<Piece> => {
          const meta = tokenURI ? await fetchJson<{ image?: string }>(tokenURI) : null
          return { ...piece, image: meta?.image }
        }),
      )
    },
  })

  if (isPending) {
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        loading pieces…
      </p>
    )
  }

  if (isError) {
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        couldn&apos;t load pieces — is the fork up?
      </p>
    )
  }

  if (!data || data.length === 0) {
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        no pieces minted yet
      </p>
    )
  }

  return (
    <ul className={styles.grid} data-testid="erc721-piece-gallery">
      {data.map((piece) => {
        const state = deriveAuctionState(piece, nowSec)
        return (
          <li key={piece.id.toString()} className={styles.tile} data-state={state}>
            <Link href={`/${chainId}/${slug}/token/${piece.id.toString()}`} className={styles.link}>
              <IpfsImage
                uri={piece.image ?? ''}
                alt={`#${piece.id.toString()}`}
                className={styles.thumb}
                fallback={<div className={styles.thumbGlyph}>✦</div>}
              />
              <div className={styles.meta}>
                <span className={styles.id}>#{piece.id.toString()}</span>
                <span className={`badge ${state === 'active' ? 'badge-solid' : ''}`}>{state}</span>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
