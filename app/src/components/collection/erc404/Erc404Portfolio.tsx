/**
 * Erc404Portfolio (T2) — the connected holder's own pieces for a bonding ERC404 collection, and the
 * home of REROLL. Reroll re-rolls the random NFT-id assignment for `tokenAmount` of your tokens while
 * EXEMPTING the ids you want to keep. The old panel made you TYPE the keep-ids; here you pick them
 * visually — click pieces in this grid to mark them "keep", then open the reroll dropdown. The
 * selected ids become `rerollSelectedNFTs`'s exempted list.
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
import { useErc404OwnedPieces } from './useErc404OwnedPieces'
import styles from './Erc404Portfolio.module.css'

const DEFAULT_DECIMALS = 18

export function Erc404Portfolio({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const { pieces, isPending, refetch } = useErc404OwnedPieces(instance, address)
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
              return (
                <li key={p.id.toString()}>
                  <button
                    type="button"
                    className={`${styles.tile} ${selected ? styles.tileKept : ''}`}
                    onClick={() => toggle(p.id)}
                    aria-pressed={selected}
                    data-testid="erc404-portfolio-tile"
                  >
                    <IpfsImage
                      uri={p.image ?? ''}
                      alt={`#${p.id.toString()}`}
                      className={styles.thumb}
                      fallback={<div className={styles.thumbGlyph}>✦</div>}
                    />
                    <span className={styles.tileId}>#{p.id.toString()}</span>
                    {selected && <span className={styles.keepBadge}>keep</span>}
                  </button>
                </li>
              )
            })}
          </ul>

          <RerollDropdown
            instance={instance}
            decimals={decimals}
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
  keptIds,
  onDone,
}: {
  instance: `0x${string}`
  decimals: number
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

  return (
    <details className={styles.reroll}>
      <summary className={styles.rerollSummary} data-testid="erc404-reroll-disclosure">
        Advanced · reroll pieces
      </summary>

      <div className={styles.rerollBody}>
        <p className={styles.hint}>
          Re-rolls the NFT ids for the token amount below, keeping the <b>{keptIds.length}</b> piece
          {keptIds.length === 1 ? '' : 's'} you selected above
          {keptIds.length > 0 && <> (#{keptIds.map((id) => id.toString()).join(', #')})</>}.
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
            if (amount === undefined) return
            setSkip.reset()
            reroll.writeContract({
              address: instance,
              chainId: chainId,
              args: [amount, keptIds],
            })
          }}
          disabled={rerollBusy || amount === undefined}
          data-testid="erc404-reroll"
        >
          {reroll.isPending ? 'confirm in wallet…' : rerollRx.isLoading ? 'rerolling…' : 'reroll'}
        </button>

        {reason && <p className={`${styles.note} ${styles.err}`}>reroll failed: {reason}</p>}
      </div>
    </details>
  )
}
