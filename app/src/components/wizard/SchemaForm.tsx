'use client'

import { useId } from 'react'
import type { FieldSchema, FieldKind, SelectOption } from '@/lib/wizard/schema'
import { isFieldVisible } from '@/lib/wizard/schema'
import { LearnLink } from './LearnLink'
import styles from './SchemaForm.module.css'

// ── Public interface ──────────────────────────────────────────────────────────

export interface SchemaFormProps {
  fields: FieldSchema[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  errors?: Record<string, string>
}

export function SchemaForm({ fields, values, onChange, errors = {} }: SchemaFormProps) {
  return (
    <div className={styles.form}>
      {fields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          values={values}
          onChange={onChange}
          errors={errors}
        />
      ))}
    </div>
  )
}

// ── Unit display ──────────────────────────────────────────────────────────────

/** Human-facing suffix for a field `unit`. Amount units render an entered-in-ETH/tokens hint. */
const UNIT_LABELS: Record<NonNullable<FieldSchema['unit']>, string> = {
  wei: 'wei',
  eth: 'ETH',
  gwei: 'gwei',
  bps: 'bps',
  seconds: 'seconds',
  tokens: 'tokens',
  count: '',
}

/** Units whose input accepts a fractional (decimal) human value. */
const DECIMAL_UNITS = new Set<FieldSchema['unit']>(['eth', 'gwei', 'tokens'])

// ── Internal rendering ────────────────────────────────────────────────────────

interface FieldRendererProps {
  field: FieldSchema
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  errors: Record<string, string>
}

function FieldRenderer({ field, values, onChange, errors }: FieldRendererProps) {
  if (!isFieldVisible(field, values)) return null

  if (field.kind === 'group') {
    return <GroupField field={field} values={values} onChange={onChange} errors={errors} />
  }

  if (field.kind === 'list') {
    return <ListField field={field} values={values} onChange={onChange} errors={errors} />
  }

  return <LeafField field={field} values={values} onChange={onChange} errors={errors} />
}

// ── Group ─────────────────────────────────────────────────────────────────────

function GroupField({ field, values, onChange, errors }: FieldRendererProps) {
  const childFields = field.fields ?? []

  // Collect any child errors to surface on the group legend
  const childErrorKeys = childFields.map((f) => f.key).filter((k) => k in errors)
  const groupError = errors[field.key] ?? null

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupLegend}>
        {field.label}
        {field.validation?.required && (
          <span className={styles.required} aria-hidden="true">
            {' *'}
          </span>
        )}
      </legend>
      {field.help && <p className={styles.help}>{field.help}</p>}
      {field.learnMore && <LearnLink slug={field.learnMore} />}
      <div className={styles.groupBody}>
        {childFields.map((child) => (
          <FieldRenderer
            key={child.key}
            field={child}
            values={values}
            onChange={onChange}
            errors={errors}
          />
        ))}
      </div>
      {(groupError ?? (childErrorKeys.length > 0 ? null : null)) && (
        <p className={styles.error}>{groupError}</p>
      )}
    </fieldset>
  )
}

// ── List ──────────────────────────────────────────────────────────────────────

function ListField({ field, values, onChange, errors }: FieldRendererProps) {
  const item = field.item

  // Row COUNT is tracked explicitly under `${key}.length` — separate from row VALUES (`${key}.N`),
  // so a freshly-added row renders even while its value is still empty. (A previous "count
  // non-empty values" approach hid newly-added rows, making the list impossible to fill.)
  const countKey = `${field.key}.length`
  const rawCount = values[countKey]
  const count = rawCount !== undefined && /^\d+$/.test(rawCount) ? Number(rawCount) : 0
  const rowIndices = Array.from({ length: count }, (_, i) => i)
  const maxRows = field.validation?.max
  const canAdd = maxRows === undefined || count < maxRows

  function handleAdd() {
    // Seed the new row's value key (keeps the existing onChange contract) then bump the count.
    onChange(`${field.key}.${count}`, item ? String(item.default ?? '') : '')
    onChange(countKey, String(count + 1))
  }

  function handleRemove(idx: number) {
    // Shift each row above `idx` down one slot, clear the now-unused top slot, decrement the count.
    for (let i = idx; i < count - 1; i++) {
      onChange(`${field.key}.${i}`, values[`${field.key}.${i + 1}`] ?? '')
    }
    onChange(`${field.key}.${count - 1}`, '')
    onChange(countKey, String(Math.max(0, count - 1)))
  }

  const fieldError = errors[field.key]

  return (
    <div className={styles.field} role="group" aria-labelledby={`${field.key}-list-label`}>
      <div className={styles.listHeader}>
        <span id={`${field.key}-list-label`} className={styles.label}>
          {field.label}
          {field.validation?.required && (
            <span className={styles.required} aria-hidden="true">
              {' *'}
            </span>
          )}
        </span>
        {canAdd && (
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${styles.addBtn}`}
            onClick={handleAdd}
          >
            + Add {item?.label ?? 'Item'}
          </button>
        )}
      </div>
      {field.help && <p className={styles.help}>{field.help}</p>}
      {field.learnMore && <LearnLink slug={field.learnMore} />}
      {rowIndices.length > 0 && (
        <div className={styles.listRows}>
          {rowIndices.map((idx) => {
            if (!item) return null
            const rowKey = `${field.key}.${idx}`
            const rowValue = values[rowKey] ?? String(item.default ?? '')
            const rowError = errors[rowKey]
            const inputId = `${rowKey}-input`
            const helpId = `${rowKey}-help`
            const errorId = `${rowKey}-error`
            const describedBy =
              [item.help ? helpId : null, rowError ? errorId : null].filter(Boolean).join(' ') ||
              undefined

            return (
              <div key={idx} className={styles.listRow}>
                <label htmlFor={inputId} className={styles.rowLabel}>
                  {item.label} {idx + 1}
                </label>
                <div className={styles.rowControl}>
                  <input
                    id={inputId}
                    type="text"
                    className={`${styles.input}${rowError ? ` ${styles.inputError}` : ''}`}
                    value={rowValue}
                    onChange={(e) => onChange(rowKey, e.target.value)}
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={describedBy}
                  />
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm ${styles.removeBtn}`}
                    onClick={() => handleRemove(idx)}
                    aria-label={`Remove ${item.label} ${idx + 1}`}
                  >
                    ×
                  </button>
                </div>
                {item.learnMore && <LearnLink slug={item.learnMore} />}
                {item.help && (
                  <p id={helpId} className={styles.help}>
                    {item.help}
                  </p>
                )}
                {rowError && (
                  <p id={errorId} className={styles.error} role="alert">
                    {rowError}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {fieldError && (
        <p className={styles.error} role="alert">
          {fieldError}
        </p>
      )}
    </div>
  )
}

// ── Leaf inputs ───────────────────────────────────────────────────────────────

function LeafField({ field, values, onChange, errors }: FieldRendererProps) {
  const uid = useId()
  const inputId = `${uid}-${field.key}`
  const helpId = `${uid}-help`
  const errorId = `${uid}-error`
  const fieldError = errors[field.key]

  const describedBy =
    [field.help ? helpId : null, fieldError ? errorId : null].filter(Boolean).join(' ') || undefined

  const rawValue = values[field.key]
  const value = rawValue !== undefined ? rawValue : String(field.default ?? '')

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {field.label}
        {field.unit && UNIT_LABELS[field.unit] && (
          <span className={styles.unit}>{UNIT_LABELS[field.unit]}</span>
        )}
        {field.validation?.required && (
          <span className={styles.required} aria-hidden="true">
            {' *'}
          </span>
        )}
      </label>
      {field.help && (
        <p id={helpId} className={styles.help}>
          {field.help}
        </p>
      )}
      {field.learnMore && <LearnLink slug={field.learnMore} />}
      <InputForKind
        field={field as FieldSchema & { kind: LeafKind }}
        inputId={inputId}
        value={value}
        onChange={onChange}
        hasError={Boolean(fieldError)}
        {...(describedBy !== undefined ? { describedBy } : {})}
      />
      {fieldError && (
        <p id={errorId} className={styles.error} role="alert">
          {fieldError}
        </p>
      )}
    </div>
  )
}

// ── Bounded-bps slider ────────────────────────────────────────────────────────

/** `2500` bps → `"25%"`. Trims to whole percent unless the value needs fractional precision. */
function formatBpsPercent(bps: number): string {
  const pct = (bps / 100).toFixed(2).replace(/\.?0+$/, '')
  return `${pct || '0'}%`
}

interface BpsSliderInputProps {
  field: FieldSchema
  inputId: string
  value: string
  onChange: (key: string, value: string) => void
  hasError: boolean
  describedBy?: string
}

/**
 * A bounded bps field, e.g. `declaredMaxAllowanceBps` (0..10000). Slider and exact-entry input are
 * two views of the SAME `field.key` value — either one's `onChange` writes the identical string the
 * plain number input would have, so calldata encoding downstream is unaffected.
 */
function BpsSliderInput({
  field,
  inputId,
  value,
  onChange,
  hasError,
  describedBy,
}: BpsSliderInputProps) {
  const min = field.validation?.min ?? 0
  const max = field.validation?.max ?? 10000
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const parsed = Number(value)
  const sliderValue = Number.isFinite(parsed) ? clamp(parsed) : min

  return (
    <div className={styles.bpsSlider}>
      <div className={styles.bpsSliderRow}>
        <input
          type="range"
          aria-label={`${field.label} (slider)`}
          aria-invalid={hasError ? true : undefined}
          min={min}
          max={max}
          step={1}
          value={sliderValue}
          className={styles.range}
          // Native range inputs can't leave [min, max] in a real browser; clamp explicitly anyway so
          // a synthetically-dispatched out-of-range value never reaches the shared field key.
          onChange={(e) => onChange(field.key, String(clamp(Number(e.target.value))))}
        />
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          aria-invalid={hasError ? true : undefined}
          {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
          className={`${styles.input} ${styles.bpsNumber}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      </div>
      <span className={styles.bpsPercent}>{formatBpsPercent(sliderValue)}</span>
    </div>
  )
}

// ── Per-kind input elements ───────────────────────────────────────────────────

/** Leaf kinds only — `group` and `list` are handled before reaching `InputForKind`. */
type LeafKind = Exclude<FieldKind, 'group' | 'list'>

interface InputForKindProps {
  field: FieldSchema & { kind: LeafKind }
  inputId: string
  value: string
  onChange: (key: string, value: string) => void
  hasError: boolean
  describedBy?: string
}

function InputForKind({
  field,
  inputId,
  value,
  onChange,
  hasError,
  describedBy,
}: InputForKindProps) {
  const sharedProps = {
    id: inputId,
    'aria-invalid': hasError ? (true as const) : undefined,
    ...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {}),
  }

  const kind: LeafKind = field.kind

  switch (kind) {
    case 'text':
    case 'address':
      return (
        <input
          {...sharedProps}
          type="text"
          className={`${styles.input}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )

    case 'textarea':
      return (
        <textarea
          {...sharedProps}
          className={`${styles.textarea}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          rows={4}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )

    case 'number':
    case 'bigint': {
      // A bounded `bps` field (a closed 0..max domain) gets a slider affordance: dragging states the
      // domain visually, a paired exact-entry input keeps every value reachable, and a live percent
      // readout translates bps into the units a buyer actually reads. Any bounded bps field on the
      // create path inherits this the same way — it is not special-cased to one key.
      if (
        field.unit === 'bps' &&
        field.validation?.min !== undefined &&
        field.validation?.max !== undefined
      ) {
        return (
          <BpsSliderInput
            field={field}
            inputId={inputId}
            value={value}
            onChange={onChange}
            hasError={hasError}
            {...(describedBy !== undefined ? { describedBy } : {})}
          />
        )
      }
      // Amount units (ETH / tokens) are entered as HUMAN decimals and scaled to exact wei at encode;
      // integer units (bps / seconds / count) keep a whole-number step + keypad.
      const decimal = DECIMAL_UNITS.has(field.unit)
      return (
        <input
          {...sharedProps}
          type="number"
          inputMode={decimal ? 'decimal' : 'numeric'}
          step={decimal ? 'any' : undefined}
          min={0}
          className={`${styles.input}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )
    }

    case 'bool': {
      const checked = value === 'true'
      return (
        <label className={styles.checkboxLabel}>
          <input
            {...sharedProps}
            type="checkbox"
            className={styles.checkbox}
            checked={checked}
            onChange={(e) => onChange(field.key, e.target.checked ? 'true' : 'false')}
          />
          <span className={styles.checkboxText}>{checked ? 'Enabled' : 'Disabled'}</span>
        </label>
      )
    }

    case 'select': {
      const options: SelectOption[] = field.options ?? []
      return (
        <select
          {...sharedProps}
          className={`${styles.input} ${styles.select}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">— Select {field.label} —</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    }

    default: {
      // Exhaustive guard: `kind` is `never` here if all cases above are covered.
      // Render a fallback text input so nothing crashes at runtime on future kinds.
      const _exhaustive: never = kind
      void _exhaustive
      return (
        <input
          {...sharedProps}
          type="text"
          className={`${styles.input}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )
    }
  }
}
