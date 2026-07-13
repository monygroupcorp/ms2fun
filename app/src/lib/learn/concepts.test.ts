import { describe, expect, it } from 'vitest'
import { CONCEPTS, getConcept } from './concepts'

describe('getConcept', () => {
  it('returns undefined for an unknown slug (never throws)', () => {
    expect(getConcept('does-not-exist')).toBeUndefined()
  })

  it('resolves every registered slug to its entry', () => {
    for (const [slug, concept] of Object.entries(CONCEPTS)) {
      expect(getConcept(slug)).toBe(concept)
    }
  })
})

describe('CONCEPTS key/slug invariant', () => {
  // Vacuously true while the registry is empty; guards 044 the moment content lands.
  it('every entry.slug equals its map key', () => {
    for (const [key, concept] of Object.entries(CONCEPTS)) {
      expect(concept.slug).toBe(key)
    }
  })
})
