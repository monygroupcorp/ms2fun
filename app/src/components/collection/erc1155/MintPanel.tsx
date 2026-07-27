/**
 * MintPanel — the per-edition ERC1155 mint control: live cost (calculateMintCost), the paid `mint`
 * write with real gating credential + optional message, and tx-status UX. Extracted from EditionList
 * (W-D1) so both the inline edition list AND the standalone edition detail page reuse one mint flow.
 */
import { useState } from 'react'
import { formatEther } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadErc1155InstanceCalculateMintCost,
  useReadErc1155InstanceGatingModule,
  useReadErc1155InstanceGatingScope,
  useWriteErc1155InstanceMint,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { encodeMintMessage, encodePasswordGatingData, isPaidMintGated } from './gatingMint'
import type { EditionView } from '../useEditions'
import styles from '../EditionList.module.css'

export interface MintPanelProps {
  instance: `0x${string}`
  edition: EditionView
  refetch: () => void
}

export function MintPanel({ instance, edition, refetch }: MintPanelProps) {
  const chainId = useCollectionChainId()
  const { isConnected } = useAccount()
  const [amount, setAmount] = useState(1)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const { data: costData, isPending: costPending } = useReadErc1155InstanceCalculateMintCost({
    address: instance,
    chainId: chainId,
    args: [edition.id, BigInt(amount)],
    query: { enabled: amount > 0 },
  })

  // Gating config for the paid mint path. When a module is set and scope isn't FREE_MINT_ONLY,
  // `mint` consults the module — we then encode the user's password credential as `bytes`
  // (see erc1155/gatingMint.ts for the approach + the merkle seam). Otherwise gatingData = '0x'.
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: chainId,
  })
  const { data: gatingScope } = useReadErc1155InstanceGatingScope({
    address: instance,
    chainId: chainId,
  })
  const gated = isPaidMintGated(gatingModule, gatingScope)

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    error: writeErrObj,
    reset: resetWrite,
  } = useWriteErc1155InstanceMint()

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)

  function handleMint(): void {
    if (costData === undefined) return
    // `bytes` gatingData when the paid path is gated (abi.encode(keccak256(password))); the merged
    // `mint(bytes gatingData)` forwards it to the module's abi.decode(data,(bytes32)). '0x' when open
    // (module isn't consulted; an empty blob avoids a spurious abi.decode).
    const gatingData = gated ? encodePasswordGatingData(password) : '0x'
    // Optional attached message, ABI-encoded to the registry's 5-field convention (else '0x').
    const messageData = encodeMintMessage(message)
    writeContract({
      address: instance,
      chainId: chainId,
      args: [edition.id, BigInt(amount), gatingData, messageData, costData],
      value: costData,
    })
  }

  function handleSuccess(): void {
    resetWrite()
    setAmount(1)
    setPassword('')
    setMessage('')
    refetch()
  }

  const cost = costData !== undefined ? formatEther(costData) : null
  const isBusy = sigPending || isConfirming

  if (!isConnected) {
    return (
      <div className={styles.mintPanel}>
        <p className={styles.connectNote}>connect wallet to mint</p>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className={styles.mintPanel}>
        <p className={styles.txStatus}>minted — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleSuccess}>
          mint again
        </button>
      </div>
    )
  }

  return (
    <div className={styles.mintPanel}>
      <div className={styles.mintRow}>
        <input
          className={styles.amountInput}
          type="number"
          min={1}
          value={amount}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= 1) setAmount(v)
          }}
          disabled={isBusy}
          aria-label="mint amount"
        />
        <span className={styles.costLabel}>
          cost:{' '}
          <span className={styles.costValue}>
            {costPending ? '…' : cost !== null ? `${cost} ETH` : '—'}
          </span>
        </span>
        <button
          className={styles.mintBtn}
          onClick={handleMint}
          disabled={isBusy || costData === undefined}
        >
          {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'mint'}
        </button>
      </div>
      {gated && (
        <input
          className={styles.mintInput}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="access password (gated sale)"
          disabled={isBusy}
          aria-label="mint access password"
          data-testid="erc1155-mint-password"
        />
      )}
      <textarea
        className={styles.mintMessage}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="attach a message (optional)"
        rows={2}
        disabled={isBusy}
        aria-label="optional mint message"
        data-testid="erc1155-mint-message"
      />
      {(writeError || waitError) && (
        <p className={`${styles.txStatus} ${styles.txError}`}>
          {failureReason ?? 'transaction failed — try again'}
        </p>
      )}
    </div>
  )
}
