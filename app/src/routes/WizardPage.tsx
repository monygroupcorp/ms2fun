import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useAccount } from 'wagmi'
import { toHex } from 'viem'
import {
  PROJECT_TYPES,
  getProjectType,
  getConfigSchema,
  collectDefaults,
  validateFields,
  buildCreateInstance,
  encodeTierConfig,
  hasTierConfig,
  validateTierConfig,
  encodeMetadataConfig,
  validateMetadataConfig,
  type MetadataModuleSelection,
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

/** Metadata-stack slot keys whose selected module shows a per-instance config form (ADR-0006/0007).
 *  `resolver` is configless (its configType `metadata-resolver` has no fields), so only these two. */
const META_CONFIG_SLOTS = ['overlay', 'tier'] as const

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
  // The gating module's metadata `configType` (drives which config form to show) + its form values.
  const [gatingConfigType, setGatingConfigType] = useState('')
  const [gatingValues, setGatingValues] = useState<Record<string, string>>({})
  // Metadata-stack (overlay/tier) per-slot configType + a SHARED values bag (the overlay/tier form
  // keys are disjoint — `overlay…` vs `tier…` — so one bag holds both without collision).
  const [metaConfigTypes, setMetaConfigTypes] = useState<Record<string, string>>({})
  const [metaValues, setMetaValues] = useState<Record<string, string>>({})
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

  // Config form for the selected gating module (currently only password-tier-gating has inputs).
  const gatingSchema = gatingConfigType ? getConfigSchema(gatingConfigType) : undefined
  const showGatingForm = Boolean(modules.gatingModule && gatingSchema && gatingSchema.fields.length > 0)
  const gatingErrors =
    attempted && showGatingForm && gatingSchema
      ? { ...validateFields(gatingSchema.fields, gatingValues), ...validateTierConfig(gatingValues) }
      : {}

  // Metadata-resolution stack: the selected resolver/overlay/tier module addresses + validation.
  const metaSelection: MetadataModuleSelection = {
    ...(modules.resolver ? { resolver: modules.resolver } : {}),
    ...(modules.overlay ? { overlay: modules.overlay } : {}),
    ...(modules.tier ? { tier: modules.tier } : {}),
  }
  const anyMetaModule = Boolean(modules.resolver || modules.overlay || modules.tier)
  const metaErrors =
    attempted && anyMetaModule ? validateMetadataConfig(metaSelection, metaValues) : {}

  function pickType(key: ProjectTypeSchema['key']) {
    setTypeKey(key)
    setValues({})
    setModules({})
    setGatingConfigType('')
    setGatingValues({})
    setMetaConfigTypes({})
    setMetaValues({})
    setAttempted(false)
    submit.reset()
  }

  function handleSubmit() {
    if (!projectType || busy) return
    setAttempted(true)
    if (Object.keys(validateFields(projectType.coreFields, values)).length > 0) return
    if (!creator || !vault || !metadata.name.trim()) return
    if (
      showGatingForm &&
      gatingSchema &&
      (Object.keys(validateFields(gatingSchema.fields, gatingValues)).length > 0 ||
        Object.keys(validateTierConfig(gatingValues)).length > 0)
    )
      return
    // Block on a malformed metadata stack (ranges, missing router, empty tier table…).
    if (anyMetaModule && Object.keys(validateMetadataConfig(metaSelection, metaValues)).length > 0)
      return

    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)))
    const selected: SelectedModules = {
      vault,
      ...(modules.gatingModule ? { gatingModule: modules.gatingModule } : {}),
      ...(modules.liquidityDeployer ? { liquidityDeployer: modules.liquidityDeployer } : {}),
      ...(modules.stakingModule ? { stakingModule: modules.stakingModule } : {}),
      ...(modules.resolver ? { resolver: modules.resolver } : {}),
      ...(modules.overlay ? { overlay: modules.overlay } : {}),
      ...(modules.tier ? { tier: modules.tier } : {}),
    }
    // Thread tier config into the same create tx when the gating form has at least one tier.
    const gatingConfig =
      modules.gatingModule && hasTierConfig(gatingValues)
        ? encodeTierConfig(gatingValues)
        : undefined
    // Thread the metadata-resolution stack (ADR-0006/0007) when any resolver/overlay/tier is picked.
    const metadataConfig = anyMetaModule
      ? encodeMetadataConfig(metaSelection, metaValues)
      : undefined
    submit.submit(
      buildCreateInstance(typeKey, {
        values,
        creator,
        metadataURI: collectionToDataUri(metadata),
        salt,
        modules: selected,
        ...(gatingConfig ? { gatingConfig } : {}),
        ...(metadataConfig ? { metadataConfig } : {}),
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
      <p className={styles.kicker}>Compose · commit · deploy</p>
      <h1 className={styles.title}>Launch a collection</h1>

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
        {/* The bind — the forced-alignment mechanic stated as data the moment a vault is chosen.
            ~20% is the protocol constant; the commitment is the loudest thing on the step. */}
        {vault && (
          <div className={`noesis-bind ${styles.bind}`}>
            <div className="cell">
              your fees<b>fees</b>
            </div>
            <div className="arrow">→</div>
            <div className="cell vault">
              {vaults.data?.find((v) => v.address === vault)?.name || 'alignment'} vault<b>~20%</b>
            </div>
          </div>
        )}
        {vault && (
          <p className={styles.bindNote}>
            ~20% of fees bind to this vault on-chain, forever. <b>It can&rsquo;t be undone.</b>
          </p>
        )}
        {missingVault && <p className={styles.error}>select an alignment vault</p>}
      </section>

      {/* Other module slots (gating / liquidity / staking / metadata stack) */}
      {projectType.moduleSlots
        .filter((s) => s.key !== 'vault')
        .map((slot) => {
          const isMetaSlot = (META_CONFIG_SLOTS as readonly string[]).includes(slot.key)
          const metaSchema =
            isMetaSlot && metaConfigTypes[slot.key]
              ? getConfigSchema(metaConfigTypes[slot.key]!)
              : undefined
          const showMetaForm = Boolean(
            isMetaSlot && modules[slot.key] && metaSchema && metaSchema.fields.length > 0,
          )
          return (
            <section key={slot.key} className={styles.section}>
              <ModuleSlotPicker
                slot={slot}
                value={modules[slot.key]}
                onChange={(sel) => {
                  setModules((m) => ({ ...m, [slot.key]: sel.address }))
                  // Seed the config form's defaults so defaulted selects (e.g. tierType, payout)
                  // satisfy their dependents' visibleWhen and reach submit.
                  if (slot.key === 'gatingModule') {
                    setGatingConfigType(sel.configType)
                    const s = sel.configType ? getConfigSchema(sel.configType) : undefined
                    setGatingValues(s ? collectDefaults(s.fields) : {})
                  } else if ((META_CONFIG_SLOTS as readonly string[]).includes(slot.key)) {
                    setMetaConfigTypes((m) => ({ ...m, [slot.key]: sel.configType }))
                    const s = sel.configType ? getConfigSchema(sel.configType) : undefined
                    // Merge (not replace) — overlay + tier share one values bag with disjoint keys.
                    if (s) setMetaValues((v) => ({ ...collectDefaults(s.fields), ...v }))
                  }
                }}
              />
              {/* Per-module config form — applied in the same create tx. */}
              {slot.key === 'gatingModule' && showGatingForm && gatingSchema && (
                <div className={styles.moduleConfig}>
                  <h3 className={styles.sectionTitle}>{gatingSchema.title}</h3>
                  <SchemaForm
                    fields={gatingSchema.fields}
                    values={gatingValues}
                    onChange={(key, value) => setGatingValues((v) => ({ ...v, [key]: value }))}
                    errors={gatingErrors}
                  />
                </div>
              )}
              {showMetaForm && metaSchema && (
                <div className={styles.moduleConfig}>
                  <h3 className={styles.sectionTitle}>{metaSchema.title}</h3>
                  <SchemaForm
                    fields={metaSchema.fields}
                    values={metaValues}
                    onChange={(key, value) => setMetaValues((v) => ({ ...v, [key]: value }))}
                    errors={metaErrors}
                  />
                </div>
              )}
              {/* Surface stack-level errors (e.g. "select a resolver to stack overlay + tier"). */}
              {slot.key === 'resolver' && metaErrors['resolver'] && (
                <p className={styles.error}>{metaErrors['resolver']}</p>
              )}
            </section>
          )
        })}

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
            className={styles.launchBtn}
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
