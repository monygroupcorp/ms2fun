import { Link } from 'wouter'
import { useEffect, useMemo, useState } from 'react'
import { useAlignmentTargets } from '../../lib/vaults/useAlignmentTargets'
import { useCollectionMetadata } from '../useCollectionMetadata'
import { IpfsImage } from '../ui/IpfsImage'
import { StateBlock } from '../ui/StateBlock'
import { groupVaultsByFamily, venueLabel, type VaultFamily } from '../../lib/wizard/vaultFlavor'
import type { RegisteredVault } from './useRegisteredVaults'
import { YieldVaultCreateCard } from './YieldVaultCreateCard'
import { truncateAddress } from '../../lib/format'
import { LearnLink } from './LearnLink'
import styles from './AlignmentTargetPicker.module.css'

/** The full venue catalog, so a target missing a venue can surface a "create it" affordance. */
const ALL_VENUES: { family: VaultFamily; venue: string }[] = [
  { family: 'yield', venue: 'AaveEndowment' },
  { family: 'lp', venue: 'UniswapV4' },
  { family: 'lp', venue: 'Cypher' },
  { family: 'lp', venue: 'ZAMM' },
]

const FAMILY_LABEL: Record<VaultFamily, string> = { yield: 'Yield', lp: 'Liquidity' }

export interface AlignmentTargetPickerProps {
  vaults: RegisteredVault[] | undefined
  isPending: boolean
  isError: boolean
  selectedVault: `0x${string}` | undefined
  onSelectVault: (address: `0x${string}` | undefined) => void
  /**
   * Opt-in family filter — vault families this project type cannot pair with. Omitted (the default)
   * means every family is offered, so existing call sites are unchanged.
   *
   * Used by the ERC404 path, where `ERC404Factory.createInstance` hard-reverts
   * `EndowmentVaultNotSupported` against a yield/endowment vault (its graduation split is
   * family-blind). Hiding those venues here keeps the wizard from offering a pairing the chain will
   * refuse.
   *
   * Note this is deliberately STRICTER than the contract: `deriveVaultFlavor` buckets an UNKNOWN
   * vaultType as `'yield'`, so excluding `'yield'` also hides unknown types, while the contract gate
   * fails OPEN on them and would let one through. That asymmetry is safe in this direction — hiding a
   * venue is not reverting, and a genuinely new venue reaches the picker by teaching
   * `deriveVaultFlavor` about it, not by leaking through the yield bucket.
   */
  // `| undefined` is explicit for `exactOptionalPropertyTypes` — call sites pass the prop
  // unconditionally and switch it off with `undefined` on the non-ERC404 paths.
  excludeFamilies?: readonly VaultFamily[] | undefined
}

/** One selectable target card — logo (from metadataURI) + title + description + vault count. */
function TargetCard({
  target,
  vaultCount,
  selected,
  onSelect,
}: {
  target: { id: bigint; title: string; description: string; metadataURI: string }
  vaultCount: number
  selected: boolean
  onSelect: () => void
}) {
  const meta = useCollectionMetadata(target.metadataURI)
  return (
    <button
      type="button"
      className={`${styles.targetCard} ${selected ? styles.targetSelected : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.targetLogo}>
        <IpfsImage
          uri={meta?.image ?? ''}
          alt={`${target.title} logo`}
          className={styles.targetImg}
          fallback={
            <span className={styles.targetGlyph} aria-hidden>
              ◈
            </span>
          }
        />
      </div>
      <div className={styles.targetBody}>
        <p className={styles.targetName}>{target.title}</p>
        {target.description && <p className={styles.targetDesc}>{target.description}</p>}
        <p className={styles.targetMeta}>
          {vaultCount > 0 ? `${vaultCount} vault${vaultCount === 1 ? '' : 's'}` : 'no vaults yet'}
        </p>
      </div>
    </button>
  )
}

/**
 * Target-first alignment picker: choose the COMMUNITY you align to, see its info, then pick one of its
 * vaults (venue). A venue that community doesn't have yet surfaces a "create it" affordance (inline
 * vault deployment is a follow-up — for now it points at the request flow).
 */
export function AlignmentTargetPicker({
  vaults,
  isPending,
  isError,
  selectedVault,
  onSelectVault,
  excludeFamilies,
}: AlignmentTargetPickerProps) {
  const { targets, isPending: targetsPending } = useAlignmentTargets()
  const [targetId, setTargetId] = useState<bigint | undefined>(undefined)

  // Excluded families, keyed as a stable string so an inline `excludeFamilies={['yield']}` prop (a
  // fresh array identity every render) doesn't invalidate the memos below on every render.
  const excludeKey = (excludeFamilies ?? []).join(',')
  const isExcluded = (family: VaultFamily) => excludeKey.split(',').includes(family)

  // Everything downstream — groups, venue affordances, per-target counts — reads this, so an excluded
  // family is unreachable in the picker rather than merely unrendered in one place.
  const offeredVaults = useMemo(() => {
    const excluded = new Set(excludeKey.split(','))
    return (vaults ?? []).filter((v) => !excluded.has(v.family))
  }, [vaults, excludeKey])

  // Vaults for the chosen target, grouped family → venue.
  const targetVaults = useMemo(
    () => offeredVaults.filter((v) => targetId !== undefined && v.targetId === targetId),
    [offeredVaults, targetId],
  )
  const groups = useMemo(() => groupVaultsByFamily(targetVaults), [targetVaults])
  const presentVenues = useMemo(() => new Set(targetVaults.map((v) => v.venue)), [targetVaults])
  // Excluded families drop out of the "create it now" affordance too — offering to deploy a vault the
  // create call would then refuse is worse than not offering it.
  const missingVenues = ALL_VENUES.filter(
    (c) => !isExcluded(c.family) && !presentVenues.has(c.venue),
  )

  // A vault count per target for the roster cards — counts only what this project type can pick.
  const countByTarget = useMemo(() => {
    const m = new Map<bigint, number>()
    for (const v of offeredVaults) m.set(v.targetId, (m.get(v.targetId) ?? 0) + 1)
    return m
  }, [offeredVaults])

  // Rehydrate the chosen community from the lifted vault selection. `targetId` is local, so a step
  // re-entry remounts this blank while `selectedVault` still holds — without this the community grid
  // collapses to the top and (via the invalidation effect below) the vault itself gets cleared.
  useEffect(() => {
    if (targetId === undefined && selectedVault) {
      const owning = (vaults ?? []).find((v) => v.address === selectedVault)
      if (owning) setTargetId(owning.targetId)
    }
  }, [targetId, selectedVault, vaults])

  // Switching target invalidates a vault selected under a different one. Guarded on a chosen target so
  // it never fires while `targetId` is still undefined (mount / pre-selection) and wipes the vault.
  useEffect(() => {
    if (targetId === undefined) return
    if (selectedVault && !targetVaults.some((v) => v.address === selectedVault)) {
      onSelectVault(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  if (isPending || targetsPending)
    return <StateBlock variant="loading">loading alignment targets…</StateBlock>
  if (isError)
    return <StateBlock variant="error">could not load vaults — is the fork up?</StateBlock>
  if (targets.length === 0)
    return (
      <StateBlock variant="empty" boxed>
        no alignment targets yet.
      </StateBlock>
    )

  const activeTarget = targets.find((t) => t.id === targetId)

  return (
    <div className={styles.wrap}>
      {/* Level 1 — the community. */}
      <h3 className={styles.sectionTitle}>Community</h3>
      <p className={styles.help}>
        Every collection binds ~20% of its fees to a vault aligned with the community you pick.{' '}
        <LearnLink slug="alignment-vault" />
      </p>
      <div className={styles.targetGrid}>
        {targets.map((t) => (
          <TargetCard
            key={t.id.toString()}
            target={t}
            vaultCount={countByTarget.get(t.id) ?? 0}
            selected={t.id === targetId}
            onSelect={() => setTargetId(t.id)}
          />
        ))}
      </div>

      <p className={styles.requestLine}>
        Don&rsquo;t see the community you want to align to?{' '}
        <Link href="/request-target">Request a new alignment target →</Link>
      </p>

      {/* Level 2 — the vault (venue) for the chosen community. */}
      {activeTarget && (
        <div className={styles.venueSection}>
          <h3 className={styles.sectionTitle}>Vault for {activeTarget.title}</h3>
          {groups.length === 0 && (
            <p className={styles.help}>
              No vaults deployed for {activeTarget.title} yet — create one below.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.family} className={styles.familyBlock}>
              <span className={styles.familyTag}>{FAMILY_LABEL[g.family]}</span>
              <div className={styles.venueGrid}>
                {g.venues.map((opt) => {
                  const on = opt.vault.address === selectedVault
                  return (
                    <button
                      key={opt.venue}
                      type="button"
                      className={`${styles.venueCard} ${on ? styles.venueSelected : ''} ${
                        opt.disabled ? styles.venueDisabled : ''
                      }`}
                      onClick={() => !opt.disabled && onSelectVault(opt.vault.address)}
                      disabled={opt.disabled}
                      aria-pressed={on}
                    >
                      <span className={styles.venueName}>{opt.venueLabel}</span>
                      <span className={styles.venueNote}>
                        {opt.disabled
                          ? 'not yet wired for liquidity'
                          : opt.vault.name || truncateAddress(opt.vault.address)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Venues this community doesn't have — the "create it now" affordance. Yield (Aave endowment)
              is permissionlessly deployable inline (noesis-077); the LP venues stay static "coming soon"
              until their priceValidator/pool-config lockdown lands (spec §4.2). */}
          {missingVenues.length > 0 && (
            <div className={styles.familyBlock}>
              <span className={styles.familyTag}>Not deployed</span>
              <div className={styles.venueGrid}>
                {missingVenues.map((c) =>
                  c.family === 'yield' ? (
                    <YieldVaultCreateCard
                      key={c.venue}
                      targetId={activeTarget.id}
                      targetTitle={activeTarget.title}
                      onCreated={() => {}}
                    />
                  ) : (
                    <div key={c.venue} className={`${styles.venueCard} ${styles.venueCreate}`}>
                      <span className={styles.venueName}>{venueLabel(c.venue)}</span>
                      <span className={styles.venueNote}>
                        {FAMILY_LABEL[c.family]} · create for {activeTarget.title} — coming soon
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
