/**
 * Erc404NftGallery (W-D3) — the visible ART side of a DN404 collection. A DN404 is a coin AND an
 * NFT; the NFT pieces live on the DN404 *mirror* (a standard ERC721), NOT on the bonding instance.
 * We resolve the mirror via `mirrorERC721()` then read `totalSupply()` for a count and SCAN ids
 * `1..min(total, MAX_SCAN)` with `tokenURI(id)` via one `multicall({allowFailure:true})` — DN404
 * assigns ids ~sequentially but rerolls leave holes, so this is a pragmatic gallery scan (skip
 * failures), not exhaustive enumeration. Each tile links to the shareable token detail page.
 *
 * The mirror's standard ERC721 view fns aren't in the generated bindings, so we use a minimal inline
 * ABI and read through the public client (the read idiom from useMessageFeed/useAuctions).
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { usePublicClient } from 'wagmi'
import { useReadErc404BondingInstanceMirrorErc721 } from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { fetchJson } from '../../../lib/metadata'
import { IpfsImage } from '../../ui/IpfsImage'
import styles from './Erc404NftGallery.module.css'

/** Pragmatic cap on the sequential id scan — galleries show a representative window, not the chain. */
const MAX_SCAN = 100

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

export function Erc404NftGallery({ instance }: { instance: `0x${string}` }) {
  const client = usePublicClient({ chainId: forkChainId })
  const { data: mirror } = useReadErc404BondingInstanceMirrorErc721({
    address: instance,
    chainId: forkChainId,
  })

  const { data, isPending, isError } = useQuery({
    queryKey: ['erc404-nft-gallery', mirror ?? null],
    enabled: !!client && !!mirror,
    staleTime: 30_000,
    queryFn: async (): Promise<NftPiece[]> => {
      if (!client || !mirror) return []
      const base = { address: mirror, abi: mirrorErc721Abi } as const

      const total = await client.readContract({ ...base, functionName: 'totalSupply' })
      const count = Number(total)
      if (count <= 0) return []

      const scan = Math.min(count, MAX_SCAN)
      const ids = Array.from({ length: scan }, (_, i) => BigInt(i + 1))

      // One round-trip for every id's tokenURI; ids can be sparse after rerolls — skip failures.
      const uris = await client.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({ ...base, functionName: 'tokenURI' as const, args: [id] })),
      })

      const pieces: { id: bigint; tokenURI: string }[] = []
      uris.forEach((r, i) => {
        const id = ids[i]
        if (
          r.status === 'success' &&
          typeof r.result === 'string' &&
          r.result &&
          id !== undefined
        ) {
          pieces.push({ id, tokenURI: r.result })
        }
      })

      // Resolve metadata images in parallel; soft-fail to a glyph tile on any miss.
      const resolved = await Promise.all(
        pieces.map(async ({ id, tokenURI }): Promise<NftPiece> => {
          const meta = await fetchJson<{ image?: string }>(tokenURI)
          return { id, image: meta?.image }
        }),
      )
      return resolved
    },
  })

  if (isPending) {
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        loading pieces…
      </p>
    )
  }

  if (isError) {
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        couldn&apos;t load pieces — is the fork up?
      </p>
    )
  }

  if (!data || data.length === 0) {
    return (
      <p className={styles.note} data-testid="erc404-nft-gallery">
        no NFTs minted yet
      </p>
    )
  }

  return (
    <ul className={styles.grid} data-testid="erc404-nft-gallery">
      {data.map((piece) => (
        <li key={piece.id.toString()} className={styles.tile}>
          <Link
            href={`/collection/${instance}/token/${piece.id.toString()}`}
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
      ))}
    </ul>
  )
}
