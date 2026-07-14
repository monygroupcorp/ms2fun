import { describe, it, expect } from 'vitest'
import { getConcept } from './concepts'
import { MODULE_CONCEPT_BY_CONFIG_TYPE, moduleConceptSlug } from './moduleConcepts'

describe('module-card concept map', () => {
  it('every mapped slug resolves to a concept (dead-link guard)', () => {
    const slugs = Object.values(MODULE_CONCEPT_BY_CONFIG_TYPE)
    // Guard the guard: an empty map would make this test prove nothing.
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of slugs) {
      expect(getConcept(slug), `no /learn concept for mapped slug "${slug}"`).toBeDefined()
    }
  })

  it('moduleConceptSlug returns the mapped slug for a known configType', () => {
    expect(moduleConceptSlug('password-tier-gating')).toBe('password-tier-gating')
    expect(moduleConceptSlug('merkle-allowlist-gating')).toBe('merkle-allowlist')
    // Wired in noesis-049 once the concepts landed (046). 'metadata-tier' maps to tier-reveal.
    expect(moduleConceptSlug('metadata-overlay')).toBe('metadata-overlay')
    expect(moduleConceptSlug('metadata-tier')).toBe('tier-reveal')
  })

  it('moduleConceptSlug returns undefined for an unmapped configType', () => {
    expect(moduleConceptSlug('does-not-exist')).toBeUndefined()
  })

  it('moduleConceptSlug returns undefined for undefined input', () => {
    expect(moduleConceptSlug(undefined)).toBeUndefined()
  })
})
