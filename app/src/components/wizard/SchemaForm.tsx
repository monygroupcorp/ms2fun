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
        {field.unit && <span className={styles.unit}>{field.unit}</span>}
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
    case 'bigint':
      return (
        <input
          {...sharedProps}
          type="number"
          inputMode="numeric"
          className={`${styles.input}${hasError ? ` ${styles.inputError}` : ''}`}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )

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
