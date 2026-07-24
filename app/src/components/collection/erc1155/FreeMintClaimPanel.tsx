/**
 * FreeMintClaimPanel — lets an eligible wallet claim its zero-cost free-mint allocation.
 * Renders nothing unless the instance has a free-mint allocation, the connected wallet has not
 * already claimed, and the allocation is not exhausted. When the free-mint path is gated (module
 * set AND scope != PAID_ONLY) we resolve a password credential; otherwise we pass '0x'.
 *
 * Write idiom matches EditionList.tsx exactly (useWrite + useWaitForTransactionReceipt,
 * chainId, chainId on every call, btn classes, txStatus UX).
 */
import { useState } from 'react'
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
import { encodePasswordGatingData, isFreeMintGated } from './gatingMint'
import styles from './Erc1155Actions.module.css'

interface FreeMintClaimPanelProps {
  instance: `0x${string}`
  /** A free mint is per-edition; claim targets the first edition by convention. */
  editionId: bigint
}

export function FreeMintClaimPanel({ instance, editionId }: FreeMintClaimPanelProps) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const [password, setPassword] = useState('')

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
  const allocationOpen = allocation !== undefined && allocation > 0n
  const exhausted = allocationOpen && claimedCount !== undefined && claimedCount >= allocation
  // Eligible: connected, allocation exists, not exhausted, and this wallet hasn't claimed.
  const eligible = isConnected && allocationOpen && !exhausted && hasClaimed === false

  function handleClaim(): void {
    // Free-mint gating ('bytes' arg): post-#25 the module decodes abi.decode(data,(bytes32
    // passwordHash)) — openTime is now an authoritative canMint param (edition.openTime), not part of
    // data. So encode just the hash when gated; pass '0x' when open (module isn't consulted).
    // Merkle resolution is a documented seam in gatingMint.ts.
    const gatingData = gated ? encodePasswordGatingData(password) : '0x'
    writeContract({
      address: instance,
      chainId: chainId,
      args: [editionId, gatingData],
    })
  }

  function handleReset(): void {
    resetWrite()
    setPassword('')
    void refetchClaimed()
  }

  // Hide entirely when not eligible (and not mid/post a successful claim of our own).
  if (!eligible && !isSuccess) return null

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
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="access password"
          disabled={isBusy}
          aria-label="free mint access password"
        />
      )}
      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleClaim}
        disabled={isBusy}
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
