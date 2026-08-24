/**
 * Erc404NftGallery (W-D3) — the visible ART side of a DN404 collection. A DN404 is a coin AND an
 * NFT; the NFT pieces live on the DN404 *mirror* (a standard ERC721), NOT on the bonding instance.
 * We resolve the mirror via `mirrorERC721()` then read `totalSupply()` for the collection's true
 * piece count.
 *
 * The grid is virtualized (noesis-382): the whole collection is browsable, and the cost of a mount
 * is a fixed window rather than a function of collection size.
 *
 * ## Row model: a compacted list of surviving pieces, not the id space
 *
 * DN404 assigns ids ~sequentially, but rerolls burn ids and leave holes, so `index === id` is false
 * and a virtualizer laid over the id space renders ragged windows that read as missing art. The row
 * model here is therefore the list of pieces that actually resolved, in id order. The id space is
 * walked in fixed chunks (`PAGE_IDS` candidate ids per `multicall({allowFailure:true})`); ids that
 * miss are dropped rather than occupying a cell, so every grid slot holds a real piece. Walking
 * stops when `totalSupply()` pieces have been found, or when a whole chunk of candidate ids comes
 * back empty (the end of the used id space).
 *
 * ## Read budget per mount
 *
 * - **one** `totalSupply()` read,
 * - **one** `multicall` of `PAGE_IDS` (60) `tokenURI` reads — the first chunk only; later chunks are
 *   fetched when the scroll reaches within a row of what has been loaded,
 * - **at most one metadata resolution per surviving id in that chunk** (so at most 60), run through
 *   `mapWithConcurrency` at `METADATA_CONCURRENCY` (6) in flight.
 *
 * The mirror's standard ERC721 view fns aren't in the generated bindings, so we use a minimal inline
 * ABI and read through the public client (the read idiom from useMessageFeed/useAuctions).
 */
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from 'wouter'
import { usePublicClient } from 'wagmi'
import { useReadErc404BondingInstanceMirrorErc721 } from '../../../generated/contracts'
import { useCollectionChainId, useCollectionSlug } from '../useCollectionChain'
import { fetchJson, jsonOrNull } from '../../../lib/metadata'
import { mapWithConcurrency, METADATA_CONCURRENCY } from '../../../lib/metadata/pool'
import { IpfsImage } from '../../ui/IpfsImage'
import styles from './Erc404NftGallery.module.css'

/** Candidate ids read per chunk — one multicall, and the ceiling on a chunk's metadata fetches. */
const PAGE_IDS = 60

/** Rows rendered above and below the visible band, so a scroll lands on painted tiles. */
const OVERSCAN_ROWS = 3

/** Narrowest tile the grid will lay out; the column count follows from the container width. */
const TILE_MIN_PX = 200

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

/** Minimal standard-ERC721 read surface of the DN404 mirror (not in generated bindings). */
const mirrorErc721Abi = [
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

interface NftPiece {
  id: bigint
  image: string | undefined
}

/** One walked chunk of the id space: the pieces that survived it, and where to resume. */
interface PieceChunk {
  pieces: NftPiece[]
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

export function Erc404NftGallery({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const slug = useCollectionSlug()
  const client = usePublicClient({ chainId })
  const { data: mirror } = useReadErc404BondingInstanceMirrorErc721({
    address: instance,
    chainId,
  })

  const base = useMemo(
    () => (mirror ? ({ address: mirror, abi: mirrorErc721Abi } as const) : undefined),
    [mirror],
  )

  // The collection's true piece count. One read, independent of how much of the grid is walked.
  const {
    data: total,
    isPending: totalPending,
    isError: totalError,
  } = useQuery({
    queryKey: ['erc404-nft-total', mirror ?? null],
    enabled: !!client && !!base,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      if (!client || !base) return 0
      return Number(await client.readContract({ ...base, functionName: 'totalSupply' }))
    },
  })

  const totalCount = total ?? 0

  const {
    data: walked,
    isPending: piecesPending,
    isError: piecesError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['erc404-nft-gallery', mirror ?? null, totalCount],
    enabled: !!client && !!base && totalCount > 0,
    staleTime: 30_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<PieceChunk> => {
      const startId = pageParam
      if (!client || !base) return { pieces: [], nextCursor: startId }
      const ids = Array.from({ length: PAGE_IDS }, (_, i) => BigInt(startId + i))

      // One round-trip for the chunk's tokenURIs; ids are sparse after rerolls — skip the misses so
      // a hole never occupies a grid cell.
      const uris = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({ ...base, functionName: 'tokenURI' as const, args: [id] })),
      })

      const present: { id: bigint; tokenURI: string }[] = []
      uris.forEach((r, i) => {
        const id = ids[i]
        if (
          r.status === 'success' &&
          typeof r.result === 'string' &&
          r.result &&
          id !== undefined
        ) {
          present.push({ id, tokenURI: r.result })
        }
      })

      // Resolve this chunk's images with a capped number of requests in flight; soft-fail to a
      // glyph tile on any miss.
      const pieces = await mapWithConcurrency(
        present,
        METADATA_CONCURRENCY,
        async ({ id, tokenURI }): Promise<NftPiece> => {
          const meta = jsonOrNull(await fetchJson<{ image?: string }>(tokenURI))
          return { id, image: meta?.image }
        },
      )
      return { pieces, nextCursor: startId + PAGE_IDS }
    },
    getNextPageParam: (last, all) => {
      const found = all.reduce((n, page) => n + page.pieces.length, 0)
      if (found >= totalCount) return undefined
      // A chunk with no survivors at all is the end of the used id space, not a run of holes.
      if (last.pieces.length === 0) return undefined
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

  if (totalError || piecesError) {
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        couldn&apos;t load pieces — is the fork up?
      </p>
    )
  }

  if (totalPending || piecesPending) {
    if (!totalPending && totalCount <= 0) {
      return (
        <p className={styles.note} data-testid="erc404-nft-gallery">
          no NFTs minted yet
        </p>
      )
    }
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        loading pieces…
      </p>
    )
  }

  if (pieces.length === 0) {
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        no NFTs minted yet
      </p>
    )
  }

  return (
    <>
      <p className={styles.note} data-testid="erc404-nft-gallery-count">
        {countLabel(totalCount, pieces.length)}
      </p>
      <div ref={setScrollEl} className={styles.scroller} data-testid="erc404-nft-gallery">
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
                  slice.map((piece) => (
                    <li key={piece.id.toString()} className={styles.tile}>
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
                        <span className={styles.id}>#{piece.id.toString()}</span>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )
          })}
        </div>
      </div>
    </>
  )
}
