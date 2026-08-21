/**
 * AuctionCard (W-B3) — one auction on one line, rendered per its derived state:
 *   active         → countdown + bid form (createBid, min = minNextBid)
 *   endedWithBids  → "ready to settle" + settleAuction (anyone can call)
 *   endedNoBids    → owner-only reclaimUnsold
 *   settled        → sold summary
 * Bid history (BidPlaced events) shows under the live/settle states.
 */
import { useEffect, useMemo, useState } from 'react'
import { decodeEventLog, formatEther, parseEther, zeroAddress, type Log } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useReadContract, useWaitForTransactionReceipt } from 'wagmi'
import {
  erc721AuctionInstanceAbi,
  useReadErc721AuctionInstanceGenesisVault,
  useReadErc721AuctionInstanceProtocolTreasury,
  useWriteErc721AuctionInstanceCreateBid,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason, useTxAction } from '../../ui/useTxAction'
import { TxButton } from '../../ui/TxButton'
import { formatReceipt, type MoneyReceipt } from '../../ui/receipt'
import { fetchJson, jsonOrNull } from '../../../lib/metadata'
import { IpfsImage } from '../../ui/IpfsImage'
import { truncateAddress } from '../../../lib/format'
import { deriveAuctionState } from './auctionState'
import { minNextBid } from './bidMath'
import { useBidHistory } from './useBidHistory'
import type { ActiveAuction, AuctionConfig } from './useAuctions'
import styles from './Erc721Auction.module.css'

// Minimal ABI shared by every alignment vault flavor (Uni/ZAMM/Cypher/Aave) — enough to read the
// self-reported family string used to pick the settlement split, without importing a
// flavor-specific generated ABI here.
const vaultTypeAbi = [
  {
    type: 'function',
    name: 'vaultType',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

// Liquidity-family vaults (RevenueSplitLib.isLiquidityFamily) split settlement 1% protocol / 19%
// vault / 80% creator; the yield/endowment family flips vault and creator (1/80/19). Mirrored here
// so the confirmation states the split that will actually apply — both legs are already knowable
// pre-tx from public state (the bid amount and the vault's own family), so there's no drift risk
// the way there is for the ERC404 carve (whose gross is set by chain-side clamping at tx time).
const LIQUIDITY_FAMILY_VAULT_TYPES = new Set(['UniswapV4LP', 'ZAMMLP', 'CypherLP'])

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
    queryFn: async () =>
      jsonOrNull(await fetchJson<{ name?: string; image?: string }>(auction.tokenURI)),
  })

  const title = meta?.name || `#${auction.tokenId.toString()}`
  const left = auction.endTime - nowSec
  const urgent = state === 'active' && left > 0n && left < 900n // < 15 min

  return (
    <li className={styles.card} data-testid="erc721-auction" data-state={state}>
      <div className={styles.cardHeader}>
        <IpfsImage
          uri={meta?.image ?? ''}
          alt={title}
          className={styles.thumb}
          fallback={<div className={styles.thumbGlyph}>✦</div>}
        />
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
      return <SettleButton instance={instance} auction={auction} refetch={refetch} />
    case 'endedNoBids':
      return isOwner ? (
        <ReclaimButton instance={instance} auction={auction} refetch={refetch} />
      ) : (
        <p className={styles.note}>auction ended — no bids</p>
      )
    case 'settled':
      return <SoldSummary instance={instance} auction={auction} />
    default:
      return null
  }
}

/** Post-settle summary. The sale line (gross, to whoever won) stays — it's true and useful — but it
 *  is no longer the only figure: the creator's actual net is shown alongside it, not just at the
 *  moment of settling but every time this state re-renders (a fresh page load included). */
function SoldSummary({ instance, auction }: { instance: `0x${string}`; auction: ActiveAuction }) {
  const chainId = useCollectionChainId()
  const liquidityFamily = useLiquidityFamily(instance, chainId)

  const netLine = (() => {
    if (liquidityFamily === undefined) return undefined
    const protocolLeg = auction.highBid / 100n
    const vaultLeg = liquidityFamily
      ? (auction.highBid * 19n) / 100n
      : (auction.highBid * 80n) / 100n
    const creatorLeg = auction.highBid - protocolLeg - vaultLeg
    const net = creatorLeg + auction.minBid
    return formatReceipt({
      verb: 'settled',
      net: { label: 'creator received', wei: net },
      legs: [
        { label: 'protocol', wei: protocolLeg },
        { label: 'vault', wei: vaultLeg },
      ],
    })
  })()

  return (
    <div>
      <p className={styles.note} data-testid="erc721-sold">
        sold for {formatEther(auction.highBid)} ETH to {truncateAddress(auction.highBidder)}
      </p>
      {netLine !== undefined && (
        <p className={styles.note} data-testid="erc721-sold-net">
          {netLine}
        </p>
      )}
    </div>
  )
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
  const chainId = useCollectionChainId()
  const min = minNextBid({
    minBid: auction.minBid,
    highBid: auction.highBid,
    highBidder: auction.highBidder,
    bidIncrement: config.bidIncrement,
  })
  // Seeded at the minimum legal next bid (W-B3/noesis-353) rather than starting empty — the bidder
  // never has to derive the floor by hand. `touched` tracks whether the bidder has diverged from the
  // seed (typing, or the +/- stepper); while untouched the field re-seeds itself whenever `min` moves
  // (another bid landing while the card is open), since a stale floor is a guaranteed revert. Once
  // touched, typed input is left alone — typing stays a first-class way to bid — and the existing
  // `tooLow` check below is what actually guards the tx if a typed/stale value falls under the floor.
  const [value, setValue] = useState<string>(() => formatEther(min))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setValue(formatEther(min))
  }, [min, touched])
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
      chainId,
      args: [Number(auction.tokenId), '0x'],
      value: amountWei,
    })
  }

  /** Step the bid up/down by the auction's own `bidIncrement`, clamped so the field can never hold
   *  a value the contract would reject. Steps from the current typed amount when it parses, or from
   *  the seeded minimum otherwise (e.g. the field is empty or unparseable). */
  function step(direction: 1n | -1n): void {
    const base = amountWei ?? min
    const stepped = base + direction * config.bidIncrement
    const next = stepped > min ? stepped : min
    setValue(formatEther(next))
    setTouched(true)
  }

  if (!isConnected) return <p className={styles.note}>connect wallet to bid</p>

  if (isSuccess) {
    return (
      <div className={styles.action}>
        <p className={styles.txStatus} data-testid="erc721-bid-success">
          {amountWei !== undefined
            ? formatReceipt({ verb: 'bid placed', net: { label: 'bid', wei: amountWei } })
            : 'bid placed — confirmed.'}
        </p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            reset()
            setTouched(false)
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
        <button
          type="button"
          className={`btn btn-secondary ${styles.stepperBtn}`}
          onClick={() => step(-1n)}
          disabled={isBusy}
          aria-label="decrease bid by the increment"
          data-testid="erc721-bid-decrement"
        >
          −
        </button>
        <input
          className={styles.bidInput}
          type="text"
          inputMode="decimal"
          placeholder={`min ${formatEther(min)}`}
          value={value}
          onChange={(e) => {
            setTouched(true)
            setValue(e.target.value)
          }}
          disabled={isBusy}
          aria-label="bid amount in ETH"
          data-testid="erc721-bid-input"
        />
        <button
          type="button"
          className={`btn btn-secondary ${styles.stepperBtn}`}
          onClick={() => step(1n)}
          disabled={isBusy}
          aria-label="increase bid by the increment"
          data-testid="erc721-bid-increment"
        >
          +
        </button>
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
        <p className={`${styles.txStatus} ${styles.txError}`}>
          {failureReason ?? 'bid failed — try again'}
        </p>
      )}
    </div>
  )
}

/** True for a liquidity-family alignment vault (1% protocol / 19% vault / 80% creator settle
 *  split); false for the yield/endowment family (1% / 80% / 19%, mirrored). Undefined while the
 *  vault's self-reported type is still loading. */
function useLiquidityFamily(
  instance: `0x${string}`,
  chainId: ReturnType<typeof useCollectionChainId>,
): boolean | undefined {
  const { data: genesisVault } = useReadErc721AuctionInstanceGenesisVault({
    address: instance,
    chainId,
  })
  const { data: vaultType } = useReadContract({
    address: genesisVault,
    abi: vaultTypeAbi,
    functionName: 'vaultType',
    chainId,
    query: { enabled: genesisVault !== undefined },
  })
  if (vaultType === undefined) return undefined
  return LIQUIDITY_FAMILY_VAULT_TYPES.has(vaultType)
}

function SettleButton({
  instance,
  auction,
  refetch,
}: {
  instance: `0x${string}`
  auction: ActiveAuction
  refetch: () => void
}) {
  const chainId = useCollectionChainId()
  const tx = useTxAction()
  const liquidityFamily = useLiquidityFamily(instance, chainId)

  // Same split RevenueSplitLib.split() computes on-chain (1% protocol / 19% vault, floor
  // division, remainder absorbs the rounding dust as the creator's 80%) or splitMint()'s mirror
  // for a yield-family vault (1% / 80% vault / 19% creator) — both legs are knowable from public
  // state (the bid amount, the vault's own family) before the tx, so there's no drift risk here
  // the way there is for the ERC404 carve.
  const receipt: MoneyReceipt | undefined =
    liquidityFamily === undefined
      ? undefined
      : (() => {
          const protocolLeg = auction.highBid / 100n
          const vaultLeg = liquidityFamily
            ? (auction.highBid * 19n) / 100n
            : (auction.highBid * 80n) / 100n
          const creatorLeg = auction.highBid - protocolLeg - vaultLeg
          const net = creatorLeg + auction.minBid // creator's sale proceeds + returned deposit
          return {
            verb: 'settled',
            net: { label: 'creator received', wei: net },
            legs: [
              { label: 'protocol', wei: protocolLeg },
              { label: 'vault', wei: vaultLeg },
            ],
          }
        })()

  return (
    <div className={styles.action}>
      {tx.state !== 'success' && <p className={styles.note}>auction ended — ready to settle</p>}
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            functionName: 'settleAuction',
            args: [Number(auction.tokenId)],
            chainId,
          })
        }
        label="settle auction"
        signingLabel="confirm in wallet…"
        confirmingLabel="settling…"
        receipt={receipt}
        successLabel={receipt === undefined ? 'settled — confirmed.' : undefined}
        onReset={() => {
          tx.reset()
          refetch()
        }}
        errorText={tx.reason ?? 'settle failed — try again'}
        testId="erc721-settle"
      />
    </div>
  )
}

// Reads `UnsoldReclaimed(tokenId, creatorRefund, protocolCut)` off the confirmed tx receipt — the
// authoritative post-clamp figures `reclaimUnsold` actually settled on, never a re-quote. The
// contract takes a cut ONLY when `protocolCut > 0` (it floors to 0 for a tiny deposit) AND
// `protocolTreasury != address(0)`; either condition failing means the full deposit is refunded and
// `protocolCut` reads 0 in the event, so `legs` is omitted rather than showing a stale nonzero cut.
function reclaimReceiptFromLogs(logs: readonly Log[]): MoneyReceipt | undefined {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: erc721AuctionInstanceAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'UnsoldReclaimed') {
        const { creatorRefund, protocolCut } = decoded.args
        const receipt: MoneyReceipt = {
          verb: 'deposit reclaimed',
          net: { label: 'you received', wei: creatorRefund },
        }
        if (protocolCut > 0n) receipt.legs = [{ label: 'protocol', wei: protocolCut }]
        return receipt
      }
    } catch {
      // Not an UnsoldReclaimed log (a different event, or a log from another contract in the same
      // tx) — decodeEventLog throws on a topic0 mismatch; skip it and keep scanning.
    }
  }
  return undefined
}

function ReclaimButton({
  instance,
  auction,
  refetch,
}: {
  instance: `0x${string}`
  auction: ActiveAuction
  refetch: () => void
}) {
  const chainId = useCollectionChainId()
  const tx = useTxAction()
  const { data: receiptData } = useWaitForTransactionReceipt({ hash: tx.hash })
  const receipt = useMemo(
    () => (receiptData !== undefined ? reclaimReceiptFromLogs(receiptData.logs) : undefined),
    [receiptData],
  )

  // Pre-action disclosure: `protocolTreasury` is a constructor-set immutable, but a cut is still
  // only taken when it's nonzero AND the flat 1% doesn't floor to 0 for this deposit — mirror both
  // conditions here so the disclosure never promises a cut the contract won't actually take.
  const { data: protocolTreasury } = useReadErc721AuctionInstanceProtocolTreasury({
    address: instance,
    chainId,
  })
  const estimatedProtocolCut = auction.minBid / 100n
  const cutWillApply =
    protocolTreasury !== undefined && protocolTreasury !== zeroAddress && estimatedProtocolCut > 0n

  return (
    <div className={styles.action}>
      {/* This is an ETH deposit refund, not an NFT — reclaimUnsold never mints. Whether the 1%
          protocol cut applies is stated here, before the action, not only in the confirmation
          after it. */}
      {tx.state !== 'success' && (
        <p className={styles.note}>
          ended with no bids — reclaim your deposit ({formatEther(auction.minBid)} ETH
          {cutWillApply ? ', minus a 1% protocol cut' : ', refunded in full'})
        </p>
      )}
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            functionName: 'reclaimUnsold',
            args: [Number(auction.tokenId)],
            chainId,
          })
        }
        label="reclaim deposit"
        className="btn btn-secondary"
        signingLabel="confirm in wallet…"
        confirmingLabel="reclaiming…"
        receipt={receipt}
        successLabel={receipt === undefined ? 'reclaimed — confirmed.' : undefined}
        onReset={() => {
          tx.reset()
          refetch()
        }}
        errorText={tx.reason ?? 'reclaim failed — try again'}
        testId="erc721-reclaim"
      />
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
