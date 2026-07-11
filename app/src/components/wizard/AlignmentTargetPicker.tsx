import { Link } from 'wouter'
import { useEffect, useMemo, useState } from 'react'
import { useAlignmentTargets } from '../../lib/vaults/useAlignmentTargets'
import { useCollectionMetadata } from '../useCollectionMetadata'
import { IpfsImage } from '../ui/IpfsImage'
import { StateBlock } from '../ui/StateBlock'
import { groupVaultsByFamily, venueLabel, type VaultFamily } from '../../lib/wizard/vaultFlavor'
import type { RegisteredVault } from './useRegisteredVaults'
import { truncateAddress } from '../../lib/format'
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
}: AlignmentTargetPickerProps) {
  const { targets, isPending: targetsPending } = useAlignmentTargets()
  const [targetId, setTargetId] = useState<bigint | undefined>(undefined)

  // Vaults for the chosen target, grouped family → venue.
  const targetVaults = useMemo(
    () => (vaults ?? []).filter((v) => targetId !== undefined && v.targetId === targetId),
    [vaults, targetId],
  )
  const groups = useMemo(() => groupVaultsByFamily(targetVaults), [targetVaults])
  const presentVenues = useMemo(
    () => new Set(targetVaults.map((v) => v.venue)),
    [targetVaults],
  )
  const missingVenues = ALL_VENUES.filter((c) => !presentVenues.has(c.venue))

  // A vault count per target for the roster cards.
  const countByTarget = useMemo(() => {
    const m = new Map<bigint, number>()
    for (const v of vaults ?? []) m.set(v.targetId, (m.get(v.targetId) ?? 0) + 1)
    return m
  }, [vaults])

  // Switching target invalidates a vault selected under a different one.
  useEffect(() => {
    if (selectedVault && !targetVaults.some((v) => v.address === selectedVault)) {
      onSelectVault(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  if (isPending || targetsPending)
    return <StateBlock variant="loading">loading alignment targets…</StateBlock>
  if (isError) return <StateBlock variant="error">could not load vaults — is the fork up?</StateBlock>
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

          {/* Venues this community doesn't have — the "create it now" affordance. Inline vault
              deployment (+ gas estimate) is a follow-up; for now it routes to the request flow. */}
          {missingVenues.length > 0 && (
            <div className={styles.familyBlock}>
              <span className={styles.familyTag}>Not deployed</span>
              <div className={styles.venueGrid}>
                {missingVenues.map((c) => (
                  <div key={c.venue} className={`${styles.venueCard} ${styles.venueCreate}`}>
                    <span className={styles.venueName}>{venueLabel(c.venue)}</span>
                    <span className={styles.venueNote}>
                      {FAMILY_LABEL[c.family]} · create for {activeTarget.title} — coming soon
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
