/**
 * Module-option schema (ADR-0005) — the typed model of the creation wizard's input space.
 *
 * HYBRID source of truth:
 *   - The fixed factory `createInstance` params are described here as hand-authored, generic
 *     `FieldSchema` descriptors (they're pinned by the ABI; see `projectTypes.ts`).
 *   - The selectable MODULES (gating / liquidity / staking / vault) are enumerated LIVE from
 *     `ComponentRegistry` by tag; each module's on-chain metadata JSON names a `configType`, and the
 *     client supplies the typed config `FieldSchema`s keyed by that `configType` (see
 *     `configTypes.ts`). Approving a module on-chain extends the wizard without an app redeploy.
 *
 * Everything is a GENERIC declarative descriptor so ONE renderer drives every form and NOEMA can
 * introspect the same model. The evaluator below (`isFieldVisible`, `validateFields`) is the single
 * source for progressive disclosure + validation, shared by the wizard and NOEMA. Pure TS — no
 * React/wagmi — so both consumers reuse it.
 */

import { isAddress } from 'viem'

/** Renderable input kinds. `group` nests `fields`; `list` repeats `item`. */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'bigint'
  | 'address'
  | 'bool'
  | 'select'
  | 'list'
  | 'group'

/** ComponentRegistry feature tags (preimages of the on-chain `keccak256` labels in FeatureUtils). */
export type ComponentTag =
  | 'gating'
  | 'liquidity'
  | 'dynamic_pricing'
  | 'staking'
  | 'vault'
  | 'resolver'
  | 'overlay'
  | 'tier'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

/** Declarative validation — evaluated by `validateField`; never throws. */
export interface FieldValidation {
  required?: boolean
  /** For number/bigint: numeric bound. For text/textarea/list: length bound. */
  min?: number
  max?: number
  /** Regex source applied to text/address values. */
  pattern?: string
  /** Override the default error message. */
  message?: string
}

/**
 * Progressive disclosure: render the field only when a predicate over a sibling value holds.
 * Exactly one comparator is used (checked in declaration order).
 */
export interface VisibleWhen {
  /** Sibling field `key` whose current value is tested. */
  field: string
  equals?: string | number | boolean
  notEquals?: string | number | boolean
  greaterThan?: number
  isTruthy?: boolean
}

/**
 * One generic field. `key` is the path into the assembled submit payload (e.g. `nftCount`,
 * `freeMint.allocation`) — the submit-builder maps these onto the contract args. `unit` documents
 * otherwise-ambiguous on-chain units (wei / eth / bps / seconds / tokens).
 */
export interface FieldSchema {
  key: string
  label: string
  kind: FieldKind
  help?: string
  /** A /learn concept slug (lib/learn/concepts). Renders a LearnLink after the inline help. */
  learnMore?: string
  default?: unknown
  /** For `select`. */
  options?: SelectOption[]
  /** For `list` — the element schema. */
  item?: FieldSchema
  /** For `group` — nested fields. */
  fields?: FieldSchema[]
  validation?: FieldValidation
  visibleWhen?: VisibleWhen
  unit?: 'wei' | 'eth' | 'gwei' | 'bps' | 'seconds' | 'tokens' | 'count'
}

/**
 * A slot the creator fills by SELECTING an approved component (live, by `tag`) and then configuring
 * it via the `configType` its on-chain metadata names. `pendingProvider` marks a slot whose option
 * list isn't available yet (e.g. `vault` until the Aave vault ships in T4) — the schema is complete;
 * only the option source is deferred.
 */
export interface ModuleSlot {
  key: string
  label: string
  tag: ComponentTag
  required: boolean
  help?: string
  /** A /learn concept slug (lib/learn/concepts). Renders a LearnLink after the slot help. */
  learnMore?: string
  pendingProvider?: boolean
}

/** A config form keyed by a module's metadata `configType` (e.g. `password-tier-gating`). */
export interface ConfigSchema {
  configType: string
  title: string
  fields: FieldSchema[]
}

/** Full descriptor for one project type (one factory). */
export interface ProjectTypeSchema {
  key: 'erc404' | 'erc1155' | 'erc721'
  title: string
  /** `forkAddresses` key for the factory. */
  factory: 'ERC404Factory' | 'ERC1155Factory' | 'ERC721AuctionFactory'
  summary: string
  /** A /learn concept slug (lib/learn/concepts): the explainer for this whole standard. Rendered as
   * a LearnLink on the type big-card so a creator can read what the standard is before committing. */
  learnMore?: string
  /** The `createInstance` params the creator fills. */
  coreFields: FieldSchema[]
  /** Selectable modules (enumerated live by tag). */
  moduleSlots: ModuleSlot[]
  /** Steps performed AFTER create (ERC1155 editions, ERC721 auction pieces). */
  postCreate?: { title: string; fields: FieldSchema[] }
}

/**
 * Seed a values bag with each leaf field's `default`. A select's `default` is only DISPLAYED by the
 * renderer, never committed to state until changed — so without this, a `visibleWhen` keyed on a
 * defaulted select reads `undefined` and stays hidden (and the default never reaches submit). Use
 * this to initialize a form's values. Lists are tracked by count, not defaults, so they're skipped.
 */
export function collectDefaults(fields: FieldSchema[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    if (f.kind === 'group' && f.fields) Object.assign(out, collectDefaults(f.fields))
    else if (f.kind !== 'list' && f.default !== undefined) out[f.key] = String(f.default)
  }
  return out
}

// ── Evaluator (shared by the wizard renderer + NOEMA) ────────────────────────

/** Resolve a `key` against a flat-or-nested values bag (supports dotted paths like `freeMint.scope`). */
function readValue(values: Record<string, unknown>, key: string): unknown {
  if (key in values) return values[key]
  // dotted-path fallback
  let cur: unknown = values
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Whether a field should render given the current values (true when it has no `visibleWhen`). */
export function isFieldVisible(field: FieldSchema, values: Record<string, unknown>): boolean {
  const w = field.visibleWhen
  if (!w) return true
  const v = readValue(values, w.field)
  if (w.equals !== undefined) return v === w.equals
  if (w.notEquals !== undefined) return v !== w.notEquals
  if (w.greaterThan !== undefined) return typeof v === 'number' && v > w.greaterThan
  if (w.isTruthy !== undefined) return Boolean(v) === w.isTruthy
  return true
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Validate one field's value; returns an error string or null. Never throws. Skips hidden fields. */
export function validateField(
  field: FieldSchema,
  value: unknown,
  values: Record<string, unknown> = {},
): string | null {
  if (!isFieldVisible(field, values)) return null
  const rules = field.validation
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)

  if (rules?.required && isEmpty) return rules.message ?? `${field.label} is required`
  if (isEmpty) return null // optional + empty → valid

  switch (field.kind) {
    case 'address': {
      if (typeof value !== 'string' || !ADDRESS_RE.test(value))
        return rules?.message ?? `${field.label} must be a 0x address`
      // EIP-55: a mixed-case address whose checksum doesn't verify is almost always a typo — reject it
      // rather than let it become a permanent owner. All-lowercase/all-uppercase carry no checksum and
      // pass. `isAddress(strict:true)` does the shape + checksum check.
      if (!isAddress(value, { strict: true }))
        return `${field.label} has an invalid checksum — re-paste the exact address`
      break
    }
    case 'number':
    case 'bigint': {
      const n = Number(value)
      if (!Number.isFinite(n)) return rules?.message ?? `${field.label} must be a number`
      if (rules?.min !== undefined && n < rules.min)
        return rules.message ?? `${field.label} must be ≥ ${rules.min}`
      if (rules?.max !== undefined && n > rules.max)
        return rules.message ?? `${field.label} must be ≤ ${rules.max}`
      break
    }
    case 'text':
    case 'textarea': {
      const s = String(value)
      if (rules?.min !== undefined && s.length < rules.min)
        return rules.message ?? `${field.label} must be at least ${rules.min} characters`
      if (rules?.max !== undefined && s.length > rules.max)
        return rules.message ?? `${field.label} must be at most ${rules.max} characters`
      if (rules?.pattern && !new RegExp(rules.pattern).test(s))
        return rules.message ?? `${field.label} is invalid`
      break
    }
    case 'list': {
      const len = Array.isArray(value) ? value.length : 0
      if (rules?.min !== undefined && len < rules.min)
        return rules.message ?? `${field.label} needs at least ${rules.min}`
      if (rules?.max !== undefined && len > rules.max)
        return rules.message ?? `${field.label} allows at most ${rules.max}`
      break
    }
    default:
      break
  }
  return null
}

/** Validate a set of fields against a values bag; returns a map of field.key → error (only failures). */
export function validateFields(
  fields: FieldSchema[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    // Recurse into visible groups so nested required sub-fields are validated too.
    if (field.kind === 'group' && field.fields) {
      if (!isFieldVisible(field, values)) continue
      Object.assign(errors, validateFields(field.fields, values))
      continue
    }
    const err = validateField(field, readValue(values, field.key), values)
    if (err) errors[field.key] = err
  }
  return errors
}
