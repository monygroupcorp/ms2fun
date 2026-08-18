/**
 * Free-mint claim. Shown only when the instance has a free-mint allocation AND the connected wallet
 * hasn't claimed yet; hidden otherwise. `claimFreeMint(gatingData)` — when gating applies to the free
 * tier (noesis-080: the only deployed gating module is MerkleGatingModule) we resolve the connected
 * wallet's merkle proof and pass the encoded gatingData, else `0x`.
 */
import { useEffect, useRef } from 'react'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import {
  useReadErc404BondingInstanceFreeMintAllocation,
  useReadErc404BondingInstanceFreeMintClaimed,
  useWriteErc404BondingInstanceClaimFreeMint,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { invalidateInstanceQueries } from '../../ui/useTxAction'
import { EMPTY_BYTES, encodeMerkleGatingData } from './gating'
import { useMerkleAllowlistProof } from './useMerkleAllowlist'
import styles from './BondingSurface.module.css'

interface FreeMintPanelProps {
  instance: `0x${string}`
  bondingOpenTime: bigint
  gatingActive: boolean
  refetch: () => void
}

export function FreeMintPanel({ instance, gatingActive, refetch }: FreeMintPanelProps) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const allowlist = useMerkleAllowlistProof(instance, gatingActive)

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

  // Shared invalidation (noesis-352): a free-mint claim moves coin balance AND NFT ids in the same
  // transaction, so every cached read for this instance — not just this panel's own — must
  // invalidate the moment the receipt lands, not only when the holder clicks "reset". See
  // useTxAction's `instance` opt for the rationale.
  const queryClient = useQueryClient()
  const invalidatedOnSuccess = useRef(false)
  useEffect(() => {
    if (isSuccess && !invalidatedOnSuccess.current) {
      invalidatedOnSuccess.current = true
      invalidateInstanceQueries(queryClient, instance)
    }
    if (!isSuccess) invalidatedOnSuccess.current = false
  }, [isSuccess, queryClient, instance])

  // Hide entirely when there's no allocation, wallet disconnected, or already claimed.
  if (!isConnected) return null
  if (allocation.data === undefined || allocation.data === 0n) return null
  if (claimed.data === true) return null

  const canSubmit = !gatingActive || allowlist.status === 'eligible'

  function handleClaim(): void {
    // PAID_ONLY scope never gates the free tier. When gated, the module decodes
    // abi.decode(data,(uint256 tierId, uint256 maxQty, bytes32[] proof)) — a gated claim with no
    // resolved proof must not fire.
    if (gatingActive && (allowlist.status !== 'eligible' || allowlist.proof === undefined)) return
    const gatingData =
      gatingActive && allowlist.proof !== undefined
        ? encodeMerkleGatingData(0n, allowlist.maxQty ?? 0n, allowlist.proof)
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
        <p className={styles.field} data-testid="erc404-freemint-allowlist-status">
          {allowlist.status === 'loading' && 'checking allowlist…'}
          {allowlist.status === 'no-list' && 'allowlist not yet configured by the creator'}
          {allowlist.status === 'not-eligible' && 'this wallet is not on the allowlist'}
          {allowlist.status === 'eligible' &&
            `allowlisted — up to ${allowlist.maxQty?.toString() ?? '0'} per wallet`}
        </p>
      )}
      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleClaim}
        disabled={isBusy || !canSubmit}
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
