/**
 * Erc721AuctionSurface (W-B3) — the ERC721 auction trading surface mounted by the collection page.
 * Reads every line's active auction (useAuctions), ticks a shared clock (useNowSec), and renders an
 * AuctionCard per live auction. Owner is read once here so endedNoBids cards can offer reclaim.
 */
import { useAccount } from 'wagmi'
import { useReadErc721AuctionInstanceOwner } from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { AuctionCard } from './AuctionCard'
import { useAuctions } from './useAuctions'
import { useNowSec } from './useNowSec'
import styles from './Erc721Auction.module.css'

export function Erc721AuctionSurface({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data, isPending, isError, refetch } = useAuctions(instance)
  const nowSec = useNowSec()
  const { address: connected } = useAccount()
  const { data: owner } = useReadErc721AuctionInstanceOwner({
    address: instance,
    chainId: chainId,
  })
  const isOwner = !!connected && !!owner && connected.toLowerCase() === owner.toLowerCase()

  if (isPending) return <p className={styles.note}>loading auctions…</p>
  if (isError || !data)
    return <p className={styles.note}>could not load auctions — is the fork up?</p>

  if (data.auctions.length === 0) {
    return (
      <p className={styles.note} data-testid="erc721-no-auctions">
        no live auctions{data.config.lines > 0 ? ` across ${data.config.lines} line(s)` : ''}
      </p>
    )
  }

  return (
    <ul className={styles.list} data-testid="erc721-auctions">
      {data.auctions.map((a) => (
        <AuctionCard
          key={`${a.line}-${a.tokenId.toString()}`}
          instance={instance}
          auction={a}
          config={data.config}
          nowSec={nowSec}
          isOwner={isOwner}
          refetch={refetch}
        />
      ))}
    </ul>
  )
}
