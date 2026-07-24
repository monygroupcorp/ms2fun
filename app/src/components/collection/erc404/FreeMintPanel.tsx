/**
 * Free-mint claim. Shown only when the instance has a free-mint allocation AND the connected wallet
 * hasn't claimed yet; hidden otherwise. `claimFreeMint(gatingData)` — when gating applies to the free
 * tier we pass the password-encoded gatingData, else `0x`.
 */
import { useState } from 'react'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc404BondingInstanceFreeMintAllocation,
  useReadErc404BondingInstanceFreeMintClaimed,
  useWriteErc404BondingInstanceClaimFreeMint,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { EMPTY_BYTES, encodeGatingData, resolveBuyPasswordHash } from './gating'
import styles from './BondingSurface.module.css'

interface FreeMintPanelProps {
  instance: `0x${string}`
  bondingOpenTime: bigint
  gatingActive: boolean
  refetch: () => void
}

export function FreeMintPanel({
  instance,
  bondingOpenTime,
  gatingActive,
  refetch,
}: FreeMintPanelProps) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const [password, setPassword] = useState('')

  const allocation = useReadErc404BondingInstanceFreeMintAllocation({
    address: instance,
    chainId: chainId,
  })
  const claimed = useReadErc404BondingInstanceFreeMintClaimed({
    address: instance,
    chainId: chainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const claim = useWriteErc404BondingInstanceClaimFreeMint()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: claim.data })

  // Hide entirely when there's no allocation, wallet disconnected, or already claimed.
  if (!isConnected) return null
  if (allocation.data === undefined || allocation.data === 0n) return null
  if (claimed.data === true) return null

  function handleClaim(): void {
    // PAID_ONLY scope never gates the free tier; password tiers pass encoded gatingData. When the
    // user supplies no password we still send the open-tier encoding so a time-tier module can read
    // openTime; if no module is active the contract ignores it.
    const gatingData = gatingActive
      ? encodeGatingData(resolveBuyPasswordHash(password), bondingOpenTime)
      : EMPTY_BYTES
    claim.writeContract({ address: instance, chainId: chainId, args: [gatingData] })
  }

  function handleReset(): void {
    claim.reset()
    void claimed.refetch()
    refetch()
  }

  const isBusy = claim.isPending || isConfirming

  if (isSuccess) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelTitle}>free mint</p>
        <p className={styles.txStatus}>claimed — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleReset}>
          reset
        </button>
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="erc404-freemint">
      <p className={styles.panelTitle}>free mint</p>
      <p className={styles.note}>you have an unclaimed free allocation.</p>
      {gatingActive && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="erc404-freemint-password">
            access password
          </label>
          <input
            id="erc404-freemint-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isBusy}
            data-testid="erc404-freemint-password-input"
          />
        </div>
      )}
      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleClaim}
        disabled={isBusy}
        data-testid="erc404-freemint-claim"
      >
        {claim.isPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'claim free mint'}
      </button>
      {claim.isError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>claim failed — try again</p>
      )}
    </div>
  )
}
