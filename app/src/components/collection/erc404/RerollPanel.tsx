/**
 * Reroll — the first-class replacement for legacy's `transferTokensToSelf` self-transfer hack.
 *
 * `rerollSelectedNFTs(tokenAmount, exemptedNFTIds[])` re-rolls the random NFT id assignment for the
 * caller's tokens, EXEMPTING the ids the user lists (those are escrowed and returned untouched).
 * `setSkipNFT(bool)` toggles whether the wallet materializes NFTs at all (DN404 skip flag), read via
 * `getSkipNFT(owner)`.
 *
 * NFT-id entry is manual (comma-separated): DN404Mirror exposes no cheap on-chain owner-enumeration,
 * so rather than stub a fake token list we let the user paste the ids they want to keep. A future
 * indexer/Transfer-log scan can replace the text input with a selectable owned-NFT grid.
 */
import { useState } from 'react'
import { parseUnits } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc404BondingInstanceGetSkipNft,
  useWriteErc404BondingInstanceRerollSelectedNfTs,
  useWriteErc404BondingInstanceSetSkipNft,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import styles from './BondingSurface.module.css'

interface RerollPanelProps {
  instance: `0x${string}`
  decimals: number
  refetch: () => void
}

/** Parse a comma/space-separated id list into a deduped sorted bigint[]. Invalid tokens dropped. */
function parseNftIds(raw: string): bigint[] {
  const seen = new Set<string>()
  const out: bigint[] = []
  for (const tok of raw.split(/[\s,]+/)) {
    const t = tok.trim()
    if (t === '') continue
    if (!/^\d+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(BigInt(t))
  }
  return out
}

export function RerollPanel({ instance, decimals, refetch }: RerollPanelProps) {
  const { address, isConnected } = useAccount()
  const [amountStr, setAmountStr] = useState('')
  const [exemptStr, setExemptStr] = useState('')

  const skipNft = useReadErc404BondingInstanceGetSkipNft({
    address: instance,
    chainId: forkChainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const setSkip = useWriteErc404BondingInstanceSetSkipNft()
  const reroll = useWriteErc404BondingInstanceRerollSelectedNfTs()

  const setSkipWait = useWaitForTransactionReceipt({ hash: setSkip.data })
  const rerollWait = useWaitForTransactionReceipt({ hash: reroll.data })

  if (!isConnected) return null

  let amount: bigint | undefined
  try {
    amount = amountStr.trim() === '' ? undefined : parseUnits(amountStr.trim(), decimals)
    if (amount !== undefined && amount <= 0n) amount = undefined
  } catch {
    amount = undefined
  }

  function handleToggleSkip(): void {
    setSkip.writeContract({
      address: instance,
      chainId: forkChainId,
      args: [!(skipNft.data ?? false)],
    })
  }

  function handleReroll(): void {
    if (amount === undefined) return
    setSkip.reset()
    reroll.writeContract({
      address: instance,
      chainId: forkChainId,
      args: [amount, parseNftIds(exemptStr)],
    })
  }

  function handleAfterTx(): void {
    void skipNft.refetch()
    setSkip.reset()
    reroll.reset()
    refetch()
  }

  const skipBusy = setSkip.isPending || setSkipWait.isLoading
  const rerollBusy = reroll.isPending || rerollWait.isLoading

  return (
    <div className={styles.panel} data-testid="erc404-reroll-panel">
      <p className={styles.panelTitle}>reroll</p>

      <div className={styles.checkboxRow}>
        <span>skip NFT materialization: {skipNft.data ? 'on' : 'off'}</span>
        <button
          className="btn btn-secondary"
          onClick={handleToggleSkip}
          disabled={skipBusy}
          data-testid="erc404-setskipnft"
        >
          {skipBusy ? '…' : skipNft.data ? 'turn off' : 'turn on'}
        </button>
      </div>
      {setSkipWait.isSuccess && (
        <button className="btn btn-secondary" onClick={handleAfterTx}>
          refresh
        </button>
      )}

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
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-reroll-exempt">
          NFT ids to keep (comma-separated)
        </label>
        <input
          id="erc404-reroll-exempt"
          className={styles.input}
          type="text"
          value={exemptStr}
          onChange={(e) => setExemptStr(e.target.value)}
          placeholder="e.g. 12, 45"
          disabled={rerollBusy}
        />
      </div>

      {rerollWait.isSuccess ? (
        <>
          <p className={styles.txStatus}>reroll confirmed.</p>
          <button className="btn btn-secondary" onClick={handleAfterTx}>
            reset
          </button>
        </>
      ) : (
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleReroll}
          disabled={rerollBusy || amount === undefined}
          data-testid="erc404-reroll"
        >
          {reroll.isPending
            ? 'confirm in wallet…'
            : rerollWait.isLoading
              ? 'confirming…'
              : 'reroll'}
        </button>
      )}

      {(setSkip.isError || reroll.isError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed — try again</p>
      )}
    </div>
  )
}
