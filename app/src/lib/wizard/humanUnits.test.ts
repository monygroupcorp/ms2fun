import { describe, expect, it } from 'vitest'
import type { FieldSchema } from './schema'
import { PROJECT_TYPES } from './projectTypes'
import { CONFIG_SCHEMAS } from './configTypes'

// noesis-131 — every user-facing amount input is entered in a HUMAN unit (ETH for prices/bids, whole
// tokens for balances) and scaled to exact wei only at encode. Raw-wei input is forbidden: a creator
// must never type `10000000000000000000` for "10". This walks EVERY field descriptor the wizard
// renders and asserts none advertises `unit: 'wei'`.

/** Flatten a field tree (groups + list items) into a flat list of every descriptor. */
function flatten(fields: FieldSchema[]): FieldSchema[] {
  const out: FieldSchema[] = []
  for (const f of fields) {
    out.push(f)
    if (f.fields) out.push(...flatten(f.fields))
    if (f.item) out.push(...flatten([f.item]))
  }
  return out
}

function allFields(): FieldSchema[] {
  const out: FieldSchema[] = []
  for (const pt of PROJECT_TYPES) {
    out.push(...flatten(pt.coreFields))
    if (pt.postCreate) out.push(...flatten(pt.postCreate.fields))
  }
  for (const cfg of CONFIG_SCHEMAS) out.push(...flatten(cfg.fields))
  return out
}

describe('humanized amount units (noesis-131)', () => {
  it('no user-facing field advertises unit: "wei"', () => {
    const weiFields = allFields().filter((f) => f.unit === 'wei')
    expect(weiFields.map((f) => f.key)).toEqual([])
  })

  it('the known amount fields are relabeled to human units', () => {
    const byKey = new Map(allFields().map((f) => [f.key, f]))
    expect(byKey.get('basePrice')?.unit).toBe('eth')
    expect(byKey.get('bidIncrement')?.unit).toBe('eth')
    expect(byKey.get('minBid')?.unit).toBe('eth')
    expect(byKey.get('tierMinBalance')?.unit).toBe('tokens')
  })
})
