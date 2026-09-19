/**
 * MintPanel — the per-edition ERC1155 mint control: live cost (calculateMintCost), the paid `mint`
 * write with real gating credential + optional message, and tx-status UX. Extracted from EditionList
 * (W-D1) so both the inline edition list AND the standalone edition detail page reuse one mint flow.
 */
import { useMemo, useState } from 'react'
import { decodeEventLog, formatEther, type Log } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  erc1155InstanceAbi,
  useReadErc1155InstanceCalculateMintCost,
  useReadErc1155InstanceEditionMintedBy,
  useReadErc1155InstanceGatingModule,
  useReadErc1155InstanceGatingScope,
  useWriteErc1155InstanceMint,
} from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { formatReceipt } from '../../ui/receipt'
import { encodeMerkleGatingData, encodeMintMessage, isPaidMintGated } from './gatingMint'
import { isClosed, remainingForWallet, timeRemaining } from './editionSchedule'
import { useMerkleAllowlistProof } from './useMerkleAllowlist'
import type { EditionView } from '../useEditions'
import styles from '../EditionList.module.css'

export interface MintPanelProps {
  instance: `0x${string}`
  edition: EditionView
  refetch: () => void
}

// Reads `Minted(to, editionId, amount, totalCost)` off the confirmed tx receipt — the authoritative
// figure the chain actually settled on. `mint` refunds `msg.value - totalCost` on an overpay
// (`ERC1155Instance.sol`), so the wei sent at click time can exceed what was actually paid; a re-quote
// of `value` would overstate the confirmation whenever that refund fires.
function mintReceiptFromLogs(logs: readonly Log[]): bigint | undefined {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: erc1155InstanceAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'Minted') return decoded.args.totalCost
    } catch {
      // Not a Minted log (a different event, or a log from another contract in the same tx) —
      // decodeEventLog throws on a topic0 mismatch; skip it and keep scanning.
    }
  }
  return undefined
}

export function MintPanel({ instance, edition, refetch }: MintPanelProps) {
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const [amount, setAmount] = useState(1)
  const [message, setMessage] = useState('')

  // What this wallet has already minted of this edition, for the per-wallet ceiling. Only read when
  // the edition sets one — an edition with no ceiling asks the chain nothing extra.
  const { data: mintedByWallet } = useReadErc1155InstanceEditionMintedBy({
    address: instance,
    chainId: chainId,
    args: address ? [edition.id, address] : undefined,
    query: { enabled: !!address && edition.maxPerWallet > 0n },
  })

  const { data: costData, isPending: costPending } = useReadErc1155InstanceCalculateMintCost({
    address: instance,
    chainId: chainId,
    args: [edition.id, BigInt(amount)],
    query: { enabled: amount > 0 },
  })

  // Gating config for the paid mint path. When a module is set and scope isn't FREE_MINT_ONLY, `mint`
  // consults the module — today the ONLY deployed gating module is MerkleGatingModule (PasswordTier
  // was dropped, noesis-065), so `gated` means "resolve a merkle proof", not "ask for a password".
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: chainId,
  })
  const { data: gatingScope } = useReadErc1155InstanceGatingScope({
    address: instance,
    chainId: chainId,
  })
  const gated = isPaidMintGated(gatingModule, gatingScope)
  const allowlist = useMerkleAllowlistProof(instance, edition.id, gated)

  // The leaf cap is a lifetime number; `allowlist.remainingNfts` is what this wallet may still mint
  // (noesis-280). Undefined means the counter did not read — block rather than assume the cap.
  const overRemaining =
    allowlist.remainingNfts === undefined || BigInt(amount) > allowlist.remainingNfts

  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    isError: writeError,
    error: writeErrObj,
    reset: resetWrite,
  } = useWriteErc1155InstanceMint()

  const {
    data: receiptData,
    isLoading: isConfirming,
    isSuccess,
    isError: waitError,
    error: waitErrObj,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const paidWei = useMemo(
    () => (receiptData !== undefined ? mintReceiptFromLogs(receiptData.logs) : undefined),
    [receiptData],
  )

  const failureReason = txErrorReason(writeErrObj ?? waitErrObj)

  function handleMint(): void {
    if (costData === undefined) return
    // `bytes` gatingData when the paid path is gated: the merged `mint(bytes gatingData)` forwards it
    // to MerkleGatingModule's abi.decode(data,(uint256,uint256,bytes32[])). '0x' when open (module
    // isn't consulted; an empty blob avoids a spurious abi.decode). A gated mint with no resolved proof
    // must not fire — the button stays disabled until `allowlist.status === 'eligible'`.
    if (gated && (allowlist.status !== 'eligible' || allowlist.proof === undefined)) return
    // Nor above what this wallet has left: the module compares `claimed + amount` against the leaf
    // cap and reverts `QtyCapExceeded`, which reaches the user as a generic failure AFTER they have
    // paid gas. Same condition as the button's `overRemaining`, repeated so the write is unreachable
    // rather than merely un-clickable.
    if (gated && overRemaining) return
    const gatingData =
      gated && allowlist.proof !== undefined
        ? encodeMerkleGatingData(0n, allowlist.maxQty ?? 0n, allowlist.proof)
        : '0x'
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
    setMessage('')
    refetch()
  }

  const cost = costData !== undefined ? formatEther(costData) : null
  const isBusy = sigPending || isConfirming
  const gatingBlocksMint = gated && (allowlist.status !== 'eligible' || overRemaining)
  // `openTime === 0` means open immediately (ERC1155Instance.sol); a nonzero value gates every
  // mint path — paid and free — until that timestamp, and the contract reverts EditionNotOpen()
  // rather than degrading, so the button must not be clickable before then.
  const opensAt = edition.openTime > 0n ? new Date(Number(edition.openTime) * 1000) : null
  const notYetOpen = opensAt !== null && Date.now() < opensAt.getTime()
  // The close time is the same gate on the far side: past it the contract reverts EditionClosed()
  // on both mint paths, so the button must not be clickable and the panel says the drop is over
  // rather than leaving a collector to find out from a failed transaction.
  const closed = isClosed(edition)
  const remaining = timeRemaining(edition)
  const closesAtDate = edition.closeTime > 0n ? new Date(Number(edition.closeTime) * 1000) : null
  // What this wallet may still take, when the edition sets a ceiling. `editionMintedBy` counts what
  // the wallet MINTED — paid and free together — so it does not move when tokens are sent on.
  const walletRemaining = remainingForWallet(edition, mintedByWallet)
  const overWalletLimit = walletRemaining !== null && BigInt(amount) > walletRemaining

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
        <p className={styles.txStatus} data-testid="erc1155-mint-success">
          {paidWei !== undefined
            ? formatReceipt({ verb: 'minted', net: { label: 'paid', wei: paidWei } })
            : 'minted — tx confirmed.'}
        </p>
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
          disabled={
            isBusy ||
            costData === undefined ||
            gatingBlocksMint ||
            notYetOpen ||
            closed ||
            overWalletLimit
          }
        >
          {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'mint'}
        </button>
      </div>
      {notYetOpen && (
        <p className={styles.connectNote} data-testid="erc1155-mint-not-open">
          opens {opensAt.toLocaleString()}
        </p>
      )}
      {closed && (
        <p className={styles.connectNote} data-testid="erc1155-mint-closed">
          this edition is over — it closed {closesAtDate?.toLocaleString()}
        </p>
      )}
      {!closed && remaining !== null && (
        <p className={styles.connectNote} data-testid="erc1155-mint-time-remaining">
          {remaining} — closes {closesAtDate?.toLocaleString()}
        </p>
      )}
      {walletRemaining !== null && (
        <p className={styles.connectNote} data-testid="erc1155-mint-wallet-limit">
          {walletRemaining === 0n
            ? `this wallet has minted its limit of ${edition.maxPerWallet.toString()} for this edition`
            : `${walletRemaining.toString()} of ${edition.maxPerWallet.toString()} left for this wallet`}
        </p>
      )}
      {gated && (
        <p className={styles.mintInput} data-testid="erc1155-mint-allowlist-status">
          {allowlist.status === 'loading' && 'checking allowlist…'}
          {allowlist.status === 'no-list' && 'allowlist not yet configured by the creator'}
          {allowlist.status === 'not-eligible' && 'this wallet is not on the allowlist'}
          {allowlist.status === 'eligible' &&
            (allowlist.remainingNfts === undefined
              ? 'allowlisted — checking what this wallet has already minted…'
              : `allowlisted — ${allowlist.remainingNfts.toString()} of ${allowlist.maxQtyNfts?.toString() ?? '0'} left for this wallet`)}
        </p>
      )}
      {gated && allowlist.status === 'eligible' && overRemaining && (
        <p className={styles.mintInput} data-testid="erc1155-mint-allowlist-over-cap">
          {allowlist.remainingNfts === undefined
            ? 'cannot read this wallet\u2019s claimed count — try again'
            : allowlist.remainingNfts === 0n
              ? 'this wallet has minted its whole allowance'
              : `over the allowance — lower the amount to ${allowlist.remainingNfts.toString()}`}
        </p>
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
