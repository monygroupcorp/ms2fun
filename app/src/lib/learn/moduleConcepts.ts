/**
 * Module-card → /learn concept bridge (noesis-047).
 *
 * A module card's blurb is parsed from on-chain metadata (`ComponentModuleMeta`), so the only
 * stable per-module key is its `configType` string. This static map bridges that key to a
 * concept slug in the /learn registry, letting each card carry a "Learn how this works" link.
 *
 * Map ONLY configTypes whose concept EXISTS in `CONCEPTS` today — a slug with no concept would
 * render a dead link. The concepts.test dead-link guard asserts every slug here resolves.
 *
 * A configType with no mapping renders no card link — graceful, never a dead link.
 */

export const MODULE_CONCEPT_BY_CONFIG_TYPE: Record<string, string> = {
  'password-tier-gating': 'password-tier-gating',
  'merkle-allowlist-gating': 'merkle-allowlist',
  // Wired once noesis-046 landed the concepts (contract-verified).
  'metadata-overlay': 'metadata-overlay',
  'metadata-tier': 'tier-reveal', // configType 'metadata-tier' → the tier-reveal concept (NOT tier-upgrade)
}

/** Concept slug for a module `configType`, or undefined if unmapped (→ no card link). */
export function moduleConceptSlug(configType: string | undefined): string | undefined {
  if (configType === undefined) return undefined
  return MODULE_CONCEPT_BY_CONFIG_TYPE[configType]
}
