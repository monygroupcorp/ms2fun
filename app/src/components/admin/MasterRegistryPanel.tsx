/**
 * MasterRegistryPanel (W-K1) — protocol-admin console for the MasterRegistry. Renders ONLY when the
 * connected wallet is the registry owner (`useOwnerGate(forkAddresses.MasterRegistryV1)`); the parent
 * /admin shell decides where it sits. Laid out with the shared AdminSection/ActionRow primitives;
 * every action is a `useTxAction` + `<TxButton>` writing the generated `masterRegistryV1Abi` on the
 * fork chain. Inputs are validated client-side (viem `isAddress`) before the button enables.
 *
 * Actions (see src/generated/contracts.ts for exact arg shapes — confirmed at build time):
 *   registerFactory(address factoryAddress, string contractType, string title, string displayTitle,
 *                    string metadataURI, bytes32[] features, address creator)  + deactivateFactory(address)
 *   registerVault(address vault, address creator, string name, string metadataURI, uint256 targetId)
 *                    + deactivateVault(address)
 *   revokeInstance(address instance)  (censorship)  + updateInstanceMetadata(address instance, string uri)
 *
 * `setAgent` lives in K4 — intentionally NOT here.
 */
import { useState } from 'react'
import { isAddress } from 'viem'
import {
  masterRegistryV1Abi,
  useReadMasterRegistryV1GetTotalFactories,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import styles from './MasterRegistryPanel.module.css'

const REGISTRY = forkAddresses.MasterRegistryV1

/** Parse a comma/newline/space-separated list of bytes32 feature hashes; undefined when any entry is
 *  not a 32-byte hex value (empty list is valid → `[]`). */
function parseFeatures(raw: string): readonly `0x${string}`[] | undefined {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) return []
  if (parts.some((p) => !/^0x[0-9a-fA-F]{64}$/.test(p))) return undefined
  return parts as `0x${string}`[]
}

export function MasterRegistryPanel() {
  const { isOwner } = useOwnerGate(REGISTRY)
  if (!isOwner) return null

  return (
    <AdminSection title="master registry — factory · vault · instance" testId="admin-master">
      <RegisterFactoryRow />
      <DeactivateFactoryRow />
      <RegisterVaultRow />
      <DeactivateVaultRow />
      <RevokeInstanceRow />
      <UpdateInstanceMetaRow />
    </AdminSection>
  )
}

// ── register factory ────────────────────────────────────────────────────────────

function RegisterFactoryRow() {
  const { data: total, refetch } = useReadMasterRegistryV1GetTotalFactories({
    address: REGISTRY,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  const [factory, setFactory] = useState('')
  const [contractType, setContractType] = useState('')
  const [title, setTitle] = useState('')
  const [displayTitle, setDisplayTitle] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const [featuresRaw, setFeaturesRaw] = useState('')
  const [creator, setCreator] = useState('')

  const addr = factory.trim()
  const creatorAddr = creator.trim()
  const features = parseFeatures(featuresRaw)
  const canSubmit =
    isAddress(addr) &&
    contractType.trim() !== '' &&
    title.trim() !== '' &&
    displayTitle.trim() !== '' &&
    isAddress(creatorAddr) &&
    features !== undefined &&
    !tx.isBusy

  const totalHint =
    total === undefined ? 'total factories: …' : `total factories: ${total.toString()}`
  const hint = features === undefined ? 'features: each must be a 32-byte hex (0x…)' : totalHint

  return (
    <ActionRow label="register factory" hint={hint}>
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={factory}
          onChange={(e) => setFactory(e.target.value)}
          placeholder="0x… factory address"
          disabled={tx.isBusy}
          aria-label="factory address"
          data-testid="admin-register-factory-address"
        />
        <input
          className={styles.input}
          type="text"
          value={contractType}
          onChange={(e) => setContractType(e.target.value)}
          placeholder="contract type (e.g. ERC404Bonding)"
          disabled={tx.isBusy}
          aria-label="contract type"
          data-testid="admin-register-factory-type"
        />
        <input
          className={styles.input}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title"
          disabled={tx.isBusy}
          aria-label="title"
          data-testid="admin-register-factory-title"
        />
        <input
          className={styles.input}
          type="text"
          value={displayTitle}
          onChange={(e) => setDisplayTitle(e.target.value)}
          placeholder="display title"
          disabled={tx.isBusy}
          aria-label="display title"
          data-testid="admin-register-factory-display"
        />
        <input
          className={styles.input}
          type="text"
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="metadata uri (optional)"
          disabled={tx.isBusy}
          aria-label="metadata uri"
          data-testid="admin-register-factory-meta"
        />
        <input
          className={styles.input}
          type="text"
          value={featuresRaw}
          onChange={(e) => setFeaturesRaw(e.target.value)}
          placeholder="features: comma-separated bytes32 (optional)"
          disabled={tx.isBusy}
          aria-label="features"
          data-testid="admin-register-factory-features"
        />
        <input
          className={styles.input}
          type="text"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          placeholder="0x… creator address"
          disabled={tx.isBusy}
          aria-label="creator address"
          data-testid="admin-register-factory-creator"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(addr) || !isAddress(creatorAddr) || features === undefined) return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'registerFactory',
              args: [
                addr,
                contractType.trim(),
                title.trim(),
                displayTitle.trim(),
                metadataURI.trim(),
                features,
                creatorAddr,
              ],
              chainId: forkChainId,
            })
          }}
          label="register factory"
          successLabel="factory registered"
          onReset={() => {
            tx.reset()
            setFactory('')
            setContractType('')
            setTitle('')
            setDisplayTitle('')
            setMetadataURI('')
            setFeaturesRaw('')
            setCreator('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId="admin-register-factory"
        />
      </div>
    </ActionRow>
  )
}

// ── deactivate factory ──────────────────────────────────────────────────────────

function DeactivateFactoryRow() {
  const tx = useTxAction()
  const [addr, setAddr] = useState('')
  const trimmed = addr.trim()
  const canSubmit = isAddress(trimmed) && !tx.isBusy

  return (
    <ActionRow label="deactivate factory" hint="retire a factory template from new instances">
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… factory address"
          disabled={tx.isBusy}
          aria-label="factory address to deactivate"
          data-testid="admin-deactivate-factory-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(trimmed)) return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'deactivateFactory',
              args: [trimmed],
              chainId: forkChainId,
            })
          }}
          label="deactivate factory"
          successLabel="factory deactivated"
          onReset={() => {
            tx.reset()
            setAddr('')
          }}
          disabled={!canSubmit}
          className="btn btn-secondary"
          testId="admin-deactivate-factory"
        />
      </div>
    </ActionRow>
  )
}

// ── register vault ──────────────────────────────────────────────────────────────

function RegisterVaultRow() {
  const tx = useTxAction()
  const [vault, setVault] = useState('')
  const [creator, setCreator] = useState('')
  const [name, setName] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const [targetId, setTargetId] = useState('')

  const vaultAddr = vault.trim()
  const creatorAddr = creator.trim()
  const targetValid = /^\d+$/.test(targetId.trim())
  const canSubmit =
    isAddress(vaultAddr) &&
    isAddress(creatorAddr) &&
    name.trim() !== '' &&
    targetValid &&
    !tx.isBusy

  return (
    <ActionRow label="register vault" hint="register an alignment vault against a target">
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={vault}
          onChange={(e) => setVault(e.target.value)}
          placeholder="0x… vault address"
          disabled={tx.isBusy}
          aria-label="vault address"
          data-testid="admin-register-vault-address"
        />
        <input
          className={styles.input}
          type="text"
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          placeholder="0x… creator address"
          disabled={tx.isBusy}
          aria-label="creator address"
          data-testid="admin-register-vault-creator"
        />
        <input
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="vault name"
          disabled={tx.isBusy}
          aria-label="vault name"
          data-testid="admin-register-vault-name"
        />
        <input
          className={styles.input}
          type="text"
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="metadata uri (optional)"
          disabled={tx.isBusy}
          aria-label="vault metadata uri"
          data-testid="admin-register-vault-meta"
        />
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="target id (uint)"
          disabled={tx.isBusy}
          aria-label="target id"
          data-testid="admin-register-vault-target"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(vaultAddr) || !isAddress(creatorAddr) || !targetValid) return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'registerVault',
              args: [
                vaultAddr,
                creatorAddr,
                name.trim(),
                metadataURI.trim(),
                BigInt(targetId.trim()),
              ],
              chainId: forkChainId,
            })
          }}
          label="register vault"
          successLabel="vault registered"
          onReset={() => {
            tx.reset()
            setVault('')
            setCreator('')
            setName('')
            setMetadataURI('')
            setTargetId('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId="admin-register-vault"
        />
      </div>
    </ActionRow>
  )
}

// ── deactivate vault ────────────────────────────────────────────────────────────

function DeactivateVaultRow() {
  const tx = useTxAction()
  const [addr, setAddr] = useState('')
  const trimmed = addr.trim()
  const canSubmit = isAddress(trimmed) && !tx.isBusy

  return (
    <ActionRow label="deactivate vault" hint="retire a registered vault">
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… vault address"
          disabled={tx.isBusy}
          aria-label="vault address to deactivate"
          data-testid="admin-deactivate-vault-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(trimmed)) return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'deactivateVault',
              args: [trimmed],
              chainId: forkChainId,
            })
          }}
          label="deactivate vault"
          successLabel="vault deactivated"
          onReset={() => {
            tx.reset()
            setAddr('')
          }}
          disabled={!canSubmit}
          className="btn btn-secondary"
          testId="admin-deactivate-vault"
        />
      </div>
    </ActionRow>
  )
}

// ── revoke instance (censorship) ────────────────────────────────────────────────

function RevokeInstanceRow() {
  const tx = useTxAction()
  const [addr, setAddr] = useState('')
  const trimmed = addr.trim()
  const canSubmit = isAddress(trimmed) && !tx.isBusy

  return (
    <ActionRow
      label="revoke instance"
      hint="censor a deployed instance — removes it from the registry"
    >
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… instance address"
          disabled={tx.isBusy}
          aria-label="instance address to revoke"
          data-testid="admin-revoke-instance-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(trimmed)) return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'revokeInstance',
              args: [trimmed],
              chainId: forkChainId,
            })
          }}
          label="revoke instance"
          successLabel="instance revoked"
          onReset={() => {
            tx.reset()
            setAddr('')
          }}
          disabled={!canSubmit}
          className="btn btn-secondary"
          testId="admin-revoke-instance"
        />
      </div>
    </ActionRow>
  )
}

// ── update instance metadata ────────────────────────────────────────────────────

function UpdateInstanceMetaRow() {
  const tx = useTxAction()
  const [addr, setAddr] = useState('')
  const [uri, setUri] = useState('')
  const trimmed = addr.trim()
  const canSubmit = isAddress(trimmed) && uri.trim() !== '' && !tx.isBusy

  return (
    <ActionRow label="update instance metadata" hint="overwrite a deployed instance's content uri">
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… instance address"
          disabled={tx.isBusy}
          aria-label="instance address"
          data-testid="admin-update-instance-meta-address"
        />
        <input
          className={styles.input}
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="metadata uri (ipfs://, ar://, https://, data:)"
          disabled={tx.isBusy}
          aria-label="instance metadata uri"
          data-testid="admin-update-instance-meta-uri"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress(trimmed) || uri.trim() === '') return
            tx.send({
              address: REGISTRY,
              abi: masterRegistryV1Abi,
              functionName: 'updateInstanceMetadata',
              args: [trimmed, uri.trim()],
              chainId: forkChainId,
            })
          }}
          label="update metadata"
          successLabel="metadata updated"
          onReset={() => {
            tx.reset()
            setAddr('')
            setUri('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId="admin-update-instance-meta"
        />
      </div>
    </ActionRow>
  )
}
