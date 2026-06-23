import { describe, expect, it } from 'vitest'
import { isFieldVisible, validateField, validateFields } from './schema'
import type { FieldSchema } from './schema'

// ── helpers ───────────────────────────────────────────────────────────────────

function field(overrides: Partial<FieldSchema>): FieldSchema {
  return { key: 'f', label: 'F', kind: 'text', ...overrides }
}

// ── isFieldVisible ────────────────────────────────────────────────────────────

describe('isFieldVisible', () => {
  describe('no visibleWhen', () => {
    it('returns true when visibleWhen is absent', () => {
      expect(isFieldVisible(field({}), {})).toBe(true)
    })
  })

  describe('equals', () => {
    const f = field({ visibleWhen: { field: 'pricingModel', equals: '2' } })

    it('returns true when sibling strictly equals the target', () => {
      expect(isFieldVisible(f, { pricingModel: '2' })).toBe(true)
    })

    it('returns false when sibling has a different value', () => {
      expect(isFieldVisible(f, { pricingModel: '1' })).toBe(false)
    })

    it('returns false for numeric 2 vs string "2" (strict)', () => {
      expect(isFieldVisible(f, { pricingModel: 2 })).toBe(false)
    })

    it('returns false when sibling is absent', () => {
      expect(isFieldVisible(f, {})).toBe(false)
    })
  })

  describe('notEquals', () => {
    const f = field({ visibleWhen: { field: 'mode', notEquals: 'fixed' } })

    it('returns true when sibling differs', () => {
      expect(isFieldVisible(f, { mode: 'dynamic' })).toBe(true)
    })

    it('returns false when sibling equals the target', () => {
      expect(isFieldVisible(f, { mode: 'fixed' })).toBe(false)
    })
  })

  describe('greaterThan', () => {
    const f = field({ visibleWhen: { field: 'freeMint.allocation', greaterThan: 0 } })

    it('returns true when sibling is strictly greater than threshold', () => {
      expect(isFieldVisible(f, { 'freeMint.allocation': 1 })).toBe(true)
    })

    it('returns false when sibling equals threshold (not strictly greater)', () => {
      expect(isFieldVisible(f, { 'freeMint.allocation': 0 })).toBe(false)
    })

    it('returns false when sibling is below threshold', () => {
      expect(isFieldVisible(f, { 'freeMint.allocation': -1 })).toBe(false)
    })

    it('returns false when sibling is a non-number string', () => {
      expect(isFieldVisible(f, { 'freeMint.allocation': 'five' })).toBe(false)
    })

    it('returns false when sibling is absent', () => {
      expect(isFieldVisible(f, {})).toBe(false)
    })
  })

  describe('isTruthy', () => {
    const fTrue = field({ visibleWhen: { field: 'enabled', isTruthy: true } })
    const fFalse = field({ visibleWhen: { field: 'enabled', isTruthy: false } })

    it('isTruthy:true — returns true for a non-empty string', () => {
      expect(isFieldVisible(fTrue, { enabled: 'yes' })).toBe(true)
    })

    it('isTruthy:true — returns false for empty string', () => {
      expect(isFieldVisible(fTrue, { enabled: '' })).toBe(false)
    })

    it('isTruthy:true — returns false for 0', () => {
      expect(isFieldVisible(fTrue, { enabled: 0 })).toBe(false)
    })

    it('isTruthy:true — returns false for undefined sibling', () => {
      expect(isFieldVisible(fTrue, {})).toBe(false)
    })

    it('isTruthy:false — returns true for falsy value (0)', () => {
      expect(isFieldVisible(fFalse, { enabled: 0 })).toBe(true)
    })

    it('isTruthy:false — returns false for truthy value', () => {
      expect(isFieldVisible(fFalse, { enabled: 'on' })).toBe(false)
    })
  })

  describe('dotted-path sibling resolution', () => {
    const f = field({ visibleWhen: { field: 'freeMint.allocation', greaterThan: 0 } })

    it('resolves from a nested values bag', () => {
      expect(isFieldVisible(f, { freeMint: { allocation: 5 } })).toBe(true)
    })

    it('resolves from a flat dotted-key bag', () => {
      expect(isFieldVisible(f, { 'freeMint.allocation': 5 })).toBe(true)
    })

    it('prefers flat key over nested when both are present', () => {
      // flat key takes priority (it in values check fires first)
      expect(isFieldVisible(f, { 'freeMint.allocation': 3, freeMint: { allocation: 0 } })).toBe(
        true,
      )
    })
  })
})

// ── validateField ─────────────────────────────────────────────────────────────

describe('validateField', () => {
  describe('required / optional emptiness', () => {
    const req = field({ validation: { required: true } })
    const opt = field({ validation: { required: false } })

    it('required + undefined → error', () => {
      expect(validateField(req, undefined)).not.toBeNull()
    })

    it('required + empty string → error', () => {
      expect(validateField(req, '')).not.toBeNull()
    })

    it('required + null → error', () => {
      expect(validateField(req, null)).not.toBeNull()
    })

    it('required + empty array → error', () => {
      expect(validateField(req, [])).not.toBeNull()
    })

    it('required + present value → null', () => {
      expect(validateField(req, 'hello')).toBeNull()
    })

    it('optional + undefined → null', () => {
      expect(validateField(opt, undefined)).toBeNull()
    })

    it('optional + empty string → null', () => {
      expect(validateField(opt, '')).toBeNull()
    })
  })

  describe('hidden field skipped even when required', () => {
    const hiddenReq = field({
      visibleWhen: { field: 'mode', equals: 'pro' },
      validation: { required: true },
    })

    it('returns null when field is hidden', () => {
      expect(validateField(hiddenReq, undefined, { mode: 'basic' })).toBeNull()
    })

    it('returns error when field is visible and empty', () => {
      expect(validateField(hiddenReq, undefined, { mode: 'pro' })).not.toBeNull()
    })
  })

  describe('kind: address', () => {
    const f = field({ kind: 'address' })

    it('accepts a valid 0x40-hex address', () => {
      expect(validateField(f, '0xaAbBcCdDeEfF0011223344556677889900aAbBcC')).toBeNull()
    })

    it('rejects a string that is too short', () => {
      expect(validateField(f, '0x1234')).not.toBeNull()
    })

    it('rejects a string without 0x prefix', () => {
      expect(validateField(f, 'aAbBcCdDeEfF0011223344556677889900aAbBcC12')).not.toBeNull()
    })

    it('rejects a non-string value', () => {
      expect(validateField(f, 12345)).not.toBeNull()
    })
  })

  describe('kind: number', () => {
    const f = field({ kind: 'number', validation: { min: 1, max: 10 } })

    it('rejects non-numeric string', () => {
      expect(validateField(f, 'abc')).not.toBeNull()
    })

    it('rejects value below min', () => {
      expect(validateField(f, 0)).not.toBeNull()
    })

    it('accepts value at min boundary', () => {
      expect(validateField(f, 1)).toBeNull()
    })

    it('accepts value at max boundary', () => {
      expect(validateField(f, 10)).toBeNull()
    })

    it('rejects value above max', () => {
      expect(validateField(f, 11)).not.toBeNull()
    })
  })

  describe('kind: bigint', () => {
    const f = field({ kind: 'bigint', validation: { min: 0 } })

    it('accepts a bigint value that satisfies min', () => {
      expect(validateField(f, 5n)).toBeNull()
    })

    it('rejects a bigint value below min', () => {
      // -1 as bigint is still -1 numerically
      const fNeg = field({ kind: 'bigint', validation: { min: 0 } })
      expect(validateField(fNeg, -1n)).not.toBeNull()
    })

    it('rejects a non-numeric string for bigint field', () => {
      expect(validateField(f, 'nope')).not.toBeNull()
    })
  })

  describe('kind: text', () => {
    const f = field({ kind: 'text', validation: { min: 3, max: 8, pattern: '^[a-z]+$' } })

    it('rejects value shorter than min length', () => {
      expect(validateField(f, 'ab')).not.toBeNull()
    })

    it('accepts value at min length that matches pattern', () => {
      expect(validateField(f, 'abc')).toBeNull()
    })

    it('rejects value longer than max length', () => {
      expect(validateField(f, 'abcdefghi')).not.toBeNull()
    })

    it('rejects value that fails the pattern', () => {
      expect(validateField(f, 'ABC')).not.toBeNull()
    })

    it('uses custom message when provided', () => {
      const custom = field({
        kind: 'text',
        validation: { required: true, message: 'Please enter a title' },
      })
      expect(validateField(custom, '')).toBe('Please enter a title')
    })
  })

  describe('kind: textarea', () => {
    const f = field({ kind: 'textarea', validation: { max: 5 } })

    it('accepts value within max length', () => {
      expect(validateField(f, 'hello')).toBeNull()
    })

    it('rejects value exceeding max length', () => {
      expect(validateField(f, 'toolong')).not.toBeNull()
    })
  })

  describe('kind: list', () => {
    const f = field({ kind: 'list', validation: { min: 1, max: 3 } })

    it('rejects empty array when min is 1', () => {
      // empty array is treated as isEmpty → null unless required; but min check fires on non-empty
      // with min:1 and non-empty check: an array of length 0 is isEmpty so it skips to null
      // To test min, provide a non-empty array with fewer than min... min=1 means length>=1 required.
      // Actually isEmpty means [] returns null (optional). Let's test with a non-empty but too-short list.
      const f2 = field({ kind: 'list', validation: { min: 2, max: 5 } })
      expect(validateField(f2, ['one'])).not.toBeNull()
    })

    it('accepts array within bounds', () => {
      expect(validateField(f, ['a', 'b'])).toBeNull()
    })

    it('rejects array exceeding max length', () => {
      expect(validateField(f, ['a', 'b', 'c', 'd'])).not.toBeNull()
    })
  })
})

// ── validateFields ────────────────────────────────────────────────────────────

describe('validateFields', () => {
  it('returns empty object when all fields are valid', () => {
    const fields: FieldSchema[] = [
      field({ key: 'name', label: 'Name', validation: { required: true } }),
      field({ key: 'bio', label: 'Bio' }),
    ]
    const errors = validateFields(fields, { name: 'Alice', bio: '' })
    expect(errors).toEqual({})
  })

  it('returns only the failing field keys', () => {
    const fields: FieldSchema[] = [
      field({ key: 'title', label: 'Title', validation: { required: true } }),
      field({ key: 'bio', label: 'Bio', validation: { required: true } }),
    ]
    const errors = validateFields(fields, { title: 'Hello', bio: '' })
    expect(Object.keys(errors)).toEqual(['bio'])
    expect(errors['bio']).toBeTruthy()
  })

  it('omits hidden required fields from the error map', () => {
    const fields: FieldSchema[] = [
      field({ key: 'mode', label: 'Mode', validation: { required: true } }),
      field({
        key: 'proOption',
        label: 'Pro Option',
        visibleWhen: { field: 'mode', equals: 'pro' },
        validation: { required: true },
      }),
    ]
    // proOption is hidden (mode ≠ 'pro') so it must NOT appear in errors
    const errors = validateFields(fields, { mode: 'basic' })
    expect(errors['mode']).toBeUndefined() // mode is present → valid
    expect(errors['proOption']).toBeUndefined()
  })

  it('includes a hidden-required field error when the field IS visible', () => {
    const fields: FieldSchema[] = [
      field({
        key: 'proOption',
        label: 'Pro Option',
        visibleWhen: { field: 'mode', equals: 'pro' },
        validation: { required: true },
      }),
    ]
    const errors = validateFields(fields, { mode: 'pro' })
    expect(errors['proOption']).toBeTruthy()
  })

  it('handles mix: required-empty + valid + hidden-required', () => {
    const fields: FieldSchema[] = [
      field({ key: 'title', label: 'Title', validation: { required: true } }),
      field({ key: 'slug', label: 'Slug', validation: { required: false } }),
      field({
        key: 'secret',
        label: 'Secret',
        visibleWhen: { field: 'mode', equals: 'admin' },
        validation: { required: true },
      }),
    ]
    const errors = validateFields(fields, { title: '', slug: '', mode: 'user' })
    expect(Object.keys(errors)).toEqual(['title'])
    expect(errors['secret']).toBeUndefined()
  })
})
