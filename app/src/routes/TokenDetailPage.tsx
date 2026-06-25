/**
 * TokenDetailPage (W-D1 shell → filled by W-D3). Shareable per-token route
 * `/collection/:instance/token/:id` for a single NFT: the DN404 mirror token (ERC404) or an ERC721
 * auction piece. Shows the art (tokenURI), owner, and type-specific context (auction history for
 * ERC721). ERC1155 has no per-token NFT — its tokens are fungible editions — so that branch just
 * points back to the collection.
 *
 * The DN404 mirror's standard ERC721 view fns (`tokenURI`/`ownerOf`) aren't in the generated
 * bindings, so we read them through the public client with a minimal inline ABI (the read idiom
 * from useMessageFeed/useAuctions). Art is resolved with fetchJson/resolveUri (lib/metadata).
 */
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'wouter'
import { formatEther } from 'viem'
import { usePublicClient } from 'wagmi'
import {
  erc721AuctionInstanceAbi,
  useReadErc404BondingInstanceMirrorErc721,
} from '../generated/contracts'
import { useCollection } from '../components/useCollection'
import { useBidHistory } from '../components/collection/erc721/useBidHistory'
import { useNowSec } from '../components/collection/erc721/useNowSec'
import { deriveAuctionState } from '../components/collection/erc721/auctionState'
import { forkChainId } from '../lib/addresses'
import { fetchJson, resolveUri } from '../lib/metadata'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './TokenDetailPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : undefined
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
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export function TokenDetailPage() {
  const params = useParams<{ instance?: string; id?: string }>()
  const instance = toAddress(params.instance)
  const id = params.id !== undefined && /^\d+$/.test(params.id) ? BigInt(params.id) : undefined
  const { data: card } = useCollection(instance)

  if (!instance || id === undefined) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <StateBlock variant="empty">invalid token reference</StateBlock>
      </div>
    )
  }

  const collectionName = card?.name || truncateAddress(instance)

  return (
    <div className={styles.page} data-testid="token-detail" data-type={card?.contractType}>
      <nav className={styles.crumb}>
        <Link href={`/collection/${instance}`} className={styles.back}>
          ← collection
        </Link>
      </nav>

      {card?.contractType === 'ERC404' && (
        <Erc404Token instance={instance} id={id} collectionName={collectionName} />
      )}
      {card?.contractType === 'ERC721' && (
        <Erc721Token instance={instance} id={id} collectionName={collectionName} />
      )}
      {card?.contractType !== undefined &&
        card.contractType !== 'ERC404' &&
        card.contractType !== 'ERC721' && (
          <EditionNote instance={instance} collectionName={collectionName} />
        )}
      {card === undefined && <StateBlock variant="loading">loading token…</StateBlock>}
    </div>
  )
}

interface TokenProps {
  instance: `0x${string}`
  id: bigint
  collectionName: string
}

function CollectionBackLink({
  instance,
  collectionName,
}: {
  instance: `0x${string}`
  collectionName: string
}) {
  return (
    <p className={styles.note}>
      part of{' '}
      <Link href={`/collection/${instance}`} className={styles.inlineLink}>
        {collectionName}
      </Link>
    </p>
  )
}

function Art({ image, alt }: { image: string | undefined; alt: string }) {
  if (!image) {
    return (
      <div className={styles.artGlyph} data-testid="token-art">
        ✦
      </div>
    )
  }
  return <img src={resolveUri(image)} alt={alt} className={styles.art} data-testid="token-art" />
}

function Erc404Token({ instance, id, collectionName }: TokenProps) {
  const client = usePublicClient({ chainId: forkChainId })
  const { data: mirror } = useReadErc404BondingInstanceMirrorErc721({
    address: instance,
    chainId: forkChainId,
  })

  const { data, isPending, isError } = useQuery({
    queryKey: ['erc404-token', mirror ?? null, id.toString()],
    enabled: !!client && !!mirror,
    staleTime: 30_000,
    queryFn: async (): Promise<{ image: string | undefined; owner: `0x${string}` | undefined }> => {
      if (!client || !mirror) return { image: undefined, owner: undefined }
      const base = { address: mirror, abi: mirrorErc721Abi } as const
      const [uriRes, ownerRes] = await client.multicall({
        allowFailure: true,
        contracts: [
          { ...base, functionName: 'tokenURI', args: [id] },
          { ...base, functionName: 'ownerOf', args: [id] },
        ],
      })
      const tokenURI = uriRes.status === 'success' ? uriRes.result : ''
      const owner = ownerRes.status === 'success' ? ownerRes.result : undefined
      const meta = tokenURI ? await fetchJson<{ image?: string; name?: string }>(tokenURI) : null
      return { image: meta?.image, owner }
    },
  })

  if (isPending) return <StateBlock variant="loading">loading token…</StateBlock>
  if (isError)
    return <StateBlock variant="error">couldn&apos;t load token — is the fork up?</StateBlock>

  return (
    <article className={styles.detail}>
      <Art image={data?.image} alt={`#${id.toString()}`} />
      <div className={styles.info}>
        <h1 className={styles.title}>#{id.toString()}</h1>
        {data?.owner && (
          <div className={styles.statRow}>
            <span className={styles.statLabel}>owner</span>
            <Link href={`/profile/${data.owner}`} className={styles.inlineLink}>
              {truncateAddress(data.owner)}
            </Link>
          </div>
        )}
        <CollectionBackLink instance={instance} collectionName={collectionName} />
      </div>
    </article>
  )
}

function Erc721Token({ instance, id, collectionName }: TokenProps) {
  const client = usePublicClient({ chainId: forkChainId })
  const nowSec = useNowSec()

  const { data, isPending, isError } = useQuery({
    // NB: do NOT key on nowSec — the auction read is time-independent; deriveAuctionState(a, nowSec)
    // below recomputes the badge each tick without refetching the contract every second.
    queryKey: ['erc721-token', instance, id.toString()],
    enabled: !!client,
    staleTime: 15_000,
    queryFn: async () => {
      if (!client) throw new Error('no client')
      const auction = await client.readContract({
        address: instance,
        abi: erc721AuctionInstanceAbi,
        functionName: 'getAuction',
        args: [Number(id)],
      })
      const meta = auction.tokenURI
        ? await fetchJson<{ image?: string; name?: string }>(auction.tokenURI)
        : null
      return { auction, image: meta?.image, name: meta?.name }
    },
  })

  const { data: bids } = useBidHistory(instance, data ? id : undefined)

  if (isPending) return <StateBlock variant="loading">loading token…</StateBlock>
  if (isError || !data)
    return <StateBlock variant="error">couldn&apos;t load token — is the fork up?</StateBlock>

  const a = data.auction
  const state = deriveAuctionState(
    {
      startTime: BigInt(a.startTime),
      endTime: BigInt(a.endTime),
      highBidder: a.highBidder,
      settled: a.settled,
    },
    nowSec,
  )
  const hasBidder = a.highBidder.toLowerCase() !== '0x0000000000000000000000000000000000000000'

  return (
    <article className={styles.detail}>
      <Art image={data.image} alt={data.name || `#${id.toString()}`} />
      <div className={styles.info}>
        <h1 className={styles.title}>{data.name || `#${id.toString()}`}</h1>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>state</span>
          <span className={`badge ${state === 'active' ? 'badge-solid' : ''}`}>{state}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>{hasBidder ? 'high bid' : 'min bid'}</span>
          <span className={styles.statValue}>
            {formatEther(hasBidder ? a.highBid : a.minBid)} ETH
          </span>
        </div>
        {hasBidder && (
          <div className={styles.statRow}>
            <span className={styles.statLabel}>
              {state === 'settled' ? 'winner' : 'top bidder'}
            </span>
            <Link href={`/profile/${a.highBidder}`} className={styles.inlineLink}>
              {truncateAddress(a.highBidder)}
            </Link>
          </div>
        )}
        <CollectionBackLink instance={instance} collectionName={collectionName} />

        {bids.length > 0 && (
          <div className={styles.history} data-testid="token-bid-history">
            <span className={styles.statLabel}>bids</span>
            <ul className={styles.historyList}>
              {bids.slice(0, 10).map((b, i) => (
                <li key={`${b.blockNumber}-${i}`} className={styles.historyRow}>
                  <span>{truncateAddress(b.bidder)}</span>
                  <span>{formatEther(b.amount)} ETH</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  )
}

function EditionNote({
  instance,
  collectionName,
}: {
  instance: `0x${string}`
  collectionName: string
}) {
  return (
    <div className={styles.detail}>
      <p className={styles.note} data-testid="token-art">
        this collection&apos;s tokens are editions — they have no per-token NFT art.
      </p>
      <CollectionBackLink instance={instance} collectionName={collectionName} />
    </div>
  )
}
