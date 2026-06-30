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
  const tokenProps: TokenProps = {
    instance,
    id,
    collectionName,
    creator: card?.creator,
    vaultName: card?.vaultName,
  }

  return (
    <div className={styles.page} data-testid="token-detail" data-type={card?.contractType}>
      <nav className={styles.crumb}>
        <Link href={`/collection/${instance}`} className={styles.back}>
          Collections / {collectionName} / #{id.toString()}
        </Link>
      </nav>

      {card?.contractType === 'ERC404' && <Erc404Token {...tokenProps} />}
      {card?.contractType === 'ERC721' && <Erc721Token {...tokenProps} />}
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
  creator?: `0x${string}` | undefined
  vaultName?: string | undefined
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

/** The work, hung — the `.noesis-frame`'s primary home: double 2px molding + corner ticks, the
 * art filling the inner inset. Colour lives only here; the rest of the placard is mono. */
function FramedArt({ image, alt }: { image: string | undefined; alt: string }) {
  return (
    <div className={styles.framewrap}>
      <div className={`noesis-frame ${styles.frame}`}>
        <span className="noesis-tick tl" />
        <span className="noesis-tick tr" />
        <span className="noesis-tick bl" />
        <span className="noesis-tick br" />
        <div className={styles.artInner}>
          {image ? (
            <img
              src={resolveUri(image)}
              alt={alt}
              className={`noesis-art ${styles.art}`}
              data-testid="token-art"
            />
          ) : (
            <div className={styles.artGlyph} data-testid="token-art">
              ✦
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The alignment honesty line — on a token page it states the RESALE bind (every secondary sale),
 * the token page's reason to exist. The ~20% is the protocol constant. */
function AlignmentLine({ vaultName }: { vaultName?: string | undefined }) {
  return (
    <p className={styles.alignLine}>
      <span aria-hidden>▪ </span>~20% of every resale binds to <b>{vaultName || 'its alignment vault'}</b>
      , on-chain. The alignment travels with the work, forever — <b>it can&rsquo;t be undone.</b>
    </p>
  )
}

function Erc404Token({ instance, id, collectionName, creator, vaultName }: TokenProps) {
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

  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return <StateBlock variant="error">couldn&apos;t load token — is the fork up?</StateBlock>

  return (
    <article className={styles.wall}>
      <FramedArt image={data?.image} alt={`${collectionName} #${id.toString()}`} />
      <div className={styles.placard}>
        <p className={styles.artist}>{creator ? truncateAddress(creator) : collectionName}</p>
        <h1 className={styles.title}>
          {collectionName} <span className={styles.tokenId}>#{id.toString()}</span>
        </h1>

        <dl className={styles.label}>
          <div className={styles.labelRow}>
            <dt>Standard</dt>
            <dd>ERC-404</dd>
          </div>
          {data?.owner && (
            <div className={styles.labelRow}>
              <dt>Owner</dt>
              <dd>
                <Link href={`/profile/${data.owner}`} className={styles.inlineLink}>
                  {truncateAddress(data.owner)}
                </Link>
              </dd>
            </div>
          )}
        </dl>

        <div className={styles.acquire}>
          <CollectionBackLink instance={instance} collectionName={collectionName} />
          <AlignmentLine vaultName={vaultName} />
        </div>
      </div>
    </article>
  )
}

function Erc721Token({ instance, id, collectionName, creator, vaultName }: TokenProps) {
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

  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
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
  const title = data.name || `${collectionName} #${id.toString()}`

  return (
    <article className={styles.wall}>
      <FramedArt image={data.image} alt={title} />
      <div className={styles.placard}>
        <p className={styles.artist}>{creator ? truncateAddress(creator) : collectionName}</p>
        <h1 className={styles.title}>
          {data.name || collectionName} <span className={styles.tokenId}>#{id.toString()}</span>
        </h1>

        <dl className={styles.label}>
          <div className={styles.labelRow}>
            <dt>Standard</dt>
            <dd>ERC-721 · auction</dd>
          </div>
          <div className={styles.labelRow}>
            <dt>State</dt>
            <dd>{state}</dd>
          </div>
          {hasBidder && (
            <div className={styles.labelRow}>
              <dt>{state === 'settled' ? 'Winner' : 'Top bidder'}</dt>
              <dd>
                <Link href={`/profile/${a.highBidder}`} className={styles.inlineLink}>
                  {truncateAddress(a.highBidder)}
                </Link>
              </dd>
            </div>
          )}
        </dl>

        {/* Provenance — the acquisition record. On an auction piece, the bid history IS the
            custody record; shown as fact (price + actor), newest first. */}
        {bids.length > 0 && (
          <div className={styles.sec} data-testid="token-bid-history">
            <p className={styles.secHead}>Provenance — bids</p>
            <div className="noesis-prov">
              {bids.slice(0, 10).map((b, i) => (
                <div className="p" key={`${b.blockNumber}-${i}`}>
                  <span className="ev">Bid</span>
                  <span className="val">{formatEther(b.amount)} ETH</span>
                  <span className="who">{truncateAddress(b.bidder)}</span>
                  <span className="when">—</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.acquire}>
          <div className={styles.priceRow}>
            <span className={styles.priceLabel}>{hasBidder ? 'High bid' : 'Min bid'}</span>
            <span className={styles.price}>
              {formatEther(hasBidder ? a.highBid : a.minBid)} ETH
            </span>
          </div>
          <Link href={`/collection/${instance}`} className={styles.bidLink}>
            {state === 'active' ? 'Bid on the collection page →' : 'View the collection →'}
          </Link>
          <AlignmentLine vaultName={vaultName} />
        </div>
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
