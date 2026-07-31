/**
 * FreeMintClaimPanel — lets an eligible wallet claim its zero-cost free-mint allocation.
 * Renders nothing unless the instance has a free-mint allocation and the connected wallet has not
 * already claimed. When the free-mint path is gated (module set AND scope != PAID_ONLY, noesis-080) we
 * resolve the connected wallet's merkle proof against the owner-configured allowlist and encode it;
 * otherwise we pass '0x'.
 *
 * Write idiom matches EditionList.tsx exactly (useWrite + useWaitForTransactionReceipt,
 * chainId, chainId on every call, btn classes, txStatus UX).
 */
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc1155InstanceFreeMintAllocation,
  useReadErc1155InstanceFreeMintClaimed,
  useReadErc1155InstanceFreeMintsClaimed,
  useReadErc1155InstanceGatingModule,
  useReadErc1155InstanceGatingScope,
  useWriteErc1155InstanceClaimFreeMint,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { encodeMerkleGatingData, isFreeMintGated } from './gatingMint'
import { useMerkleAllowlistProof } from './useMerkleAllowlist'
import styles from './Erc1155Actions.module.css'

interface FreeMintClaimPanelProps {
  instance: `0x${string}`
  /** A free mint is per-edition; claim targets the first edition by convention. */
  editionId: bigint
}

export function FreeMintClaimPanel({ instance, editionId }: FreeMintClaimPanelProps) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()

  const { data: allocation } = useReadErc1155InstanceFreeMintAllocation({
    address: instance,
    chainId: chainId,
  })
  const { data: claimedCount } = useReadErc1155InstanceFreeMintsClaimed({
    address: instance,
    chainId: chainId,
  })
  const { data: hasClaimed, refetch: refetchClaimed } = useReadErc1155InstanceFreeMintClaimed({
    address: instance,
    chainId: chainId,
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: chainId,
  })
  const { data: gatingScope } = useReadErc1155InstanceGatingScope({
    address: instance,
    chainId: chainId,
  })

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    error: writeErrObj,
    reset: resetWrite,
  } = useWriteErc1155InstanceClaimFreeMint()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)

  const gated = isFreeMintGated(gatingModule, gatingScope)
  const allowlist = useMerkleAllowlistProof(instance, editionId, gated)
  const allocationOpen = allocation !== undefined && allocation > 0n
  const exhausted = allocationOpen && claimedCount !== undefined && claimedCount >= allocation
  // Base eligibility (ignoring the merkle proof) — controls whether the panel renders at all, so a
  // gated pool with an unclaimed allocation still shows (with a not-allowlisted state) rather than
  // vanishing. `canSubmit` additionally requires a resolved proof when gated.
  const baseEligible = isConnected && allocationOpen && !exhausted && hasClaimed === false
  const canSubmit = baseEligible && (!gated || allowlist.status === 'eligible')

  function handleClaim(): void {
    // Free-mint gating ('bytes' arg): the module decodes
    // abi.decode(data,(uint256 tierId, uint256 maxQty, bytes32[] proof)); pass '0x' when open (module
    // isn't consulted). A gated claim with no resolved proof must not fire.
    if (gated && (allowlist.status !== 'eligible' || allowlist.proof === undefined)) return
    const gatingData =
      gated && allowlist.proof !== undefined
        ? encodeMerkleGatingData(0n, allowlist.maxQty ?? 0n, allowlist.proof)
        : '0x'
    writeContract({
      address: instance,
      chainId: chainId,
      args: [editionId, gatingData],
    })
  }

  function handleReset(): void {
    resetWrite()
    void refetchClaimed()
  }

  // Hide entirely when not eligible (and not mid/post a successful claim of our own).
  if (!baseEligible && !isSuccess) return null

  if (isSuccess) {
    return (
      <div className={styles.panel} data-testid="erc1155-freemint">
        <p className={styles.label}>FREE MINT</p>
        <p className={styles.txStatus}>free mint claimed — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleReset}>
          done
        </button>
      </div>
    )
  }

  const isBusy = sigPending || isConfirming

  return (
    <div className={styles.panel} data-testid="erc1155-freemint">
      <p className={styles.label}>FREE MINT</p>
      <p className={styles.context}>
        Open free-mint pool — first come, first served
        {allocation !== undefined &&
          claimedCount !== undefined &&
          ` · ${claimedCount.toString()}/${allocation.toString()} claimed`}
      </p>
      {gated && (
        <p className={styles.context} data-testid="erc1155-freemint-allowlist-status">
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
        data-testid="erc1155-freemint-claim"
      >
        {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'claim free mint'}
      </button>
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>
          {failureReason ?? 'claim failed — try again'}
        </p>
      )}
    </div>
  )
}
