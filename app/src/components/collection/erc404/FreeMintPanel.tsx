/**
 * Free-mint claim. Shown only when the instance has a free-mint allocation AND the connected wallet
 * hasn't claimed yet; hidden otherwise. `claimFreeMint(gatingData)` — when gating applies to the free
 * tier (noesis-080: the only deployed gating module is MerkleGatingModule) we resolve the connected
 * wallet's merkle proof and pass the encoded gatingData, else `0x`.
 *
 * Two of `claimFreeMint`'s three reverts used to be invisible here. `ERC404BondingOps.claimFreeMint`
 * refuses before the curve opens (`TooEarly`, and `BondingNotConfigured` while the open time is
 * still unset) and once the shared pool runs out (`FreeMintExhausted`), and this panel read neither
 * clock nor counter: it took `bondingOpenTime` as a prop and never looked at it, and it read only
 * the caller's own `freeMintClaimed` flag, never `freeMintsClaimed` against the allocation. So a
 * visitor was told "you have an unclaimed free allocation" beside an enabled button in both states
 * — true of their wallet, false of the chain, and a wasted transaction either way.
 *
 * Both are now read and rendered, so the panel offers the claim only where the contract would take
 * it, and says which of the two is in the way where it would not.
 */
import { useEffect, useRef } from 'react'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import {
  useReadErc404BondingInstanceFreeMintAllocation,
  useReadErc404BondingInstanceFreeMintClaimed,
  useReadErc404BondingInstanceFreeMintsClaimed,
  useWriteErc404BondingInstanceClaimFreeMint,
} from '../../../generated/contracts'
import { formatOpenTime } from './bondingFormat'
import { useNowSec } from './useNowSec'
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

export function FreeMintPanel({
  instance,
  bondingOpenTime,
  gatingActive,
  refetch,
}: FreeMintPanelProps) {
  const chainId = useCollectionChainId()
  const nowSec = useNowSec()
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
  // The pool is shared across wallets, so `claimed` above (this wallet's flag) says nothing about
  // whether anything is left to claim. `freeMintsClaimed` is the running NFT counter the contract
  // compares against `freeMintAllocation` before it will mint.
  const poolClaimed = useReadErc404BondingInstanceFreeMintsClaimed({
    address: instance,
    chainId: chainId,
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

  // The three states `claimFreeMint` refuses in, named so the panel can say which one applies.
  // `bondingOpenTime === 0n` is the unconfigured case (`BondingNotConfigured`); it is not "open at
  // the unix epoch", so it must not fall through the `nowSec >= openTime` comparison as open.
  const isUnconfigured = bondingOpenTime === 0n
  const isBeforeOpen = !isUnconfigured && nowSec < bondingOpenTime
  const isExhausted =
    poolClaimed.data !== undefined &&
    allocation.data !== undefined &&
    poolClaimed.data >= allocation.data

  const canSubmit =
    !isUnconfigured &&
    !isBeforeOpen &&
    !isExhausted &&
    (!gatingActive || allowlist.status === 'eligible')

  function handleClaim(): void {
    // Belt and braces beside the disabled button, exactly as the gating guard below is: a claim the
    // contract would refuse must not be signable, and `disabled` is a property of one rendered
    // button rather than of the action.
    if (!canSubmit) return
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
      {isExhausted ? (
        <p className={styles.note} data-testid="erc404-freemint-exhausted">
          claimed out — the free allocation of {allocation.data?.toString() ?? '0'} has all been
          claimed. Nothing is reserved for this wallet.
        </p>
      ) : (
        <p className={styles.note}>you have an unclaimed free allocation.</p>
      )}
      {isUnconfigured && (
        <p className={styles.field} data-testid="erc404-freemint-unconfigured">
          claims open once the creator sets the bonding open time — no date is set yet.
        </p>
      )}
      {isBeforeOpen && (
        <p className={styles.field} data-testid="erc404-freemint-preopen">
          claims open at {formatOpenTime(bondingOpenTime)} — not yet claimable.
        </p>
      )}
      {gatingActive && (
        <p className={styles.field} data-testid="erc404-freemint-allowlist-status">
          {allowlist.status === 'loading' && 'checking allowlist…'}
          {allowlist.status === 'no-list' && 'allowlist not yet configured by the creator'}
          {allowlist.status === 'not-eligible' && 'this wallet is not on the allowlist'}
          {allowlist.status === 'eligible' &&
            `allowlisted — up to ${allowlist.maxQtyNfts?.toString() ?? '0'} NFTs per wallet`}
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
