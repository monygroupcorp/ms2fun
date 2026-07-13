/**
 * `/learn` concept registry (spec-launchpad-docs-and-explainers §2.1).
 *
 * A bundled, greppable, diffable content layer for the in-app documentation surface. Concepts are
 * authored as inline TS with Markdown `body` strings (no `.md`/`?raw` imports, no npm markdown dep) and
 * rendered read-only by the injection-proof renderer in `./markdown`.
 *
 * This registry ships EMPTY. Real content lands in 044; the `/learn` route and `learnMore` wiring land
 * in 043. Until then `getConcept` resolves nothing and the dead-link walk over the (slug-free) wizard
 * schemas passes trivially — the guard is in place before the first slug appears.
 */

export interface LearnConcept {
  /** Stable id; used in URLs and `learnMore` refs. MUST equal its key in {@link CONCEPTS}. */
  slug: string
  title: string
  /** One sentence; the docs-page lede. */
  summary: string
  /** Markdown, rendered read-only by the `./markdown` renderer. */
  body: string
  /** Other slugs, for "see also". */
  related?: string[]
}

/**
 * The concept registry, keyed by slug. Empty in this item — 044 fills it.
 *
 * Invariant (asserted in `concepts.test.ts`): for every entry, `entry.slug === key`.
 */
export const CONCEPTS: Record<string, LearnConcept> = {}

/** Pure lookup. Returns `undefined` on miss — never throws. */
export function getConcept(slug: string): LearnConcept | undefined {
  return CONCEPTS[slug]
}
