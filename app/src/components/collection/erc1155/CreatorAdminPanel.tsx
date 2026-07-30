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
 *   - configure allowlist        ✦ (noesis-080) submit a merkle root on-chain + persist its listURI —
 *     shown only when the instance's gating module is set (today the only deployed gating module IS
 *     MerkleGatingModule; PasswordTierGating was dropped in noesis-065).
 * (✦ = added in W-E; all but retry are onlyOwner.)
 *
 * Every write goes through `useTxAction` (one per action) with `erc1155InstanceAbi`, so the
 * idle/signing/confirming/success/error UX is identical across rows.
 */
import { useState } from 'react'
import { formatEther, isAddress } from 'viem'
import {
  erc1155InstanceAbi,
  masterRegistryV1Abi,
  merkleGatingModuleAbi,
  useReadErc1155InstanceAgentDelegationEnabled,
  useReadErc1155InstanceGatingModule,
  useReadErc1155InstanceTotalProceeds,
  useReadErc1155InstanceTotalWithdrawn,
} from '../../../generated/contracts'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { collectionToDataUri } from '../../../lib/metadata'
import {
  buildAllowlistFromPaste,
  buildAllowlistFromUri,
  isAllowlistBuildError,
  patchAllowlistRow,
  toMerkleConfig,
  type AllowlistBuildOutcome,
} from '../../../lib/collection/allowlistConfig'
import { hasGatingModule } from './gatingMint'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { AmountField } from '../../ui/AmountField'
import { parseAmount } from '../../ui/parseAmount'
import { TxButton } from '../../ui/TxButton'
import { useTxAction } from '../../ui/useTxAction'
import { useOwnerGate } from '../../ui/useOwnerGate'
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
      <MigrateVaultRow instance={instance} />
      <AgentDelegationRow instance={instance} />
      <RetryVaultRow instance={instance} />
      <AllowlistConfigRow instance={instance} />
    </AdminSection>
  )
}

// ── Withdraw ─────────────────────────────────────────────────────────────────

function WithdrawRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: totalProceeds, refetch: refetchProceeds } = useReadErc1155InstanceTotalProceeds({
    address: instance,
    chainId: chainId,
  })
  const { data: totalWithdrawn, refetch: refetchWithdrawn } = useReadErc1155InstanceTotalWithdrawn({
    address: instance,
    chainId: chainId,
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
      chainId: chainId,
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
  const chainId = useCollectionChainId()
  const tx = useTxAction()

  function handleClaim(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'claimVaultFees',
      chainId: chainId,
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
  const chainId = useCollectionChainId()
  const tx = useTxAction()

  function handleClaim(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'claimAllFees',
      chainId: chainId,
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
  const chainId = useCollectionChainId()
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
      chainId: chainId,
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
  const chainId = useCollectionChainId()
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
      chainId: chainId,
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
  const chainId = useCollectionChainId()
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
      chainId: chainId,
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
  const chainId = useCollectionChainId()
  const { data: enabled, refetch } = useReadErc1155InstanceAgentDelegationEnabled({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  function handleToggle(): void {
    if (enabled === undefined) return
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'setAgentDelegation',
      args: [!enabled],
      chainId: chainId,
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
  const chainId = useCollectionChainId()
  const tx = useTxAction()

  function handleRetry(): void {
    tx.send({
      address: instance,
      abi: erc1155InstanceAbi,
      functionName: 'retryVaultContribution',
      chainId: chainId,
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

// ── Configure allowlist (noesis-080) ──────────────────────────────────────────
//
// Only shown when the instance has a gating module set — today that can only be MerkleGatingModule
// (PasswordTierGating was dropped in noesis-065). Two independently-retryable transactions:
//   1. configureFor(instance, {editionId:0, roots:[root], tierOpenTimes:[0]}) on the gating module —
//      requires Ownable(instance).owner() (the connected wallet, since useOwnerGate already asserted it).
//   2. updateInstanceMetadata(instance, newMetadataUri) on MasterRegistry — requires the ORIGINAL
//      `info.creator`, which may differ from the (transferable) instance owner; surfaced below.
// If (1) lands but (2) fails, the root is set but minters can't find the list; if only (2) lands,
// `canMint` reverts (no root). Both rows are re-runnable independently.

function AllowlistConfigRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data: gatingModule } = useReadErc1155InstanceGatingModule({
    address: instance,
    chainId: chainId,
  })
  // `useCollection` doesn't expose a refetch — react-query's own staleTime naturally picks up the
  // new metadataURI on the collection page's next mount/refetch; nothing to force here.
  const { data: card } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)

  const [mode, setMode] = useState<'hosted' | 'paste'>('hosted')
  const [input, setInput] = useState('')
  const [build, setBuild] = useState<AllowlistBuildOutcome | undefined>(undefined)
  const [checking, setChecking] = useState(false)

  const configureTx = useTxAction()
  const metadataTx = useTxAction()

  if (!hasGatingModule(gatingModule)) return null

  async function handleCheck(): Promise<void> {
    setChecking(true)
    try {
      const result =
        mode === 'hosted' ? await buildAllowlistFromUri(input) : buildAllowlistFromPaste(input)
      setBuild(result)
    } finally {
      setChecking(false)
    }
  }

  function handleSubmitRoot(): void {
    if (build === undefined || isAllowlistBuildError(build) || gatingModule === undefined) return
    configureTx.send({
      address: gatingModule,
      abi: merkleGatingModuleAbi,
      functionName: 'configureFor',
      args: [instance, toMerkleConfig(build.root)],
      chainId: chainId,
    })
  }

  function handlePersistListUri(): void {
    if (build === undefined || isAllowlistBuildError(build) || metadata === undefined) return
    const patched = patchAllowlistRow(metadata, {
      editionId: 0,
      tierIndex: 0,
      listURI: build.listURI,
    })
    metadataTx.send({
      address: addresses.MasterRegistryV1,
      abi: masterRegistryV1Abi,
      functionName: 'updateInstanceMetadata',
      args: [instance, collectionToDataUri(patched)],
      chainId: chainId,
    })
  }

  const summary =
    build !== undefined && !isAllowlistBuildError(build)
      ? `${build.count} addresses · root ${build.root.slice(0, 10)}… ✓${
          build.invalid.length > 0 ? ` (${build.invalid.length} invalid rows skipped)` : ''
        }`
      : undefined
  const buildError = build !== undefined && isAllowlistBuildError(build) ? build.error : undefined
  const canSubmit = build !== undefined && !isAllowlistBuildError(build)

  return (
    <ActionRow
      label="configure allowlist"
      hint="submit a merkle root on-chain and persist the listURI (two transactions)"
    >
      <div>
        <div>
          <button
            type="button"
            className={mode === 'hosted' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              setMode('hosted')
              setBuild(undefined)
            }}
            data-testid="erc1155-allowlist-mode-hosted"
          >
            hosted URL
          </button>
          <button
            type="button"
            className={mode === 'paste' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              setMode('paste')
              setBuild(undefined)
            }}
            data-testid="erc1155-allowlist-mode-paste"
          >
            paste addresses
          </button>
        </div>
        {mode === 'hosted' ? (
          <input
            className={styles.input}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setBuild(undefined)
            }}
            placeholder="ipfs://, ar://, or https:// listURI"
            aria-label="allowlist listURI"
            data-testid="erc1155-allowlist-uri"
          />
        ) : (
          <textarea
            className={styles.input}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setBuild(undefined)
            }}
            placeholder={'one per line: 0xADDRESS,maxQty'}
            rows={4}
            aria-label="pasted allowlist"
            data-testid="erc1155-allowlist-paste"
          />
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleCheck()}
          disabled={checking || input.trim() === ''}
          data-testid="erc1155-allowlist-check"
        >
          {checking ? 'checking…' : 'check'}
        </button>
        {summary !== undefined && <p className={styles.hint ?? undefined}>{summary}</p>}
        {buildError !== undefined && (
          <p className={`${styles.txStatus} ${styles.txError}`}>{buildError}</p>
        )}

        <TxButton
          state={configureTx.state}
          onClick={handleSubmitRoot}
          onReset={configureTx.reset}
          label="1. submit root on-chain"
          successLabel="root submitted — tx confirmed."
          disabled={!canSubmit}
          errorText={configureTx.reason ?? 'submit failed — try again'}
          testId="erc1155-allowlist-configure"
        />
        <TxButton
          state={metadataTx.state}
          onClick={handlePersistListUri}
          onReset={metadataTx.reset}
          label="2. persist listURI"
          successLabel="listURI persisted — tx confirmed."
          disabled={!canSubmit || metadata === undefined}
          errorText={
            metadataTx.reason ??
            'persist failed — try again (this write requires the ORIGINAL creator wallet, which may differ from the current owner)'
          }
          testId="erc1155-allowlist-persist"
        />
      </div>
    </ActionRow>
  )
}
