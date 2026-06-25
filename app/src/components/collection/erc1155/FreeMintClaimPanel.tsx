/**
 * FreeMintClaimPanel — lets an eligible wallet claim its zero-cost free-mint allocation.
 * Renders nothing unless the instance has a free-mint allocation, the connected wallet has not
 * already claimed, and the allocation is not exhausted. When the free-mint path is gated (module
 * set AND scope != PAID_ONLY) we resolve a password credential; otherwise we pass '0x'.
 *
 * Write idiom matches EditionList.tsx exactly (useWrite + useWaitForTransactionReceipt,
 * forkChainId, chainId on every call, btn classes, txStatus UX).
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
import { forkChainId } from '../../../lib/addresses'
import { encodeFreeMintGatingData, isFreeMintGated } from './gatingMint'
import styles from './Erc1155Actions.module.css'

interface FreeMintClaimPanelProps {
  instance: `0x${string}`
  /** A free mint is per-edition; claim targets the first edition by convention. */
  editionId: bigint
}

export function FreeMintClaimPanel({ instance, editionId }: FreeMintClaimPanelProps) {
  const { address, isConnected } = useAccount()
  const [password, setPassword] = useState('')

  const { data: allocation } = useReadErc1155InstanceFreeMintAllocation({
    address: instance,
    chainId: forkChainId,
  })
  const { data: claimedCount } = useReadErc1155InstanceFreeMintsClaimed({
    address: instance,
    chainId: forkChainId,
  })
  const { data: hasClaimed, refetch: refetchClaimed } = useReadErc1155InstanceFreeMintClaimed({
    address: instance,
    chainId: forkChainId,
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: forkChainId,
  })
  const { data: gatingScope } = useReadErc1155InstanceGatingScope({
    address: instance,
    chainId: forkChainId,
  })

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    reset: resetWrite,
  } = useWriteErc1155InstanceClaimFreeMint()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const gated = isFreeMintGated(gatingModule, gatingScope)
  const allocationOpen = allocation !== undefined && allocation > 0n
  const exhausted = allocationOpen && claimedCount !== undefined && claimedCount >= allocation
  // Eligible: connected, allocation exists, not exhausted, and this wallet hasn't claimed.
  const eligible = isConnected && allocationOpen && !exhausted && hasClaimed === false

  function handleClaim(): void {
    // Free-mint gating ('bytes' arg): the module decodes (bytes32 passwordHash, uint256 openTime),
    // so encode that pair when gated; pass '0x' when open (module isn't consulted). openTime 0 is
    // correct for password/volume tiers; TIME_BASED free-mint tiers would pass the edition openTime.
    // Merkle resolution is a documented seam in gatingMint.ts.
    const gatingData = gated ? encodeFreeMintGatingData(password) : '0x'
    writeContract({
      address: instance,
      chainId: forkChainId,
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
          reset
        </button>
      </div>
    )
  }

  const isBusy = sigPending || isConfirming

  return (
    <div className={styles.panel} data-testid="erc1155-freemint">
      <p className={styles.label}>FREE MINT</p>
      <p className={styles.context}>
        you have an unclaimed free mint
        {allocation !== undefined &&
          claimedCount !== undefined &&
          ` (${claimedCount.toString()}/${allocation.toString()} claimed)`}
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
        <p className={`${styles.txStatus} ${styles.txError}`}>claim failed — try again</p>
      )}
    </div>
  )
}
