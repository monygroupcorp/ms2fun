import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMAS, PROJECT_TYPES, type FieldSchema } from '../wizard'
import { getConcept } from './concepts'

/**
 * The load-bearing dead-link guard: every `learnMore` slug referenced anywhere in the wizard schemas
 * MUST resolve to a registered concept. `learnMore` is not on `FieldSchema`/`ModuleSlot` yet (043 adds
 * it), so we read it structurally and the walk finds zero slugs today — passing trivially. It stays
 * correct once slugs appear because it walks the REAL exported schemas, hardcoding nothing.
 */
function learnMoreOf(x: unknown): string | undefined {
  const v = (x as { learnMore?: unknown }).learnMore
  return typeof v === 'string' ? v : undefined
}

function slugsFromFields(fields: FieldSchema[]): string[] {
  const out: string[] = []
  for (const f of fields) {
    const s = learnMoreOf(f)
    if (s) out.push(s)
    if (f.fields) out.push(...slugsFromFields(f.fields))
    if (f.item) out.push(...slugsFromFields([f.item]))
  }
  return out
}

function collectAllSlugs(): string[] {
  const slugs: string[] = []
  for (const pt of PROJECT_TYPES) {
    slugs.push(...slugsFromFields(pt.coreFields))
    if (pt.postCreate) slugs.push(...slugsFromFields(pt.postCreate.fields))
    for (const slot of pt.moduleSlots) {
      const s = learnMoreOf(slot)
      if (s) slugs.push(s)
    }
  }
  for (const cs of CONFIG_SCHEMAS) {
    slugs.push(...slugsFromFields(cs.fields))
  }
  return slugs
}

describe('wizard learnMore dead-link walk', () => {
  it('every learnMore slug on any schema resolves to a registered concept', () => {
    for (const slug of collectAllSlugs()) {
      expect(getConcept(slug), `unregistered learnMore slug: ${slug}`).toBeDefined()
    }
  })
})
