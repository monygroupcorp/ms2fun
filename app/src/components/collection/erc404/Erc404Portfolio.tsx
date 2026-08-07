/**
 * Erc404Portfolio (T2) — the connected holder's own pieces for a bonding ERC404 collection, and the
 * home of REROLL. Reroll re-rolls the random NFT-id assignment for `tokenAmount` of your tokens while
 * EXEMPTING the ids you want to keep. The old panel made you TYPE the keep-ids; here you pick them
 * visually — click pieces in this grid to mark them "keep", then open the reroll dropdown. The
 * selected ids become `rerollSelectedNFTs`'s exempted list.
 *
 * TIER AWARENESS (noesis-159). On a tiered collection some owned ids are tier (band) NFTs, and the
 * contract exempts every one of them from a reroll whether or not the holder selects it. So this
 * surface (a) marks them as protected rather than selectable, (b) states how many ORDINARY pieces a
 * given amount will actually reroll — the auto-exempted tier NFTs consume the amount too — and
 * (c) refuses to submit a reroll the chain would reject, explaining it in words first. Untiered
 * collections carry no such ids and render exactly as before.
 *
 * Self-hides when disconnected. Owned ids come from the mirror Transfer-log replay (useErc404OwnedPieces).
 */
import { useEffect, useMemo, useState } from 'react'
import { parseUnits } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc404BondingInstanceDecimals,
  useReadErc404BondingInstanceGetSkipNft,
  useWriteErc404BondingInstanceRerollSelectedNfTs,
  useWriteErc404BondingInstanceSetSkipNft,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { IpfsImage } from '../../ui/IpfsImage'
import { LearnLink } from '../../wizard/LearnLink'
import { useErc404OwnedPieces, type OwnedPiece } from './useErc404OwnedPieces'
import { planReroll } from './rerollMath'
import styles from './Erc404Portfolio.module.css'

const DEFAULT_DECIMALS = 18

export function Erc404Portfolio({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const { pieces, unit, isPending, refetch } = useErc404OwnedPieces(instance, address)
  const [keep, setKeep] = useState<Set<string>>(new Set())

  const decimalsRead = useReadErc404BondingInstanceDecimals({
    address: instance,
    chainId,
  })
  const decimals = decimalsRead.data ?? DEFAULT_DECIMALS

  // Drop keep-selections for ids no longer held (after a reroll/transfer).
  const ownedKeys = useMemo(() => new Set(pieces.map((p) => p.id.toString())), [pieces])
  useEffect(() => {
    setKeep((prev) => {
      const next = new Set([...prev].filter((k) => ownedKeys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [ownedKeys])

  if (!isConnected) return null
  if (!isPending && pieces.length === 0) return null // nothing to show / reroll

  function toggle(id: bigint): void {
    const k = id.toString()
    setKeep((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const keptIds = pieces
    .map((p) => p.id)
    .filter((id) => keep.has(id.toString()))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  return (
    <section className={styles.card} data-testid="erc404-portfolio">
      <div className={styles.head}>
        <h2 className={styles.title}>
          Your pieces {pieces.length > 0 && <span>· {pieces.length}</span>}
        </h2>
        {keptIds.length > 0 && (
          <button type="button" className={styles.clear} onClick={() => setKeep(new Set())}>
            clear selection
          </button>
        )}
      </div>

      {isPending ? (
        <p className={styles.note}>loading your pieces…</p>
      ) : (
        <>
          <p className={styles.hint}>Tap a piece to KEEP it through a reroll.</p>
          <ul className={styles.grid} data-testid="erc404-portfolio-grid">
            {pieces.map((p) => {
              const selected = keep.has(p.id.toString())
              const art = (
                <>
                  <IpfsImage
                    uri={p.image ?? ''}
                    alt={`#${p.id.toString()}`}
                    className={styles.thumb}
                    fallback={<div className={styles.thumbGlyph}>✦</div>}
                  />
                  <span className={styles.tileId}>#{p.id.toString()}</span>
                </>
              )
              // A tier NFT is exempt on-chain whether or not it is clicked, so a "keep" toggle on it
              // would be a no-op control. It renders as a non-interactive, protected tile instead.
              if (p.isTier) {
                return (
                  <li key={p.id.toString()}>
                    <div
                      className={`${styles.tile} ${styles.tileTier}`}
                      data-testid="erc404-portfolio-tile-tier"
                    >
                      {art}
                      <span className={styles.tierBadge} title="Tier NFTs are never rerolled.">
                        tier · protected
                      </span>
                    </div>
                  </li>
                )
              }
              return (
                <li key={p.id.toString()}>
                  <button
                    type="button"
                    className={`${styles.tile} ${selected ? styles.tileKept : ''}`}
                    onClick={() => toggle(p.id)}
                    aria-pressed={selected}
                    data-testid="erc404-portfolio-tile"
                  >
                    {art}
                    {selected && <span className={styles.keepBadge}>keep</span>}
                  </button>
                </li>
              )
            })}
          </ul>

          <RerollDropdown
            instance={instance}
            decimals={decimals}
            pieces={pieces}
            unit={unit}
            keptIds={keptIds}
            onDone={() => {
              refetch()
              setKeep(new Set())
            }}
          />
        </>
      )}
    </section>
  )
}

/** The shielded reroll control (T2 + prior S6 shape): a disclosure holding the amount, skip-NFT
 *  toggle, keep-summary, and the reroll button. */
function RerollDropdown({
  instance,
  decimals,
  pieces,
  unit,
  keptIds,
  onDone,
}: {
  instance: `0x${string}`
  decimals: number
  pieces: OwnedPiece[]
  unit: bigint | undefined
  keptIds: bigint[]
  onDone: () => void
}) {
  const chainId = useCollectionChainId()
  const [amountStr, setAmountStr] = useState('')

  const skipNft = useReadErc404BondingInstanceGetSkipNft({
    address: instance,
    chainId: chainId,
  })
  const setSkip = useWriteErc404BondingInstanceSetSkipNft()
  const reroll = useWriteErc404BondingInstanceRerollSelectedNfTs()
  const setSkipRx = useWaitForTransactionReceipt({ hash: setSkip.data })
  const rerollRx = useWaitForTransactionReceipt({ hash: reroll.data })

  let amount: bigint | undefined
  try {
    amount = amountStr.trim() === '' ? undefined : parseUnits(amountStr.trim(), decimals)
    if (amount !== undefined && amount <= 0n) amount = undefined
  } catch {
    amount = undefined
  }

  useEffect(() => {
    if (rerollRx.isSuccess) {
      reroll.reset()
      setAmountStr('')
      onDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset/onDone stable enough; guard on success
  }, [rerollRx.isSuccess])

  const refetchSkip = skipNft.refetch
  useEffect(() => {
    if (setSkipRx.isSuccess) {
      setSkip.reset()
      void refetchSkip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSkipRx.isSuccess])

  const skipBusy = setSkip.isPending || setSkipRx.isLoading
  const rerollBusy = reroll.isPending || rerollRx.isLoading
  const reason = txErrorReason(reroll.error)

  // What the chain will actually do with this amount (rerollMath mirrors the contract).
  const plan = planReroll({ amount, unit, pieces, keptIds })
  const tierCount = pieces.filter((p) => p.isTier).length

  return (
    <details className={styles.reroll}>
      <summary className={styles.rerollSummary} data-testid="erc404-reroll-disclosure">
        Advanced · reroll pieces
      </summary>

      <div className={styles.rerollBody}>
        <p className={styles.hint}>
          Re-rolls the NFT ids for the token amount below, keeping the <b>{keptIds.length}</b> piece
          {keptIds.length === 1 ? '' : 's'} you selected above
          {keptIds.length > 0 && <> (#{keptIds.map((id) => id.toString()).join(', #')})</>}
          {tierCount > 0 && (
            <>
              , plus the <b>{tierCount}</b> tier NFT{tierCount === 1 ? '' : 's'} you hold, which{' '}
              {tierCount === 1 ? 'is' : 'are'} exempt automatically
            </>
          )}
          .
        </p>

        {tierCount > 0 && (
          <p className={styles.hint}>
            Every exempt piece — selected or tier — still takes one whole unit out of the amount you
            enter, so the amount rerolls fewer ordinary pieces than it names.
          </p>
        )}

        <p className={styles.hint}>
          <LearnLink slug="id-persistence" label="Which pieces you keep, and which ids move" />
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="erc404-reroll-amount">
            token amount to reroll
          </label>
          <input
            id="erc404-reroll-amount"
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.0"
            disabled={rerollBusy}
            data-testid="erc404-reroll-amount"
          />
          {plan.blockReason === 'all-tier-position' ? (
            <p className={styles.note} data-testid="erc404-reroll-effective">
              Every piece you hold is a tier NFT, and a reroll never touches one — there is nothing
              for this to reroll. To turn a tier NFT back into ordinary pieces, use <b>mintDown</b>:
              it releases the piece&rsquo;s escrow as coin, which you can then hold as ordinary
              pieces.
            </p>
          ) : plan.blockReason === 'amount-below-exempt-cost' ||
            plan.blockReason === 'nothing-left-to-reroll' ? (
            <p className={styles.note} data-testid="erc404-reroll-effective">
              This amount is fully taken up by the <b>{plan.exemptCount}</b> exempt piece
              {plan.exemptCount === 1 ? '' : 's'} above, so it would reroll <b>0</b> ordinary pieces
              and the transaction would be rejected. Enter more than {plan.exemptCount + 1} whole
              units, or clear a selection.
            </p>
          ) : (
            amount !== undefined && (
              <p className={styles.note} data-testid="erc404-reroll-effective">
                Rerolls <b>{plan.effectiveCount}</b> ordinary piece
                {plan.effectiveCount === 1 ? '' : 's'}
                {plan.exemptCount > 0 && (
                  <>
                    {' '}
                    · <b>{plan.exemptCount}</b> exempt (selected + tier)
                  </>
                )}
                .
              </p>
            )
          )}
        </div>

        <div className={styles.skipRow}>
          <span>skip NFT materialization: {skipNft.data ? 'on' : 'off'}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setSkip.writeContract({
                address: instance,
                chainId: chainId,
                args: [!(skipNft.data ?? false)],
              })
            }
            disabled={skipBusy}
            data-testid="erc404-setskipnft"
          >
            {skipBusy ? '…' : skipNft.data ? 'turn off' : 'turn on'}
          </button>
        </div>

        <button
          className="btn btn-primary btn-chromatic"
          onClick={() => {
            if (amount === undefined || !plan.canReroll) return
            setSkip.reset()
            reroll.writeContract({
              address: instance,
              chainId: chainId,
              args: [amount, keptIds],
            })
          }}
          disabled={rerollBusy || amount === undefined || !plan.canReroll}
          data-testid="erc404-reroll"
        >
          {reroll.isPending ? 'confirm in wallet…' : rerollRx.isLoading ? 'rerolling…' : 'reroll'}
        </button>

        {reason && <p className={`${styles.note} ${styles.err}`}>reroll failed: {reason}</p>}
      </div>
    </details>
  )
}
