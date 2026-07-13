/**
 * ModuleSlotPicker — selectable card-radio for one wizard module slot.
 *
 * Driven by `useApprovedModules(slot.tag)` (live on-chain), renders a card per
 * approved module and an optional "None" option for non-required slots. Handles
 * all async states (pending / error / empty / pendingProvider) without crashing.
 */

import { useApprovedModules } from '../../lib/wizard/useApprovedModules'
import type { ModuleSlot } from '../../lib/wizard/schema'
import { LearnLink } from './LearnLink'
import { moduleConceptSlug } from '../../lib/learn/moduleConcepts'
import styles from './ModuleSlotPicker.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000'

// ── Public types ──────────────────────────────────────────────────────────────

export interface ModuleSelection {
  address: `0x${string}`
  configType: string
}

export interface ModuleSlotPickerProps {
  slot: ModuleSlot
  value: `0x${string}` | undefined
  onChange: (selection: ModuleSelection) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModuleSlotPicker({ slot, value, onChange }: ModuleSlotPickerProps) {
  const { data: options, isPending, isError } = useApprovedModules(slot.tag)

  // ── Header ────────────────────────────────────────────────────────────────

  const header = (
    <div className={styles.header}>
      <span className={styles.label}>
        {slot.label}
        {slot.required && <span className={styles.required}>*</span>}
      </span>
      {slot.help && <p className={styles.help}>{slot.help}</p>}
      {slot.learnMore && <LearnLink slug={slot.learnMore} />}
    </div>
  )

  // ── Async states ──────────────────────────────────────────────────────────

  if (isPending) {
    return (
      <div className={styles.root}>
        {header}
        <p className={styles.note}>loading options…</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.root}>
        {header}
        <p className={styles.note}>could not load options — is the fork up?</p>
      </div>
    )
  }

  // ── Empty list ────────────────────────────────────────────────────────────

  // `data` is `ModuleOption[] | undefined`; after guarding isPending+isError it should be
  // defined, but narrow explicitly so TS is satisfied under strictNullChecks.
  const resolvedOptions = options ?? []

  if (resolvedOptions.length === 0) {
    const emptyMsg = slot.pendingProvider
      ? `${slot.label} options are not available yet — check back after the provider is configured.`
      : `no approved modules for this slot`

    return (
      <div className={styles.root}>
        {header}
        <p className={styles.note}>{emptyMsg}</p>
      </div>
    )
  }

  // ── Option list ───────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      {header}
      <div className={styles.options}>
        {resolvedOptions.map((opt) => {
          const isSelected = value === opt.address
          const conceptSlug = moduleConceptSlug(opt.meta.configType)
          return (
            <button
              key={opt.address}
              type="button"
              className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
              onClick={() => onChange({ address: opt.address, configType: opt.meta.configType })}
              aria-pressed={isSelected}
            >
              <div className={styles.optionHead}>
                <span className={styles.optionName}>
                  {opt.meta.name !== '' ? opt.meta.name : opt.address}
                </span>
                {opt.meta.badge !== '' && <span className="badge">{opt.meta.badge}</span>}
              </div>
              {opt.meta.subtitle !== '' && (
                <p className={styles.optionSubtitle}>{opt.meta.subtitle}</p>
              )}
              {opt.meta.description !== '' && (
                <p className={styles.optionDescription}>{opt.meta.description}</p>
              )}
              {conceptSlug && (
                // Stop the click from bubbling to the card's select onClick — reading the doc
                // (new tab) must never select the module.
                <span onClick={(e) => e.stopPropagation()}>
                  <LearnLink slug={conceptSlug} />
                </span>
              )}
            </button>
          )
        })}

        {!slot.required && (
          <button
            type="button"
            className={`${styles.option} ${styles.optionNone} ${value === ZERO_ADDRESS || value === undefined ? styles.optionSelected : ''}`}
            onClick={() => onChange({ address: ZERO_ADDRESS, configType: '' })}
            aria-pressed={value === ZERO_ADDRESS || value === undefined}
          >
            <div className={styles.optionHead}>
              <span className={styles.optionName}>None</span>
            </div>
            <p className={styles.optionSubtitle}>skip this module</p>
          </button>
        )}
      </div>
    </div>
  )
}
