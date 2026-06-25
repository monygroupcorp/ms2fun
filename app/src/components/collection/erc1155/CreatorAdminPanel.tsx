/**
 * CreatorAdminPanel — creator-only management for an ERC1155 instance. Built on the Phase-0 admin
 * primitives (useOwnerGate + AdminSection/ActionRow + useTxAction/TxButton + AmountField/parseAmount)
 * so every admin surface looks and behaves the same; a new action is config, not bespoke wiring.
 *
 * Gated by `useOwnerGate(instance)` (the connected wallet must equal the on-chain `owner()`, which is
 * transferable — so this follows ownership, not the original registry creator). Actions:
 *   - withdraw(amount)              proceeds; default amount = full withdrawable (proceeds − withdrawn)
 *   - claimVaultFees()              sweep this instance's accrued alignment-vault yield
 *   - claimAllFees()              ✦ sweep every fee bucket at once
 *   - updateEditionMetadata(id,uri) replace one edition's metadata URI
 *   - setStyle(uri)               ✦ collection-level style / theme URI
 *   - migrateVault(newVault)      ✦ point the instance at a new alignment vault
 *   - setAgentDelegation(bool)    ✦ toggle agent delegation (reads agentDelegationEnabled for current)
 *   - retryVaultContribution()    ✦ permissionless — re-attempt a failed vault contribution
 * (✦ = added in W-E; all but retry are onlyOwner.)
 *
 * Every write goes through `useTxAction` (one per action) with `erc1155InstanceAbi`, so the
 * idle/signing/confirming/success/error UX is identical across rows.
 */
import { useState } from 'react'
import { formatEther, isAddress } from 'viem'
import {
  erc1155InstanceAbi,
  useReadErc1155InstanceAgentDelegationEnabled,
  useReadErc1155InstanceTotalProceeds,
  useReadErc1155InstanceTotalWithdrawn,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { AmountField } from '../../ui/AmountField'
import { parseAmount } from '../../ui/parseAmount'
import { TxButton } from '../../ui/TxButton'
import { useTxAction } from '../../ui/useTxAction'
import { useOwnerGate } from '../../ui/useOwnerGate'
import { ConfigureGatingRow } from '../ConfigureGatingRow'
import { useEditions, type EditionView } from '../useEditions'
import styles from './Erc1155Actions.module.css'

interface CreatorAdminPanelProps {
  instance: `0x${string}`
}

export function CreatorAdminPanel({ instance }: CreatorAdminPanelProps) {
  const { isOwner } = useOwnerGate(instance)
  const { data: editions, refetch: refetchEditions } = useEditions(instance)

  if (!isOwner) return null

  return (
    <AdminSection title="creator actions" testId="erc1155-admin">
      <WithdrawRow instance={instance} />
      <ClaimFeesRow instance={instance} />
      <ClaimAllFeesRow instance={instance} />
      <UpdateMetadataRow instance={instance} editions={editions} onUpdated={refetchEditions} />
      <SetStyleRow instance={instance} />
      <ConfigureGatingRow instance={instance} />
      <MigrateVaultRow instance={instance} />
      <AgentDelegationRow instance={instance} />
      <RetryVaultRow instance={instance} />
    </AdminSection>
  )
}

// ── Withdraw ─────────────────────────────────────────────────────────────────

function WithdrawRow({ instance }: { instance: `0x${string}` }) {
  const { data: totalProceeds, refetch: refetchProceeds } = useReadErc1155InstanceTotalProceeds({
    address: instance,
    chainId: forkChainId,
  })
  const { data: totalWithdrawn, refetch: refetchWithdrawn } = useReadErc1155InstanceTotalWithdrawn({
    address: instance,
    chainId: forkChainId,
  })

  const withdrawable =
    totalProceeds !== undefined && totalWithdrawn !== undefined
      ? totalProceeds - totalWithdrawn
      : undefined

  const [amount, setAmount] = useState('')
  const tx = useTxAction({
    onSuccess: () => {
      void refetchProceeds()
      void refetchWithdrawn()
    },
  })

  // Empty field = withdraw the full balance; otherwise parse the typed ETH amount.
  const parsed = amount.trim() === '' ? withdrawable : parseAmount(amount)
  const canSubmit = parsed !== undefined && parsed > 0n

  function handleWithdraw(): void {
    if (parsed === undefined || parsed <= 0n) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'withdraw',
      args: [parsed],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    setAmount('')
    void refetchProceeds()
    void refetchWithdrawn()
  }

  const hint =
    withdrawable !== undefined
      ? `withdrawable: ${formatEther(withdrawable)} ETH${
          totalWithdrawn !== undefined ? ` · withdrawn: ${formatEther(totalWithdrawn)} ETH` : ''
        }`
      : 'loading balance…'

  return (
    <ActionRow label="withdraw proceeds" hint={hint}>
      {tx.state !== 'success' && (
        <AmountField
          value={amount}
          onChange={setAmount}
          placeholder={withdrawable !== undefined ? formatEther(withdrawable) : 'amount'}
          disabled={tx.isBusy}
          unit="ETH"
          ariaLabel="withdraw amount in ETH"
        />
      )}
      <TxButton
        state={tx.state}
        onClick={handleWithdraw}
        onReset={handleReset}
        label="withdraw"
        successLabel="withdrawn — tx confirmed."
        disabled={!canSubmit}
        errorText="withdraw failed — try again"
        testId="erc1155-withdraw"
      />
    </ActionRow>
  )
}

// ── Claim vault fees ─────────────────────────────────────────────────────────

function ClaimFeesRow({ instance }: { instance: `0x${string}` }) {
  const tx = useTxAction()

  function handleClaim(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'claimVaultFees',
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow label="claim vault fees" hint="sweep accrued alignment-vault yield to the creator">
      <TxButton
        state={tx.state}
        onClick={handleClaim}
        onReset={tx.reset}
        label="claim fees"
        successLabel="fees claimed — tx confirmed."
        className="btn btn-secondary"
        errorText="claim failed — try again"
        testId="erc1155-claim-fees"
      />
    </ActionRow>
  )
}

// ── Claim all fees ───────────────────────────────────────────────────────────

function ClaimAllFeesRow({ instance }: { instance: `0x${string}` }) {
  const tx = useTxAction()

  function handleClaim(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'claimAllFees',
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow label="claim all fees" hint="sweep every fee bucket in one transaction">
      <TxButton
        state={tx.state}
        onClick={handleClaim}
        onReset={tx.reset}
        label="claim all fees"
        successLabel="all fees claimed — tx confirmed."
        className="btn btn-secondary"
        errorText="claim failed — try again"
        testId="erc1155-claim-all-fees"
      />
    </ActionRow>
  )
}

// ── Update edition metadata ──────────────────────────────────────────────────

function UpdateMetadataRow({
  instance,
  editions,
  onUpdated,
}: {
  instance: `0x${string}`
  editions: readonly EditionView[]
  onUpdated: () => void
}) {
  // Track an explicit selection; fall back to the first edition so the row is usable even when
  // editions finish loading after mount (the useState initializer only runs once).
  const [selectedId, setSelectedId] = useState<string>('')
  const firstEdition = editions[0]
  const editionId =
    selectedId !== '' ? selectedId : firstEdition !== undefined ? firstEdition.id.toString() : ''
  const [uri, setUri] = useState('')
  // Refetch the shared editions query on success so the list + detail page show the new URI at once.
  const tx = useTxAction({ onSuccess: onUpdated })

  const canSubmit = editionId.trim() !== '' && uri.trim() !== '' && !tx.isBusy

  function handleUpdate(): void {
    if (!canSubmit) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'updateEditionMetadata',
      args: [BigInt(editionId), uri.trim()],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    setUri('')
  }

  if (editions.length === 0) return null

  return (
    <ActionRow label="update edition metadata" hint="replace a single edition's metadata URI">
      {tx.state !== 'success' && (
        <>
          <select
            className={styles.input}
            value={editionId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={tx.isBusy}
            aria-label="edition to update"
          >
            {editions.map((ed) => (
              <option key={ed.id.toString()} value={ed.id.toString()}>
                {ed.pieceTitle || `edition #${ed.id}`}
              </option>
            ))}
          </select>
          <input
            className={styles.input}
            type="text"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="ipfs://, ar://, https://, or data:"
            disabled={tx.isBusy}
            aria-label="new metadata URI"
          />
        </>
      )}
      <TxButton
        state={tx.state}
        onClick={handleUpdate}
        onReset={handleReset}
        label="update metadata"
        successLabel="metadata updated — tx confirmed."
        disabled={!canSubmit}
        errorText="update failed — try again"
        testId="erc1155-edit-metadata"
      />
    </ActionRow>
  )
}

// ── Set style ────────────────────────────────────────────────────────────────

function SetStyleRow({ instance }: { instance: `0x${string}` }) {
  const [uri, setUri] = useState('')
  const tx = useTxAction()

  const canSubmit = uri.trim() !== '' && !tx.isBusy

  function handleSet(): void {
    if (!canSubmit) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'setStyle',
      args: [uri.trim()],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    setUri('')
  }

  return (
    <ActionRow label="set style" hint="collection-level style / theme URI">
      {tx.state !== 'success' && (
        <input
          className={styles.input}
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="ipfs://, ar://, https://, or data:"
          disabled={tx.isBusy}
          aria-label="style URI"
        />
      )}
      <TxButton
        state={tx.state}
        onClick={handleSet}
        onReset={handleReset}
        label="set style"
        successLabel="style updated — tx confirmed."
        disabled={!canSubmit}
        errorText="set style failed — try again"
        testId="erc1155-set-style"
      />
    </ActionRow>
  )
}

// ── Migrate vault ────────────────────────────────────────────────────────────

function MigrateVaultRow({ instance }: { instance: `0x${string}` }) {
  const [newVault, setNewVault] = useState('')
  const tx = useTxAction()

  const isValid = isAddress(newVault.trim())
  const canSubmit = isValid && !tx.isBusy

  function handleMigrate(): void {
    if (!isValid) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'migrateVault',
      args: [newVault.trim() as `0x${string}`],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    setNewVault('')
  }

  const hint =
    newVault.trim() !== '' && !isValid
      ? 'enter a valid 0x address'
      : 'point this instance at a new alignment vault'

  return (
    <ActionRow label="migrate vault" hint={hint}>
      {tx.state !== 'success' && (
        <input
          className={styles.input}
          type="text"
          value={newVault}
          onChange={(e) => setNewVault(e.target.value)}
          placeholder="0x… new vault address"
          disabled={tx.isBusy}
          aria-label="new vault address"
        />
      )}
      <TxButton
        state={tx.state}
        onClick={handleMigrate}
        onReset={handleReset}
        label="migrate vault"
        successLabel="vault migrated — tx confirmed."
        className="btn btn-secondary"
        disabled={!canSubmit}
        errorText="migrate failed — try again"
        testId="erc1155-migrate-vault"
      />
    </ActionRow>
  )
}

// ── Agent delegation toggle ──────────────────────────────────────────────────

function AgentDelegationRow({ instance }: { instance: `0x${string}` }) {
  const { data: enabled, refetch } = useReadErc1155InstanceAgentDelegationEnabled({
    address: instance,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  function handleToggle(): void {
    if (enabled === undefined) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'setAgentDelegation',
      args: [!enabled],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    void refetch()
  }

  const hint =
    enabled === undefined
      ? 'reading current state…'
      : `currently ${enabled ? 'enabled' : 'disabled'} — let a delegated agent act for this instance`

  return (
    <ActionRow label="agent delegation" hint={hint}>
      <TxButton
        state={tx.state}
        onClick={handleToggle}
        onReset={handleReset}
        label={enabled ? 'disable delegation' : 'enable delegation'}
        successLabel="delegation updated — tx confirmed."
        className="btn btn-secondary"
        disabled={enabled === undefined || tx.isBusy}
        errorText="toggle failed — try again"
        testId="erc1155-delegation"
      />
    </ActionRow>
  )
}

// ── Retry vault contribution (permissionless) ────────────────────────────────

function RetryVaultRow({ instance }: { instance: `0x${string}` }) {
  const tx = useTxAction()

  function handleRetry(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'retryVaultContribution',
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow
      label="retry vault contribution"
      hint="permissionless — re-attempt a failed vault contribution"
    >
      <TxButton
        state={tx.state}
        onClick={handleRetry}
        onReset={tx.reset}
        label="retry contribution"
        successLabel="contribution retried — tx confirmed."
        className="btn btn-secondary"
        errorText="retry failed — try again"
        testId="erc1155-retry-vault"
      />
    </ActionRow>
  )
}
