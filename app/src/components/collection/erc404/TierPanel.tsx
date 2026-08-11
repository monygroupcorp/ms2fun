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
 * Self-hides when disconnected or on an untiered instance (every ERC-404 shipped so far), and while
 * the ladder's single probe read is still in flight, so an untiered collection never renders anything
 * here, not even a flash of a loading state.
 */
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc404BondingInstanceDecimals,
  useWriteErc404BondingInstanceClaimReleasedEscrow,
  useWriteErc404BondingInstanceMintDown,
  useWriteErc404BondingInstanceMintUp,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { tierErrorCopy } from './tierErrorCopy'
import { useTierPosition } from './useTierPosition'
import { useErc404OwnedPieces } from './useErc404OwnedPieces'
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

  function refetchAll(): void {
    position.refetch()
    owned.refetch()
  }

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

  const selectedTierIdx = tierN === '' ? undefined : Number(tierN) - 1
  const selectedTierBand =
    selectedTierIdx !== undefined ? position.ladder[selectedTierIdx] : undefined
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

  const canMintUp = tierN !== '' && tierZeroId !== '' && ordinaryIds.length > 0 && canAffordMintUp
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
          Fold coin into a band NFT. You supply one ordinary id you own; it is consumed.
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
            {ordinaryIds.map((id) => (
              <option key={id.toString()} value={id.toString()}>
                #{id.toString()}
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
