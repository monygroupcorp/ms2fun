import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useAccount } from 'wagmi'
import { toHex } from 'viem'
import {
  PROJECT_TYPES,
  getProjectType,
  validateFields,
  buildCreateInstance,
  type ProjectTypeSchema,
  type SelectedModules,
} from '../lib/wizard'
import { collectionToDataUri, type CollectionMetadata } from '../lib/metadata'
import { SchemaForm } from '../components/wizard/SchemaForm'
import { ModuleSlotPicker } from '../components/wizard/ModuleSlotPicker'
import { CollectionMetaForm } from '../components/wizard/CollectionMetaForm'
import { useRegisteredVaults } from '../components/wizard/useRegisteredVaults'
import { useCreateSubmit } from '../components/wizard/useCreateSubmit'
import { WalletButton } from '../components/WalletButton'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './WizardPage.module.css'

const EMPTY_META: CollectionMetadata = {
  schemaVersion: 1,
  name: '',
  description: '',
  image: '',
  banner: '',
  category: '',
  links: [],
}

/**
 * Launch wizard (Phase 3 / T2). Drives the ADR-0005 option schema → a real `createInstance`:
 * project type → core fields (generic `SchemaForm`) → alignment vault + module slots → collection
 * metadata → `buildCreateInstance` → `useCreateSubmit` → redirect to the new `/collection/:instance`.
 */
export function WizardPage() {
  const { address: creator } = useAccount()
  const [, setLocation] = useLocation()

  const [typeKey, setTypeKey] = useState<ProjectTypeSchema['key']>('erc1155')
  const projectType = getProjectType(typeKey)
  const [values, setValues] = useState<Record<string, string>>({})
  const [vault, setVault] = useState<`0x${string}` | undefined>(undefined)
  const [modules, setModules] = useState<Record<string, `0x${string}`>>({})
  const [metadata, setMetadata] = useState<CollectionMetadata>(EMPTY_META)
  const [attempted, setAttempted] = useState(false)

  const submit = useCreateSubmit()
  const vaults = useRegisteredVaults()

  // Redirect to the new collection once the InstanceCreated event is mined.
  useEffect(() => {
    if (submit.isSuccess && submit.instance) setLocation(`/collection/${submit.instance}`)
  }, [submit.isSuccess, submit.instance, setLocation])

  if (!projectType) return null

  const coreErrors = attempted ? validateFields(projectType.coreFields, values) : {}
  const busy = submit.isPending || submit.isConfirming

  function pickType(key: ProjectTypeSchema['key']) {
    setTypeKey(key)
    setValues({})
    setModules({})
    setAttempted(false)
    submit.reset()
  }

  function handleSubmit() {
    if (!projectType || busy) return
    setAttempted(true)
    if (Object.keys(validateFields(projectType.coreFields, values)).length > 0) return
    if (!creator || !vault || !metadata.name.trim()) return

    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)))
    const selected: SelectedModules = {
      vault,
      ...(modules.gatingModule ? { gatingModule: modules.gatingModule } : {}),
      ...(modules.liquidityDeployer ? { liquidityDeployer: modules.liquidityDeployer } : {}),
      ...(modules.stakingModule ? { stakingModule: modules.stakingModule } : {}),
    }
    submit.submit(
      buildCreateInstance(typeKey, {
        values,
        creator,
        metadataURI: collectionToDataUri(metadata),
        salt,
        modules: selected,
      }),
    )
  }

  const missingVault = attempted && !vault
  const missingName = attempted && !metadata.name.trim()

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <h1 className={`${styles.title} text-chromatic-medium`}>LAUNCH</h1>

      {/* Project type */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Type</h2>
        <div className={styles.typeRow}>
          {PROJECT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.typeCard} ${t.key === typeKey ? styles.typeSelected : ''}`}
              onClick={() => pickType(t.key)}
              aria-pressed={t.key === typeKey}
            >
              <span className={styles.typeName}>{t.title}</span>
              <span className={styles.typeSummary}>{t.summary}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Core fields */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Details</h2>
        <SchemaForm
          fields={projectType.coreFields}
          values={values}
          onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
          errors={coreErrors}
        />
      </section>

      {/* Alignment vault (registered in MasterRegistry, not ComponentRegistry) */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Alignment vault</h2>
        {vaults.isPending && <StateBlock variant="loading">loading vaults…</StateBlock>}
        {vaults.isError && (
          <StateBlock variant="error">could not load vaults — is the fork up?</StateBlock>
        )}
        {vaults.data && vaults.data.length === 0 && (
          <StateBlock variant="empty">no alignment vaults registered yet.</StateBlock>
        )}
        <div className={styles.vaultRow}>
          {vaults.data?.map((v) => (
            <button
              key={v.address}
              type="button"
              className={`${styles.vaultCard} ${v.address === vault ? styles.vaultSelected : ''}`}
              onClick={() => setVault(v.address)}
              aria-pressed={v.address === vault}
            >
              <span className={styles.vaultName}>{v.name || truncateAddress(v.address)}</span>
              <span className={styles.vaultMeta}>target #{v.targetId.toString()}</span>
            </button>
          ))}
        </div>
        {missingVault && <p className={styles.error}>select an alignment vault</p>}
      </section>

      {/* Other module slots (gating / liquidity / staking) */}
      {projectType.moduleSlots
        .filter((s) => s.key !== 'vault')
        .map((slot) => (
          <section key={slot.key} className={styles.section}>
            <ModuleSlotPicker
              slot={slot}
              value={modules[slot.key]}
              onChange={(sel) => setModules((m) => ({ ...m, [slot.key]: sel.address }))}
            />
          </section>
        ))}

      {/* Collection metadata */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Collection</h2>
        <CollectionMetaForm onChange={setMetadata} />
        {missingName && <p className={styles.error}>a collection name is required</p>}
      </section>

      {/* Submit */}
      <section className={styles.section}>
        {!creator ? (
          <div className={styles.connect}>
            <StateBlock variant="empty">connect your wallet to launch</StateBlock>
            <WalletButton />
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-chromatic"
            onClick={handleSubmit}
            disabled={busy}
          >
            {submit.isPending
              ? 'confirm in wallet…'
              : submit.isConfirming
                ? 'deploying…'
                : submit.isSuccess
                  ? 'deployed — redirecting…'
                  : 'Launch collection'}
          </button>
        )}
        {submit.isError && <p className={styles.error}>transaction failed — try again</p>}
      </section>
    </div>
  )
}
