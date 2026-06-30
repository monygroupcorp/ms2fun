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
  type ModuleSlot,
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

/** The launch is a guided composition ending in an irreversible on-chain act ("compose · commit ·
 * deploy"). The 7 canonical steps are fixed; the stepper ADAPTS to the chosen contract — N/A steps
 * grey out, never vanish (ERC-1155 has no Liquidity; ERC-721 auction has no Modules/Gating/
 * Liquidity). Step numbering stays stable (Alignment is always 05/07) so the index reads true. */
type StepKey = 'contract' | 'modules' | 'gating' | 'liquidity' | 'alignment' | 'page' | 'review'

const STEP_DEFS: { key: StepKey; label: string }[] = [
  { key: 'contract', label: 'Contract' },
  { key: 'modules', label: 'Modules' },
  { key: 'gating', label: 'Gating' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'alignment', label: 'Alignment' },
  { key: 'page', label: 'Collection page' },
  { key: 'review', label: 'Review & deploy' },
]

const TYPE_LABEL: Record<string, string> = {
  erc404: 'ERC-404',
  erc1155: 'ERC-1155',
  erc721: 'ERC-721',
}

/**
 * Launch wizard (Phase 3 / T2). Drives the ADR-0005 option schema → a real `createInstance`:
 * project type → core fields (generic `SchemaForm`) → module slots → alignment vault → collection
 * metadata → `buildCreateInstance` → `useCreateSubmit` → redirect to the new `/collection/:instance`.
 * Reskinned as the NOESIS stepped flow (stepper rail + accreting manifest + a reverent big-question
 * panel at the Contract/Alignment decisions + a live collection-page preview at Page/Review). The
 * step machine only gates *navigation*; behaviour, validation, and the create builder are unchanged.
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
  const [stepKey, setStepKey] = useState<StepKey>('contract')

  const submit = useCreateSubmit()
  const vaults = useRegisteredVaults()

  // Redirect to the new collection once the InstanceCreated event is mined.
  useEffect(() => {
    if (submit.isSuccess && submit.instance) setLocation(`/collection/${submit.instance}`)
  }, [submit.isSuccess, submit.instance, setLocation])

  if (!projectType) return null
  // Stable non-null binding so the step-body / slot closures keep the narrowing.
  const pt = projectType

  const coreErrors = attempted ? validateFields(pt.coreFields, values) : {}
  const busy = submit.isPending || submit.isConfirming

  // Config form for the selected gating module (currently only password-tier-gating has inputs).
  const gatingSchema = gatingConfigType ? getConfigSchema(gatingConfigType) : undefined
  const showGatingForm = Boolean(
    modules.gatingModule && gatingSchema && gatingSchema.fields.length > 0,
  )
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
    setStepKey('contract')
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

  // ── Step model ────────────────────────────────────────────────────────────────
  const slotKeys = new Set(pt.moduleSlots.map((s) => s.key))
  const applicable: Record<StepKey, boolean> = {
    contract: true,
    modules:
      slotKeys.has('stakingModule') ||
      slotKeys.has('resolver') ||
      slotKeys.has('overlay') ||
      slotKeys.has('tier'),
    gating: slotKeys.has('gatingModule'),
    liquidity: slotKeys.has('liquidityDeployer'),
    alignment: true,
    page: true,
    review: true,
  }
  const fullIdx = STEP_DEFS.findIndex((s) => s.key === stepKey)
  const stepNumber = fullIdx + 1
  function nextApplicable(from: number, dir: number) {
    let i = from + dir
    while (i >= 0 && i < STEP_DEFS.length && !applicable[STEP_DEFS[i]!.key]) i += dir
    return i >= 0 && i < STEP_DEFS.length ? STEP_DEFS[i]! : undefined
  }
  const prevStep = nextApplicable(fullIdx, -1)
  const nextStep = nextApplicable(fullIdx, +1)
  const goStep = (dir: number) => {
    const target = nextApplicable(fullIdx, dir)
    if (target) setStepKey(target.key)
  }

  const selectedVault = vaults.data?.find((v) => v.address === vault)
  const vaultLabel = selectedVault?.name || (vault ? truncateAddress(vault) : '—')
  const metaCount = ['stakingModule', 'resolver', 'overlay', 'tier'].filter((k) => modules[k]).length
  const moduleChips =
    [
      modules.gatingModule && 'gating',
      modules.liquidityDeployer && 'liq',
      modules.stakingModule && 'stake',
      anyMetaModule && 'meta',
    ]
      .filter(Boolean)
      .join(' · ') || '—'

  const stepSub: Record<StepKey, string> = {
    contract: TYPE_LABEL[typeKey] ?? typeKey,
    modules: metaCount > 0 ? `${metaCount} added` : '—',
    gating: modules.gatingModule ? 'configured' : '—',
    liquidity: modules.liquidityDeployer ? 'selected' : '—',
    alignment: vault ? vaultLabel : '—',
    page: metadata.name.trim() ? 'set' : '—',
    review: '—',
  }

  /** One module slot's picker + its per-module config form — the existing slot behaviour (seeds
   * config defaults on select), re-housed into per-step bodies. */
  function renderSlot(slot: ModuleSlot) {
    const isMetaSlot = (META_CONFIG_SLOTS as readonly string[]).includes(slot.key)
    const metaSchema =
      isMetaSlot && metaConfigTypes[slot.key] ? getConfigSchema(metaConfigTypes[slot.key]!) : undefined
    const showMetaForm = Boolean(
      isMetaSlot && modules[slot.key] && metaSchema && metaSchema.fields.length > 0,
    )
    return (
      <div key={slot.key} className={styles.slot}>
        <ModuleSlotPicker
          slot={slot}
          value={modules[slot.key]}
          onChange={(sel) => {
            setModules((m) => ({ ...m, [slot.key]: sel.address }))
            if (slot.key === 'gatingModule') {
              setGatingConfigType(sel.configType)
              const s = sel.configType ? getConfigSchema(sel.configType) : undefined
              setGatingValues(s ? collectDefaults(s.fields) : {})
            } else if ((META_CONFIG_SLOTS as readonly string[]).includes(slot.key)) {
              setMetaConfigTypes((m) => ({ ...m, [slot.key]: sel.configType }))
              const s = sel.configType ? getConfigSchema(sel.configType) : undefined
              if (s) setMetaValues((v) => ({ ...collectDefaults(s.fields), ...v }))
            }
          }}
        />
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
        {slot.key === 'resolver' && metaErrors['resolver'] && (
          <p className={styles.error}>{metaErrors['resolver']}</p>
        )}
      </div>
    )
  }

  const slotByKey = (key: string) => pt.moduleSlots.find((s) => s.key === key)

  // ── Step bodies ─────────────────────────────────────────────────────────────
  function stepBody() {
    switch (stepKey) {
      case 'contract':
        return (
          <div className={styles.body}>
            <div className={styles.decision}>
              <h2 className={styles.question}>What are you launching?</h2>
              <p className={styles.lede}>
                The contract is fixed on deploy — pick the shape that fits the work.
              </p>
              <div className={styles.cards}>
                {PROJECT_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`${styles.bigCard} ${t.key === typeKey ? styles.bigSelected : ''}`}
                    onClick={() => pickType(t.key)}
                    aria-pressed={t.key === typeKey}
                  >
                    <span className={styles.bigCardName}>{TYPE_LABEL[t.key] ?? t.title}</span>
                    <span className={styles.bigCardSummary}>{t.summary}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.formBlock}>
              <h3 className={styles.sectionTitle}>Details</h3>
              <SchemaForm
                fields={pt.coreFields}
                values={values}
                onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
                errors={coreErrors}
              />
            </div>
          </div>
        )

      case 'modules': {
        const slots = ['stakingModule', 'resolver', 'overlay', 'tier']
          .map(slotByKey)
          .filter((s): s is ModuleSlot => !!s)
        return (
          <div className={styles.body}>
            <p className={styles.lede}>
              Compose optional modules — each states its effect. Everything here is part of the same
              deploy.
            </p>
            {slots.map(renderSlot)}
          </div>
        )
      }

      case 'gating': {
        const slot = slotByKey('gatingModule')
        return (
          <div className={styles.body}>
            <p className={styles.lede}>
              Gate the mint behind password tiers or a merkle allowlist — or leave it open.
            </p>
            {slot && renderSlot(slot)}
          </div>
        )
      }

      case 'liquidity': {
        const slot = slotByKey('liquidityDeployer')
        return (
          <div className={styles.body}>
            <p className={styles.lede}>
              Where the bonding curve graduates — the DEX the collection lists into on completion.
            </p>
            {slot && renderSlot(slot)}
          </div>
        )
      }

      case 'alignment':
        return (
          <div className={styles.body}>
            <div className={styles.decision}>
              <h2 className={styles.question}>Who inspired this?</h2>
              <p className={styles.lede}>
                Every launch binds <b>~20% of its fees</b> to the work that inspired it — on mint and
                every resale, forever. Choose that work. This is what makes it not a grift.
              </p>
              {vaults.isPending && <StateBlock variant="loading">loading vaults…</StateBlock>}
              {vaults.isError && (
                <StateBlock variant="error">could not load vaults — is the fork up?</StateBlock>
              )}
              {vaults.data && vaults.data.length === 0 && (
                <StateBlock variant="empty" boxed>
                  no alignment vaults registered yet.
                </StateBlock>
              )}
              <div className={styles.cards}>
                {vaults.data?.map((v) => (
                  <button
                    key={v.address}
                    type="button"
                    className={`${styles.bigCard} ${v.address === vault ? styles.bigSelected : ''}`}
                    onClick={() => setVault(v.address)}
                    aria-pressed={v.address === vault}
                  >
                    <span className={styles.bigCardName}>
                      {v.name || truncateAddress(v.address)}
                    </span>
                    <span className={styles.bigCardSummary}>target #{v.targetId.toString()}</span>
                  </button>
                ))}
              </div>
              {vault && (
                <>
                  <div className={`noesis-bind ${styles.bind}`}>
                    <div className="cell">
                      your fees<b>fees</b>
                    </div>
                    <div className="arrow">→</div>
                    <div className="cell vault">
                      {vaultLabel} vault<b>~20%</b>
                    </div>
                  </div>
                  <p className={styles.bindNote}>
                    Vault: contract-enforced. <b>Can&rsquo;t be undone</b> after deploy.
                  </p>
                </>
              )}
              {missingVault && <p className={styles.error}>select an alignment vault</p>}
            </div>
          </div>
        )

      case 'page':
        return (
          <div className={styles.body}>
            <p className={styles.lede}>
              The collection&rsquo;s page — name, description, and imagery. This is what visitors meet.
            </p>
            <CollectionMetaForm onChange={setMetadata} />
            {missingName && <p className={styles.error}>a collection name is required</p>}
            <CollectionPreview name={metadata.name} typeLabel={TYPE_LABEL[typeKey] ?? typeKey} vaultLabel={vault ? vaultLabel : undefined} />
          </div>
        )

      case 'review':
        return (
          <div className={styles.reviewGrid}>
            <div>
              <div className={styles.previewHead}>
                <span>Your collection page — live preview</span>
                <span>Nothing hidden</span>
              </div>
              <CollectionPreview
                name={metadata.name}
                typeLabel={TYPE_LABEL[typeKey] ?? typeKey}
                vaultLabel={vault ? vaultLabel : undefined}
              />
            </div>
            <aside className={styles.summary}>
              <p className={styles.summaryHead}>Deploy summary</p>
              <dl className={styles.summaryList}>
                <div className={styles.summaryRow}>
                  <dt>Contract</dt>
                  <dd>{TYPE_LABEL[typeKey] ?? typeKey}</dd>
                </div>
                <div className={styles.summaryRow}>
                  <dt>Name</dt>
                  <dd>{metadata.name.trim() || '—'}</dd>
                </div>
                <div className={styles.summaryRow}>
                  <dt>Modules</dt>
                  <dd>{moduleChips}</dd>
                </div>
                <div className={styles.summaryRow}>
                  <dt>Aligned to</dt>
                  <dd>{vault ? `${vaultLabel} · ~20%` : '—'}</dd>
                </div>
              </dl>
              <div className={styles.permanence}>
                <span aria-hidden>▪ </span>Deploying is <b>permanent</b>. The contract, the modules,
                and the <b>~20% alignment</b> are fixed on-chain — <b>they can&rsquo;t be undone.</b>
              </div>
            </aside>
          </div>
        )
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <div className={styles.shell}>
        {/* The backbone — stepper (top) + the truthful accreting manifest (pinned bottom). */}
        <aside className={styles.rail}>
          <p className={styles.railKicker}>
            Launch · {TYPE_LABEL[typeKey] ?? typeKey} — {STEP_DEFS.length} steps
          </p>
          <div className="noesis-stepper">
            {STEP_DEFS.map((s, i) => {
              const state = !applicable[s.key]
                ? 'na'
                : i === fullIdx
                  ? 'active'
                  : i < fullIdx
                    ? 'done'
                    : 'pending'
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`step ${state} ${styles.step}`}
                  disabled={!applicable[s.key]}
                  onClick={() => applicable[s.key] && setStepKey(s.key)}
                >
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lab">
                    {s.label}
                    <small>{stepSub[s.key]}</small>
                  </span>
                </button>
              )
            })}
          </div>

          <div className={`noesis-manifest ${styles.manifest}`}>
            <p className={styles.manifestHead}>Manifest</p>
            <div className="mr">
              <span>Contract</span>
              <b>{TYPE_LABEL[typeKey] ?? typeKey}</b>
            </div>
            <div className="mr">
              <span>Supply</span>
              <b>{values['nftCount'] || '—'}</b>
            </div>
            <div className="mr">
              <span>Modules</span>
              <b>{moduleChips}</b>
            </div>
            <div className="mr">
              <span>Aligned</span>
              <b>{vault ? `${vaultLabel} · ~20%` : '—'}</b>
            </div>
          </div>
        </aside>

        {/* The panel — step header, body, and the fixed footer (Back · Continue / Deploy). */}
        <div className={styles.panel}>
          <p className={styles.stepKicker}>
            Step {String(stepNumber).padStart(2, '0')} / {String(STEP_DEFS.length).padStart(2, '0')}{' '}
            — {STEP_DEFS[fullIdx]?.label}
          </p>

          {stepBody()}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.backStep}
              onClick={() => goStep(-1)}
              disabled={!prevStep}
            >
              {prevStep ? `← Back · ${prevStep.label}` : '←'}
            </button>

            {stepKey !== 'review' ? (
              <button type="button" className={styles.continue} onClick={() => goStep(1)}>
                Continue{nextStep ? ` · ${nextStep.label}` : ''} →
              </button>
            ) : !creator ? (
              <div className={styles.connect}>
                <StateBlock variant="empty">connect your wallet to deploy</StateBlock>
                <WalletButton />
              </div>
            ) : (
              <button
                type="button"
                className={styles.continue}
                onClick={handleSubmit}
                disabled={busy}
              >
                {submit.isPending
                  ? 'Confirm in wallet…'
                  : submit.isConfirming
                    ? 'Deploying…'
                    : submit.isSuccess
                      ? 'Deployed — redirecting…'
                      : 'Deploy collection'}
              </button>
            )}
          </div>
          {submit.isError && <p className={styles.error}>transaction failed — try again</p>}
        </div>
      </div>
    </div>
  )
}

/** Live collection-page preview (the wizard's C register) — a scaled stand-in for the page being
 * built: the title, the alignment bind, and a gallery hang of placeholder tiles. "This is what
 * deploys — nothing hidden." */
function CollectionPreview({
  name,
  typeLabel,
  vaultLabel,
}: {
  name: string
  typeLabel: string
  vaultLabel?: string | undefined
}) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewLabel}>
        <h3 className={styles.previewTitle}>{name.trim() || 'Untitled collection'}</h3>
        <p className={styles.previewBy}>by you · {typeLabel}</p>
        {vaultLabel && (
          <div className={`noesis-bind ${styles.previewBind}`}>
            <div className="cell">
              fees<b>fees</b>
            </div>
            <div className="arrow">→</div>
            <div className="cell vault">
              {vaultLabel}<b>~20%</b>
            </div>
          </div>
        )}
      </div>
      <div className={styles.previewHang} aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.previewTile} />
        ))}
      </div>
    </div>
  )
}
