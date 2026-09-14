/**
 * Erc721PieceGallery (W-D3) — the full set of an ERC721 auction collection's pieces (not just the
 * live ones useAuctions surfaces). `nextTokenId` is the minted-count cursor: ids run `1..next-1`.
 * Per id we read the `getAuction(id)` struct (which carries the piece's tokenURI + auction fields),
 * derive a state badge via `deriveAuctionState`, and link each tile to the shareable token detail
 * page. Read idiom mirrors useAuctions.
 *
 * The grid is virtualized (noesis-382): the whole collection is browsable, and the cost of a mount
 * is a fixed window rather than a function of collection size.
 *
 * ## Row model: a compacted list of pieces that resolved
 *
 * Ids here are contiguous (`nextTokenId` is a minted cursor), but the read is `allowFailure: true`
 * and a struct that fails to come back must not leave a ragged hole in the grid. The row model is
 * therefore the list of pieces that actually resolved, in id order; the id space is walked in fixed
 * chunks of `PAGE_IDS` and misses are dropped rather than occupying a cell.
 *
 * ## Read budget per mount
 *
 * - **one** `nextTokenId` read (the generated hook),
 * - **one** `multicall` of at most `PAGE_IDS` (60) `getAuction` reads — the first chunk only; later
 *   chunks are fetched when the scroll reaches within a row of what has been loaded,
 * - **at most one metadata resolution per resolved id in that chunk** (so at most 60), run through
 *   `mapWithConcurrency` at `METADATA_CONCURRENCY` (6) in flight.
 */
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from 'wouter'
import { usePublicClient } from 'wagmi'
import {
  erc721AuctionInstanceAbi,
  useReadErc721AuctionInstanceNextTokenId,
} from '../../../generated/contracts'
import { useCollectionChainId, useCollectionSlug } from '../useCollectionChain'
import { fetchJson, jsonOrNull } from '../../../lib/metadata'
import { mapWithConcurrency, METADATA_CONCURRENCY } from '../../../lib/metadata/pool'
import { IpfsImage } from '../../ui/IpfsImage'
import { deriveAuctionState } from './auctionState'
import { useNowSec } from './useNowSec'
import styles from './Erc721PieceGallery.module.css'

/** Candidate ids read per chunk — one multicall, and the ceiling on a chunk's metadata fetches. */
const PAGE_IDS = 60

/** Rows rendered above and below the visible band, so a scroll lands on painted tiles. */
const OVERSCAN_ROWS = 3

/** Narrowest tile the grid will lay out; the column count follows from the container width. */
const TILE_MIN_PX = 160

/** Fixed chrome under each tile's square thumbnail, used to estimate a row's height. */
const TILE_LABEL_PX = 40

/**
 * The grid states the collection's TRUE piece count. Pieces stream in as the viewer scrolls, so
 * until the walk has found them all the line says how many are loaded AND how many exist — a grid
 * that showed only what it happened to have loaded would be indistinguishable from a collection
 * that holds exactly that many pieces.
 */
function countLabel(total: number, loaded: number): string {
  const n = total.toLocaleString('en-US')
  if (loaded >= total) return `${n} ${total === 1 ? 'piece' : 'pieces'}`
  return `${loaded.toLocaleString('en-US')} of ${n} pieces loaded — scroll for more`
}

/** Raw auction fields cached by the query; the state BADGE is derived at render (per nowSec tick). */
interface Piece {
  id: bigint
  image: string | undefined
  startTime: bigint
  endTime: bigint
  highBidder: `0x${string}`
  settled: boolean
}

/** One walked chunk of the id space: the pieces that resolved in it, and where to resume. */
interface PieceChunk {
  pieces: Piece[]
  nextCursor: number
}

/**
 * Column count and row height for the virtualized grid, measured from the scroll container. A
 * container that has not been laid out yet (width 0) falls back to a single column, which keeps the
 * virtualizer's arithmetic well-defined instead of dividing by zero.
 */
function useGridMetrics(el: HTMLDivElement | null): { columns: number; rowPx: number } {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [el])

  const columns = Math.max(1, Math.floor(width / TILE_MIN_PX))
  const rowPx = Math.max(1, Math.round(width / columns) + TILE_LABEL_PX)
  return { columns, rowPx }
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

  const totalCount = next === undefined ? 0 : Math.max(0, Number(next) - 1)

  const {
    data: walked,
    isPending,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    // Time-independent read; the state badge is derived from nowSec at render, not keyed here (else
    // the whole multicall + image fetch would re-run every second).
    queryKey: ['erc721-piece-gallery', instance, totalCount],
    enabled: !!client && totalCount > 0,
    staleTime: 15_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<PieceChunk> => {
      const startId = pageParam
      const span = Math.max(0, Math.min(PAGE_IDS, totalCount - startId + 1))
      if (!client || span === 0) return { pieces: [], nextCursor: startId }
      const ids = Array.from({ length: span }, (_, i) => BigInt(startId + i))
      const base = { address: instance, abi: erc721AuctionInstanceAbi } as const

      const structs = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          ...base,
          functionName: 'getAuction' as const,
          args: [Number(id)] as const,
        })),
      })

      const raw: { tokenURI: string; piece: Omit<Piece, 'image'> }[] = []
      structs.forEach((r, i) => {
        const id = ids[i]
        if (r.status !== 'success' || id === undefined) return
        const a = r.result
        raw.push({
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

      // Resolve this chunk's images with a capped number of requests in flight; soft-fail to a
      // glyph tile on any miss.
      const pieces = await mapWithConcurrency(
        raw,
        METADATA_CONCURRENCY,
        async ({ tokenURI, piece }): Promise<Piece> => {
          const meta = tokenURI ? jsonOrNull(await fetchJson<{ image?: string }>(tokenURI)) : null
          return { ...piece, image: meta?.image }
        },
      )
      return { pieces, nextCursor: startId + span }
    },
    getNextPageParam: (last, all) => {
      if (last.nextCursor > totalCount) return undefined
      const found = all.reduce((n, page) => n + page.pieces.length, 0)
      if (found >= totalCount) return undefined
      return last.nextCursor
    },
  })

  const pieces = useMemo(() => walked?.pages.flatMap((page) => page.pieces) ?? [], [walked])

  // A callback ref, not `useRef`: the scroller only enters the DOM once the first chunk has
  // resolved, so measurement has to be driven by the element appearing rather than by mount.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const { columns, rowPx } = useGridMetrics(scrollEl)
  const rowCount = Math.ceil(pieces.length / columns) + (hasNextPage ? 1 : 0)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowPx,
    overscan: OVERSCAN_ROWS,
  })

  // A resize changes the row height, so the cached measurements have to be dropped.
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowPx, columns])

  const virtualRows = virtualizer.getVirtualItems()
  const lastRowIndex = virtualRows.at(-1)?.index

  // Walk the next chunk only when the rendered band reaches the end of what has been loaded.
  useEffect(() => {
    if (lastRowIndex === undefined) return
    if (!hasNextPage || isFetchingNextPage) return
    if (lastRowIndex >= rowCount - 1) void fetchNextPage()
  }, [lastRowIndex, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isError) {
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        couldn&apos;t load pieces — no response from the network.
      </p>
    )
  }

  if (isPending) {
    if (next !== undefined && totalCount <= 0) {
      return (
        <p className={styles.note} data-testid="erc721-piece-gallery">
          no pieces minted yet
        </p>
      )
    }
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        loading pieces…
      </p>
    )
  }

  if (pieces.length === 0) {
    return (
      <p className={styles.note} data-testid="erc721-piece-gallery">
        no pieces minted yet
      </p>
    )
  }

  return (
    <>
      <p className={styles.note} data-testid="erc721-piece-gallery-count">
        {countLabel(totalCount, pieces.length)}
      </p>
      <div ref={setScrollEl} className={styles.scroller} data-testid="erc721-piece-gallery">
        <div className={styles.canvas} style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualRows.map((row) => {
            const start = row.index * columns
            const slice = pieces.slice(start, start + columns)
            return (
              <ul
                key={row.key}
                className={styles.row}
                style={{
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {slice.length === 0 ? (
                  <li className={styles.more}>loading more…</li>
                ) : (
                  slice.map((piece) => {
                    const state = deriveAuctionState(piece, nowSec)
                    return (
                      <li key={piece.id.toString()} className={styles.tile} data-state={state}>
                        <Link
                          href={`/${chainId}/${slug}/token/${piece.id.toString()}`}
                          className={styles.link}
                        >
                          <IpfsImage
                            uri={piece.image ?? ''}
                            alt={`#${piece.id.toString()}`}
                            className={styles.thumb}
                            fallback={<div className={styles.thumbGlyph}>✦</div>}
                          />
                          <div className={styles.meta}>
                            <span className={styles.id}>#{piece.id.toString()}</span>
                            <span className={`badge ${state === 'active' ? 'badge-solid' : ''}`}>
                              {state}
                            </span>
                          </div>
                        </Link>
                      </li>
                    )
                  })
                )}
              </ul>
            )
          })}
        </div>
      </div>
    </>
  )
}
