/**
 * AuctionCard (W-B3) — one auction on one line, rendered per its derived state:
 *   active         → countdown + bid form (createBid, min = minNextBid)
 *   endedWithBids  → "ready to settle" + settleAuction (anyone can call)
 *   endedNoBids    → owner-only reclaimUnsold
 *   settled        → sold summary
 * Bid history (BidPlaced events) shows under the live/settle states.
 */
import { useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useWriteErc721AuctionInstanceCreateBid,
  useWriteErc721AuctionInstanceReclaimUnsold,
  useWriteErc721AuctionInstanceSettleAuction,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { txErrorReason } from '../../ui/useTxAction'
import { fetchJson, resolveUri } from '../../../lib/metadata'
import { truncateAddress } from '../../../lib/format'
import { deriveAuctionState } from './auctionState'
import { minNextBid } from './bidMath'
import { useBidHistory } from './useBidHistory'
import type { ActiveAuction, AuctionConfig } from './useAuctions'
import styles from './Erc721Auction.module.css'

interface AuctionCardProps {
  instance: `0x${string}`
  auction: ActiveAuction
  config: AuctionConfig
  nowSec: bigint
  isOwner: boolean
  refetch: () => void
}

/** Compact "2d 03h 14m 09s" / "—" countdown from a non-negative second delta. */
function formatCountdown(left: bigint): string {
  if (left <= 0n) return 'ended'
  const s = Number(left)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(sec)}s`
}

export function AuctionCard({
  instance,
  auction,
  config,
  nowSec,
  isOwner,
  refetch,
}: AuctionCardProps) {
  const state = deriveAuctionState(auction, nowSec)
  const { data: meta } = useQuery({
    queryKey: ['erc721-token-meta', auction.tokenURI],
    enabled: !!auction.tokenURI,
    staleTime: 60_000,
    queryFn: () => fetchJson<{ name?: string; image?: string }>(auction.tokenURI),
  })

  const title = meta?.name || `#${auction.tokenId.toString()}`
  const left = auction.endTime - nowSec
  const urgent = state === 'active' && left > 0n && left < 900n // < 15 min

  return (
    <li className={styles.card} data-testid="erc721-auction" data-state={state}>
      <div className={styles.cardHeader}>
        {meta?.image ? (
          <img src={resolveUri(meta.image)} alt={title} className={styles.thumb} />
        ) : (
          <div className={styles.thumbGlyph}>✦</div>
        )}
        <div className={styles.cardMeta}>
          <h3 className={styles.title}>{title}</h3>
          <span className={styles.line}>line {auction.line}</span>
        </div>
        <span className={`badge ${state === 'active' ? 'badge-solid' : ''}`}>{state}</span>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{auction.highBid > 0n ? 'high bid' : 'min bid'}</span>
          <span className={styles.statValue}>
            {formatEther(auction.highBid > 0n ? auction.highBid : auction.minBid)} ETH
          </span>
        </div>
        {state === 'active' && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>ends in</span>
            <span className={`${styles.statValue} ${urgent ? styles.urgent : ''}`}>
              {formatCountdown(left)}
            </span>
          </div>
        )}
      </div>

      <AuctionAction
        instance={instance}
        auction={auction}
        config={config}
        state={state}
        isOwner={isOwner}
        refetch={refetch}
      />

      {(state === 'active' || state === 'endedWithBids' || state === 'settled') && (
        <BidHistory instance={instance} tokenId={auction.tokenId} />
      )}
    </li>
  )
}

interface ActionProps {
  instance: `0x${string}`
  auction: ActiveAuction
  config: AuctionConfig
  state: ReturnType<typeof deriveAuctionState>
  isOwner: boolean
  refetch: () => void
}

/** State→action switch (bid / settle / reclaim / sold). Exported so the per-token detail page can
 *  mount the SAME auction action inline (N13) without duplicating the card's art/stats. */
export function AuctionAction({ instance, auction, config, state, isOwner, refetch }: ActionProps) {
  switch (state) {
    case 'active':
      return <BidForm instance={instance} auction={auction} config={config} refetch={refetch} />
    case 'endedWithBids':
      return <SettleButton instance={instance} tokenId={auction.tokenId} refetch={refetch} />
    case 'endedNoBids':
      return isOwner ? (
        <ReclaimButton instance={instance} tokenId={auction.tokenId} refetch={refetch} />
      ) : (
        <p className={styles.note}>auction ended — no bids</p>
      )
    case 'settled':
      return (
        <p className={styles.note} data-testid="erc721-sold">
          sold for {formatEther(auction.highBid)} ETH to {truncateAddress(auction.highBidder)}
        </p>
      )
    default:
      return null
  }
}

function BidForm({
  instance,
  auction,
  config,
  refetch,
}: {
  instance: `0x${string}`
  auction: ActiveAuction
  config: AuctionConfig
  refetch: () => void
}) {
  const { isConnected } = useAccount()
  const min = minNextBid({
    minBid: auction.minBid,
    highBid: auction.highBid,
    highBidder: auction.highBidder,
    bidIncrement: config.bidIncrement,
  })
  const [value, setValue] = useState('')
  const {
    writeContract,
    data: txHash,
    isPending,
    isError,
    error: writeErrObj,
    reset,
  } = useWriteErc721AuctionInstanceCreateBid()
  const {
    isLoading,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })
  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)

  let amountWei: bigint | undefined
  try {
    amountWei = value ? parseEther(value) : undefined
  } catch {
    amountWei = undefined
  }
  const tooLow = amountWei !== undefined && amountWei < min
  const isBusy = isPending || isLoading

  function handleBid(): void {
    if (amountWei === undefined || amountWei < min) return
    writeContract({
      address: instance,
      chainId: forkChainId,
      args: [Number(auction.tokenId), '0x'],
      value: amountWei,
    })
  }

  if (!isConnected) return <p className={styles.note}>connect wallet to bid</p>

  if (isSuccess) {
    return (
      <div className={styles.action}>
        <p className={styles.txStatus}>bid placed — confirmed.</p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            reset()
            setValue('')
            refetch()
          }}
        >
          ok
        </button>
      </div>
    )
  }

  return (
    <div className={styles.action}>
      <div className={styles.bidRow}>
        <input
          className={styles.bidInput}
          type="text"
          inputMode="decimal"
          placeholder={`min ${formatEther(min)}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isBusy}
          aria-label="bid amount in ETH"
          data-testid="erc721-bid-input"
        />
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleBid}
          disabled={isBusy || amountWei === undefined || tooLow}
          data-testid="erc721-bid"
        >
          {isPending ? 'confirm in wallet…' : isLoading ? 'bidding…' : 'place bid'}
        </button>
      </div>
      <span className={styles.minNote}>min next bid: {formatEther(min)} ETH</span>
      {tooLow && <p className={`${styles.txStatus} ${styles.txError}`}>below the minimum bid</p>}
      {(isError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>{failureReason ?? 'bid failed — try again'}</p>
      )}
    </div>
  )
}

function SettleButton({
  instance,
  tokenId,
  refetch,
}: {
  instance: `0x${string}`
  tokenId: bigint
  refetch: () => void
}) {
  const {
    writeContract,
    data: txHash,
    isPending,
    isError,
    error: writeErrObj,
    reset,
  } = useWriteErc721AuctionInstanceSettleAuction()
  const {
    isLoading,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })
  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)
  const isBusy = isPending || isLoading

  if (isSuccess) {
    return (
      <div className={styles.action}>
        <p className={styles.txStatus}>settled — confirmed.</p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            reset()
            refetch()
          }}
        >
          ok
        </button>
      </div>
    )
  }

  return (
    <div className={styles.action}>
      <p className={styles.note}>auction ended — ready to settle</p>
      <button
        className="btn btn-primary"
        onClick={() =>
          writeContract({ address: instance, chainId: forkChainId, args: [Number(tokenId)] })
        }
        disabled={isBusy}
        data-testid="erc721-settle"
      >
        {isPending ? 'confirm in wallet…' : isLoading ? 'settling…' : 'settle auction'}
      </button>
      {(isError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>{failureReason ?? 'settle failed — try again'}</p>
      )}
    </div>
  )
}

function ReclaimButton({
  instance,
  tokenId,
  refetch,
}: {
  instance: `0x${string}`
  tokenId: bigint
  refetch: () => void
}) {
  const {
    writeContract,
    data: txHash,
    isPending,
    isError,
    error: writeErrObj,
    reset,
  } = useWriteErc721AuctionInstanceReclaimUnsold()
  const {
    isLoading,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })
  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)
  const isBusy = isPending || isLoading

  if (isSuccess) {
    return (
      <div className={styles.action}>
        <p className={styles.txStatus}>reclaimed — confirmed.</p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            reset()
            refetch()
          }}
        >
          ok
        </button>
      </div>
    )
  }

  return (
    <div className={styles.action}>
      <p className={styles.note}>ended with no bids — reclaim the piece</p>
      <button
        className="btn btn-secondary"
        onClick={() =>
          writeContract({ address: instance, chainId: forkChainId, args: [Number(tokenId)] })
        }
        disabled={isBusy}
        data-testid="erc721-reclaim"
      >
        {isPending ? 'confirm in wallet…' : isLoading ? 'reclaiming…' : 'reclaim unsold'}
      </button>
      {(isError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>{failureReason ?? 'reclaim failed — try again'}</p>
      )}
    </div>
  )
}

function BidHistory({ instance, tokenId }: { instance: `0x${string}`; tokenId: bigint }) {
  const { data: bids, isPending } = useBidHistory(instance, tokenId)
  if (isPending || bids.length === 0) return null
  return (
    <div className={styles.history} data-testid="erc721-bid-history">
      <span className={styles.historyLabel}>bids</span>
      <ul className={styles.historyList}>
        {bids.slice(0, 5).map((b, i) => (
          <li key={`${b.blockNumber}-${i}`} className={styles.historyRow}>
            <span>{truncateAddress(b.bidder)}</span>
            <span>{formatEther(b.amount)} ETH</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
