/**
 * TreasuryPanel (W-K) — protocol-admin surface for ProtocolTreasuryV1. Shows the ETH balance and
 * revenue-by-source, plus the owner-only treasury actions (withdraw ETH/ERC20/ERC721). Gated on the
 * treasury `owner()`.
 *
 * The DAO revenue-conductor and POL-instance concepts were retired on-chain (the getters were deleted
 * and their storage moved to `deprecated_*` slots in ProtocolTreasuryV1), so the conductor/POL reads
 * and the set-revenue-conductor action were removed here (noesis-083 bindings reconciliation).
 *
 * Built on the Phase-0 primitives (useOwnerGate + AdminSection/ActionRow + useTxAction/TxButton +
 * AmountField/parseAmount), so it matches the other admin panels.
 */
import { useState } from 'react'
import { formatEther, isAddress } from 'viem'
import { useReadContracts } from 'wagmi'
import {
  protocolTreasuryV1Abi,
  useReadProtocolTreasuryV1GetBalance,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { AmountField } from '../ui/AmountField'
import { parseAmount } from '../ui/parseAmount'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import { useOwnerGate } from '../ui/useOwnerGate'
import styles from './TreasuryPanel.module.css'

const TREASURY = forkAddresses.ProtocolTreasuryV1
const SOURCES = ['bonding fee', 'creation fee', 'queue revenue', 'other', 'POL fees'] as const

export function TreasuryPanel() {
  const { isOwner } = useOwnerGate(TREASURY)
  if (!isOwner) return null
  return (
    <AdminSection title="treasury" testId="admin-treasury">
      <RevenueReadout />
      <WithdrawEthRow />
      <WithdrawErc20Row />
      <WithdrawErc721Row />
    </AdminSection>
  )
}

// ── Read-only revenue/balance overview ───────────────────────────────────────

function RevenueReadout() {
  const { data: balance } = useReadProtocolTreasuryV1GetBalance({
    address: TREASURY,
    chainId: forkChainId,
  })
  // One multicall for all five revenue sources → (received, withdrawn).
  const { data: revenue } = useReadContracts({
    contracts: SOURCES.map((_, i) => ({
      address: TREASURY,
      abi: protocolTreasuryV1Abi,
      functionName: 'getRevenueBySource' as const,
      args: [i] as const,
      chainId: forkChainId,
    })),
  })

  return (
    <div className={styles.readout} data-testid="admin-treasury-readout">
      <div className={styles.statRow}>
        <span className={styles.statLabel}>ETH balance</span>
        <span className={styles.statValue}>
          {balance !== undefined ? `${formatEther(balance)} ETH` : '…'}
        </span>
      </div>
      <div className={styles.revenueTable}>
        <span className={styles.revenueHead}>revenue by source — received / withdrawn</span>
        {SOURCES.map((label, i) => {
          const r = revenue?.[i]
          const ok = r?.status === 'success'
          const [received, withdrawn] = ok ? (r.result as readonly [bigint, bigint]) : [0n, 0n]
          return (
            <div key={label} className={styles.statRow}>
              <span className={styles.statLabel}>{label}</span>
              <span className={styles.statValue}>
                {ok ? `${formatEther(received)} / ${formatEther(withdrawn)}` : '…'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Withdraw ETH ─────────────────────────────────────────────────────────────

function WithdrawEthRow() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const tx = useTxAction()
  const wei = parseAmount(amount, 18)
  const valid = isAddress(to.trim()) && wei !== undefined && wei > 0n

  return (
    <ActionRow label="withdraw ETH" hint="send treasury ETH to an address">
      {tx.state !== 'success' && (
        <>
          <input
            className={styles.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x… recipient"
            aria-label="ETH recipient"
            disabled={tx.isBusy}
          />
          <AmountField
            value={amount}
            onChange={setAmount}
            placeholder="amount"
            unit="ETH"
            ariaLabel="ETH amount"
            disabled={tx.isBusy}
          />
        </>
      )}
      <TxButton
        state={tx.state}
        onClick={() =>
          valid &&
          tx.send({
            address: TREASURY,
            abi: protocolTreasuryV1Abi,
            functionName: 'withdrawETH',
            args: [to.trim() as `0x${string}`, wei],
            chainId: forkChainId,
          })
        }
        label="withdraw ETH"
        successLabel="withdrawn — confirmed."
        onReset={tx.reset}
        disabled={!valid}
        testId="admin-treasury-withdraw-eth"
      />
    </ActionRow>
  )
}

// ── Withdraw ERC20 ───────────────────────────────────────────────────────────

function WithdrawErc20Row() {
  const [token, setToken] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const tx = useTxAction()
  // ERC20 decimals are unknown here — take a raw base-units integer.
  const amt = /^\d+$/.test(amount.trim()) ? BigInt(amount.trim()) : undefined
  const valid = isAddress(token.trim()) && isAddress(to.trim()) && amt !== undefined && amt > 0n

  return (
    <ActionRow label="withdraw ERC20" hint="amount in the token's base units (no decimals applied)">
      {tx.state !== 'success' && (
        <>
          <input
            className={styles.input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="0x… token"
            aria-label="ERC20 token"
            disabled={tx.isBusy}
          />
          <input
            className={styles.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x… recipient"
            aria-label="ERC20 recipient"
            disabled={tx.isBusy}
          />
          <input
            className={styles.input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="amount (base units)"
            inputMode="numeric"
            aria-label="ERC20 amount"
            disabled={tx.isBusy}
          />
        </>
      )}
      <TxButton
        state={tx.state}
        onClick={() =>
          valid &&
          tx.send({
            address: TREASURY,
            abi: protocolTreasuryV1Abi,
            functionName: 'withdrawERC20',
            args: [token.trim() as `0x${string}`, to.trim() as `0x${string}`, amt],
            chainId: forkChainId,
          })
        }
        label="withdraw ERC20"
        successLabel="withdrawn — confirmed."
        onReset={tx.reset}
        disabled={!valid}
        className="btn btn-secondary"
        testId="admin-treasury-withdraw-erc20"
      />
    </ActionRow>
  )
}

// ── Withdraw ERC721 ──────────────────────────────────────────────────────────

function WithdrawErc721Row() {
  const [token, setToken] = useState('')
  const [to, setTo] = useState('')
  const [tokenId, setTokenId] = useState('')
  const tx = useTxAction()
  const id = /^\d+$/.test(tokenId.trim()) ? BigInt(tokenId.trim()) : undefined
  const valid = isAddress(token.trim()) && isAddress(to.trim()) && id !== undefined

  return (
    <ActionRow label="withdraw ERC721" hint="rescue a treasury-held NFT (e.g. a V4 position)">
      {tx.state !== 'success' && (
        <>
          <input
            className={styles.input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="0x… token"
            aria-label="ERC721 token"
            disabled={tx.isBusy}
          />
          <input
            className={styles.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x… recipient"
            aria-label="ERC721 recipient"
            disabled={tx.isBusy}
          />
          <input
            className={styles.input}
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="token id"
            inputMode="numeric"
            aria-label="ERC721 token id"
            disabled={tx.isBusy}
          />
        </>
      )}
      <TxButton
        state={tx.state}
        onClick={() =>
          valid &&
          tx.send({
            address: TREASURY,
            abi: protocolTreasuryV1Abi,
            functionName: 'withdrawERC721',
            args: [token.trim() as `0x${string}`, to.trim() as `0x${string}`, id],
            chainId: forkChainId,
          })
        }
        label="withdraw ERC721"
        successLabel="withdrawn — confirmed."
        onReset={tx.reset}
        disabled={!valid}
        className="btn btn-secondary"
        testId="admin-treasury-withdraw-erc721"
      />
    </ActionRow>
  )
}
