/**
 * TierPanel (noesis-171) — the holder-facing surface for Token Tiers: fold coin into a band NFT
 * (mint up), unfold a band NFT back into coin (mint down), and claim coin released by a burn
 * (claimReleasedEscrow). Until this panel existed none of the three was reachable from the app, so
 * no band NFT could be minted on any tiered instance even though the contracts were live.
 *
 * All three actions read the same position (`useTierPosition`) — ladder, owned band pieces, balance,
 * Holdings, pending escrow release — which is why this is one panel rather than three.
 *
 * Vocabulary, ruled by rth 2026-08-10: `coinBalanceOf` is "Holdings" on screen; `balanceOf` keeps the
 * word "balance". `balance` is the PRIMARY read for every guard here — Holdings is display-only.
 *
 * Mint up NAMES one id and CONSUMES `weight` of them (noesis-356). Its first leg escrows
 * `(weight - 1) * unit` of coin, and DN404 reconciles every debit by burning ids LIFO off the TAIL of
 * the holder's `owned` array — so `weight - 1` further pieces leave alongside the named one, picked by
 * position rather than by the holder. This panel therefore renders the whole sacrifice set as ART
 * before the button is reachable, and refuses in words the ids whose position would revert the call.
 *
 * Self-hides when disconnected or on an untiered instance (every ERC-404 shipped so far), and while
 * the ladder's single probe read is still in flight, so an untiered collection never renders anything
 * here, not even a flash of a loading state.
 */
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import {
  useReadErc404BondingInstanceDecimals,
  useWriteErc404BondingInstanceClaimReleasedEscrow,
  useWriteErc404BondingInstanceMintDown,
  useWriteErc404BondingInstanceMintUp,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { invalidateInstanceQueries, txErrorReason } from '../../ui/useTxAction'
import { tierErrorCopy } from './tierErrorCopy'
import { useTierPosition } from './useTierPosition'
import { useErc404OwnedPieces } from './useErc404OwnedPieces'
import { IpfsImage } from '../../ui/IpfsImage'
import bonding from './BondingSurface.module.css'
import styles from './TierPanel.module.css'

const DEFAULT_DECIMALS = 18

export function TierPanel({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const position = useTierPosition(instance, address)
  const owned = useErc404OwnedPieces(instance, address)

  const decimalsRead = useReadErc404BondingInstanceDecimals({ address: instance, chainId })
  const decimals = decimalsRead.data ?? DEFAULT_DECIMALS

  const [tierN, setTierN] = useState('')
  const [tierZeroId, setTierZeroId] = useState('')
  const [bandId, setBandId] = useState('')

  const mintUp = useWriteErc404BondingInstanceMintUp()
  const mintDown = useWriteErc404BondingInstanceMintDown()
  const claim = useWriteErc404BondingInstanceClaimReleasedEscrow()

  const mintUpRx = useWaitForTransactionReceipt({ hash: mintUp.data })
  const mintDownRx = useWaitForTransactionReceipt({ hash: mintDown.data })
  const claimRx = useWaitForTransactionReceipt({ hash: claim.data })

  // Shared invalidation (noesis-352): mintUp/mintDown/claim move a band NFT and coin balance
  // together — SwapPanel's balance/quote and Erc404Portfolio's piece grid read the same instance and
  // must not keep showing the pre-mint position. See useTxAction's `instance` opt for the rationale.
  const queryClient = useQueryClient()
  function refetchAll(): void {
    invalidateInstanceQueries(queryClient, instance)
    position.refetch()
    owned.refetch()
  }

  // ── What mint up actually takes ─────────────────────────────────────────────────────────────
  // Order comes from `ownedIdsOf` (noesis-356) and art from `useErc404OwnedPieces`; the two are
  // joined rather than duplicated. The hook replays mirror Transfer logs and yields a SET with no
  // order, and order is exactly what a LIFO tail burn needs — hence the view.
  const selectedTierIdx = tierN === '' ? undefined : Number(tierN) - 1
  const selectedTierBand =
    selectedTierIdx !== undefined ? position.ladder[selectedTierIdx] : undefined
  const ownedOrder = position.ownedOrder
  const idLimit = owned.idLimit
  const isBandId = (id: bigint): boolean => idLimit !== undefined && id > idLimit
  const tailCount = selectedTierBand ? Number(selectedTierBand.weight - 1n) : undefined
  const tailStart =
    ownedOrder && tailCount !== undefined ? Math.max(0, ownedOrder.length - tailCount) : undefined
  const burnTailKeys = new Set(
    ownedOrder && tailStart !== undefined
      ? ownedOrder.slice(tailStart).map((id) => id.toString())
      : [],
  )
  // The ids that do NOT revert: ordinary ids the tail burn cannot reach, in owned-array order, so the
  // first entry is the lowest-index one — the ordering the contract's own docstring asks callers for.
  const safeZeroIds =
    ownedOrder && tailStart !== undefined
      ? ownedOrder.slice(0, tailStart).filter((id) => !isBandId(id))
      : undefined
  const safeKey = safeZeroIds?.join(',') ?? ''

  // Default to a safe id whenever the tier changes or the position moves. The choice stays open —
  // every ordinary id is still listed, tail ones labelled — but a holder never has to work out the
  // ordering rule to get a call that goes through.
  useEffect(() => {
    if (safeZeroIds === undefined) return
    if (tierZeroId !== '' && safeZeroIds.some((id) => id.toString() === tierZeroId)) return
    setTierZeroId(safeZeroIds[0]?.toString() ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the safe set's identity
  }, [safeKey])

  useEffect(() => {
    if (mintUpRx.isSuccess) {
      mintUp.reset()
      setTierN('')
      setTierZeroId('')
      refetchAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset/refetch stable enough; guard on success
  }, [mintUpRx.isSuccess])

  useEffect(() => {
    if (mintDownRx.isSuccess) {
      mintDown.reset()
      setBandId('')
      refetchAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintDownRx.isSuccess])

  useEffect(() => {
    if (claimRx.isSuccess) {
      claim.reset()
      refetchAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimRx.isSuccess])

  if (!isConnected) return null
  if (position.isPending) return null
  if (!position.tiered) return null

  const ordinaryIds = owned.pieces.filter((p) => !p.isTier).map((p) => p.id)
  const ownedBandIds = position.bandPieces

  const selectedBandPiece = ownedBandIds.find((p) => p.id.toString() === bandId)

  const mintUpBusy = mintUp.isPending || mintUpRx.isLoading
  const mintDownBusy = mintDown.isPending || mintDownRx.isLoading
  const claimBusy = claim.isPending || claimRx.isLoading

  // Mint up escrows `(weight - 1) * unit` of COIN as its very first leg
  // (`ERC404BondingOps.mintUp` -> `_transfer(msg.sender, address(this), escrowAmount)`), so holding
  // the tier-0 id is necessary but not sufficient: a holder short of that coin reverts. Because the
  // op runs through the returndata-discarding trampoline, that revert reaches the user as the bare
  // `TierOpFailed()`, which names no cause — so this is refused here, in words, instead. Guarded on
  // `position.balance` (transferable), NEVER on Holdings: the escrowed coin behind a band NFT is
  // exactly what cannot be spent on another one.
  const mintUpEscrow =
    selectedTierBand && owned.unit !== undefined
      ? (selectedTierBand.weight - 1n) * owned.unit
      : undefined
  const canAffordMintUp =
    mintUpEscrow !== undefined && position.balance !== undefined && position.balance >= mintUpEscrow

  // The order read is a HARD precondition, not a nicety: without it the panel cannot say which pieces
  // leave and cannot tell a safe id from a reverting one, and an unpredicted revert arrives as the
  // causeless `TierOpFailed()`. Better to wait for the read than to offer a call we cannot describe.
  const orderKnown = ownedOrder !== undefined
  const namedIdReverts = tierZeroId !== '' && burnTailKeys.has(tierZeroId)
  const canMintUp =
    tierN !== '' &&
    tierZeroId !== '' &&
    ordinaryIds.length > 0 &&
    canAffordMintUp &&
    orderKnown &&
    !namedIdReverts

  // The whole set that leaves, in owned-array order: the named id plus the burn tail.
  const pieceById = new Map(owned.pieces.map((p) => [p.id.toString(), p]))
  const sacrificeIds =
    selectedTierBand && ownedOrder && tierZeroId !== '' && !namedIdReverts
      ? ownedOrder.filter((id) => id.toString() === tierZeroId || burnTailKeys.has(id.toString()))
      : undefined
  // Ordinary ids to offer, in the order that decides their fate rather than in log-replay order.
  const selectableZeroIds = ownedOrder ? ownedOrder.filter((id) => !isBandId(id)) : ordinaryIds
  const canMintDown = bandId !== '' && ownedBandIds.length > 0
  const hasClaimable =
    position.pendingEscrowRelease !== undefined && position.pendingEscrowRelease > 0n

  const mintUpReason = txErrorReason(mintUp.error)
  const mintDownReason = txErrorReason(mintDown.error)
  const claimReason = txErrorReason(claim.error)

  return (
    <div className={bonding.panel} data-testid="erc404-tier-panel">
      <p className={bonding.panelTitle}>token tiers</p>

      {/* ---- Mint up ---- */}
      <div className={styles.formSection}>
        <p className={styles.hint}>
          Fold coin into a band NFT. You name one ordinary id, and the op takes the tier's full
          weight in pieces: the id you name plus the last few in your wallet's own order, which the
          escrow leg burns. Every piece that leaves is shown below before you sign.
        </p>

        <div className={bonding.field}>
          <label className={bonding.label} htmlFor="tier-panel-tier-select">
            target tier
          </label>
          <select
            id="tier-panel-tier-select"
            className={bonding.input}
            value={tierN}
            onChange={(e) => setTierN(e.target.value)}
            disabled={mintUpBusy}
            data-testid="tier-panel-tier-select"
          >
            <option value="">select a tier</option>
            {position.ladder.map((band, i) => (
              <option key={i} value={i + 1}>
                tier {i + 1} (weight {band.weight.toString()})
              </option>
            ))}
          </select>
        </div>

        <div className={bonding.field}>
          <label className={bonding.label} htmlFor="tier-panel-zero-id-select">
            id to consume
          </label>
          <select
            id="tier-panel-zero-id-select"
            className={bonding.input}
            value={tierZeroId}
            onChange={(e) => setTierZeroId(e.target.value)}
            disabled={mintUpBusy || ordinaryIds.length === 0}
            data-testid="tier-panel-zero-id-select"
          >
            <option value="">
              {ordinaryIds.length === 0 ? 'no eligible ids owned' : 'select an id'}
            </option>
            {selectableZeroIds.map((id) => (
              <option key={id.toString()} value={id.toString()}>
                #{id.toString()}
                {burnTailKeys.has(id.toString()) ? ' — in the burn tail, would revert' : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedTierBand && (
          <p className={styles.note} data-testid="tier-panel-mint-up-consequence">
            You will hold one tier {tierN} NFT (weight {selectedTierBand.weight.toString()}).{' '}
            <b>{(selectedTierBand.weight - 1n).toString()}</b> unit
            {selectedTierBand.weight - 1n === 1n ? '' : 's'} move into escrow behind it and leave
            your transferable balance — this is the number other surfaces will show as a loss. Your
            Holdings are unchanged. Reversible via mint down.
          </p>
        )}

        {/* The ruled deliverable: the pieces that leave, as art, before the signature. */}
        {selectedTierBand && sacrificeIds && (
          <div className={styles.sacrifice} data-testid="tier-panel-sacrifice">
            <p className={styles.hint}>
              Leaving your wallet — <b>{sacrificeIds.length}</b> piece
              {sacrificeIds.length === 1 ? '' : 's'}: the id you name, plus the last{' '}
              <b>{tailCount}</b> in your wallet's order. One tier {tierN} NFT arrives in their
              place.
            </p>
            <ul className={styles.sacrificeGrid}>
              {sacrificeIds.map((id) => {
                const piece = pieceById.get(id.toString())
                const named = id.toString() === tierZeroId
                return (
                  <li
                    key={id.toString()}
                    className={styles.sacrificeTile}
                    data-testid="tier-panel-sacrifice-tile"
                  >
                    <IpfsImage
                      uri={piece?.image ?? ''}
                      alt={`#${id.toString()}`}
                      className={styles.thumb}
                      fallback={<div className={styles.thumbGlyph}>✦</div>}
                    />
                    <span className={styles.tileId}>#{id.toString()}</span>
                    <span className={styles.tileBadge}>
                      {named ? 'you named' : isBandId(id) ? 'band' : 'burned to escrow'}
                    </span>
                  </li>
                )
              })}
            </ul>
            {sacrificeIds.some((id) => isBandId(id)) && (
              <p className={styles.warn} data-testid="tier-panel-sacrifice-band">
                A band NFT is in that set. Its escrow comes back to you as claimable escrow — the
                band NFT itself does not.
              </p>
            )}
            <p className={styles.note} data-testid="tier-panel-sacrifice-fate">
              All of these return to the mintable pool, the id you name included. Mint down gives
              back an ordinary NFT, not the same id. Art pinned to an id stays with the id: a
              commission already paid for is not cleared when the id is re-issued, so whoever mints
              it next receives that art without paying for it. Keep a commissioned piece out of this
              set.
            </p>
          </div>
        )}

        {/* D2, in words rather than as a bare `TierOpFailed()` after the fact. */}
        {selectedTierBand && namedIdReverts && (
          <p className={styles.warn} data-testid="tier-panel-mint-up-tail-id">
            #{tierZeroId} is one of the last <b>{tailCount}</b> pieces in your wallet's order. The
            escrow leg burns those before it looks for the id you named, so this call would revert
            without reporting a cause. Pick an id from earlier in the order.
          </p>
        )}

        {selectedTierBand && safeZeroIds !== undefined && safeZeroIds.length === 0 && (
          <p className={styles.warn} data-testid="tier-panel-mint-up-no-safe-id">
            Every ordinary id you hold sits inside the burn tail this tier takes, so any of them
            would revert. Hold one piece more than the tier's weight, or choose a lower tier.
          </p>
        )}

        {selectedTierBand && !orderKnown && (
          <p className={styles.note} data-testid="tier-panel-order-pending">
            Reading the order of your pieces — the set that leaves cannot be named until it lands.
          </p>
        )}

        {/* D3: a band NFT is held conditionally, and the condition is positional. */}
        {selectedTierBand && (
          <p className={styles.note} data-testid="tier-panel-band-permanence">
            Holding a band NFT is conditional. Only the most recently minted one sits in the
            protected slot at the front of your order; spending coin burns pieces off the back, so
            an ordinary sell can reach an earlier band. If that happens its escrow returns as
            claimable escrow below — the band NFT itself does not come back.
          </p>
        )}

        {/* Said before the button is reached for, not after a revert that names no cause. */}
        {selectedTierBand && mintUpEscrow !== undefined && !canAffordMintUp && (
          <p className={styles.note} data-testid="tier-panel-mint-up-short">
            Not enough transferable balance: this tier escrows{' '}
            <b>{formatUnits(mintUpEscrow, decimals)}</b> and you can transfer{' '}
            <b>{formatUnits(position.balance ?? 0n, decimals)}</b>. Coin already escrowed behind a
            band NFT cannot pay for another — mint down first, or hold more.
          </p>
        )}

        <button
          className={`btn btn-primary ${styles.fullWidthBtn}`}
          onClick={() => {
            if (!canMintUp || selectedTierIdx === undefined) return
            mintUp.writeContract({
              address: instance,
              chainId,
              args: [selectedTierIdx + 1, BigInt(tierZeroId)],
            })
          }}
          disabled={mintUpBusy || !canMintUp}
          data-testid="tier-panel-mint-up"
        >
          {mintUp.isPending ? 'confirm in wallet…' : mintUpRx.isLoading ? 'minting up…' : 'mint up'}
        </button>
        {mintUpReason && (
          <p className={`${bonding.txStatus} ${bonding.txError}`}>
            mint up failed: {tierErrorCopy(mintUpReason) ?? mintUpReason}
          </p>
        )}
      </div>

      {/* ---- Mint down ---- */}
      <div className={styles.formSection}>
        <p className={styles.hint}>
          Unfold a band NFT you own back into an ordinary NFT. Its escrow returns to your
          transferable balance.
        </p>

        <div className={bonding.field}>
          <label className={bonding.label} htmlFor="tier-panel-band-select">
            band NFT to unfold
          </label>
          <select
            id="tier-panel-band-select"
            className={bonding.input}
            value={bandId}
            onChange={(e) => setBandId(e.target.value)}
            disabled={mintDownBusy || ownedBandIds.length === 0}
            data-testid="tier-panel-band-select"
          >
            <option value="">
              {ownedBandIds.length === 0 ? 'no band NFTs owned' : 'select a band NFT'}
            </option>
            {ownedBandIds.map((p) => (
              <option key={p.id.toString()} value={p.id.toString()}>
                #{p.id.toString()} (tier {p.tierN}, weight {p.weight.toString()})
              </option>
            ))}
          </select>
        </div>

        {selectedBandPiece && (
          <p className={styles.note} data-testid="tier-panel-mint-down-consequence">
            #{selectedBandPiece.id.toString()} becomes an ordinary NFT again.{' '}
            <b>{(selectedBandPiece.weight - 1n).toString()}</b> unit
            {selectedBandPiece.weight - 1n === 1n ? '' : 's'} of escrow return to your transferable
            balance. Your Holdings are unchanged.
          </p>
        )}

        <button
          className={`btn btn-secondary ${styles.fullWidthBtn}`}
          onClick={() => {
            if (!canMintDown || !selectedBandPiece) return
            mintDown.writeContract({
              address: instance,
              chainId,
              args: [selectedBandPiece.id],
            })
          }}
          disabled={mintDownBusy || !canMintDown}
          data-testid="tier-panel-mint-down"
        >
          {mintDown.isPending
            ? 'confirm in wallet…'
            : mintDownRx.isLoading
              ? 'minting down…'
              : 'mint down'}
        </button>
        {mintDownReason && (
          <p className={`${bonding.txStatus} ${bonding.txError}`}>
            mint down failed: {tierErrorCopy(mintDownReason) ?? mintDownReason}
          </p>
        )}
      </div>

      {/* ---- Claim released escrow ---- */}
      {hasClaimable && (
        <div className={styles.formSection}>
          <p className={styles.hint}>
            A coin-path debit burned a band NFT you owned and credited you its escrow. The credit is
            a <b>pull</b> — it is not in your balance until you claim it. Claiming re-materializes
            ordinary NFTs through the standard mint flow, subject to your skip-NFT setting.
          </p>
          <p className={styles.note} data-testid="tier-panel-claim-amount">
            released and waiting:{' '}
            <b>{formatUnits(position.pendingEscrowRelease ?? 0n, decimals)}</b>
          </p>
          <button
            className={`btn btn-primary btn-chromatic ${styles.fullWidthBtn}`}
            onClick={() => claim.writeContract({ address: instance, chainId })}
            disabled={claimBusy}
            data-testid="tier-panel-claim"
          >
            {claim.isPending
              ? 'confirm in wallet…'
              : claimRx.isLoading
                ? 'claiming…'
                : 'claim released escrow'}
          </button>
          {claimReason && (
            <p className={`${bonding.txStatus} ${bonding.txError}`}>
              claim failed: {tierErrorCopy(claimReason) ?? claimReason}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
