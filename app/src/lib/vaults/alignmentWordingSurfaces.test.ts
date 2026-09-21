/**
 * The ratchet behind the 19% wording: the number and the sentence live in `alignmentWording.ts`,
 * and every surface that states them DRAWS them.
 *
 * Five sites outside the two vault pages used to hand-write the claim, and each one picked a source
 * the contracts do not support on every family:
 *
 *   CollectionHero.tsx        "19% of fees route to the community on every mint"
 *   AlignmentTargetPicker.tsx "19% of every collection's fees route to a vault…"
 *   HomePage.tsx (hero)       "19% of every fee routes to the work that inspired you"
 *   HomePage.tsx (ledger)     a "Fee split" row
 *   TokenDetailPage.tsx       "19% of every resale routes to…"
 *
 * On an endowment-aligned collection the flow is YIELD on a corpus rather than fees, and the resale
 * claim has no implementation anywhere: `royaltyInfo`/ERC2981 appear in no file under
 * `contracts/src`. None of these surfaces can tell the families apart either — `ProjectCard` carries
 * `vault`/`vaultName` and no `vaultType()` — so each was asserting one family's reading over all of
 * them, blind.
 *
 * Asserted on the SOURCE rather than on rendered output because that is where the defect lives: a
 * render test pins the sentence a surface happens to show today, and says nothing about the next
 * surface that writes its own. A literal `19%` outside a comment in one of these files means the
 * number has been re-typed, which is the drift itself.
 */
import { describe, expect, it } from 'vitest'

// Project-root relative keys (project root = `app/`), read raw. Same approach as
// `components/ui/moneySurfaces.test.ts`: `import.meta.glob` keeps this inside the app's
// browser-target tsconfig, which configures no `node:fs` types.
const SOURCE_FILES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The surfaces clause 28 names. The two vault pages landed earlier and are covered separately. */
const WORDING_SURFACES = [
  '/src/components/collection/CollectionHero.tsx',
  '/src/components/wizard/AlignmentTargetPicker.tsx',
  '/src/routes/HomePage.tsx',
  '/src/routes/TokenDetailPage.tsx',
] as const

/**
 * Comments are where a surface is allowed to quote the wrong sentence it replaced — that history is
 * worth keeping next to the fix. Only code and JSX text are scanned. The `[^:]` guard keeps `://`
 * in a URL from eating the rest of its line.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('the 19% surfaces draw their wording', () => {
  it.each(WORDING_SURFACES)('%s exists on disk', (path) => {
    expect(SOURCE_FILES[path], `missing on disk: ${path}`).toBeDefined()
  })

  it.each(WORDING_SURFACES)('%s imports from lib/vaults/alignmentWording', (path) => {
    const src = SOURCE_FILES[path] ?? ''
    expect(src).toMatch(/from\s+'[^']*lib\/vaults\/alignmentWording'/)
  })

  it.each(WORDING_SURFACES)('%s spells no 19% of its own outside a comment', (path) => {
    const code = stripComments(SOURCE_FILES[path] ?? '')
    expect(code).not.toContain('19%')
  })

  it.each(WORDING_SURFACES)('%s claims no source for the 19% outside a comment', (path) => {
    const code = stripComments(SOURCE_FILES[path] ?? '')
    // "every fee" / "every resale" / "every mint" / "Fee split" — the four readings that were each
    // true of at most one family, or of none.
    expect(code).not.toMatch(/every\s+(fee|resale|mint)/i)
    expect(code).not.toMatch(/Fee split/i)
  })
})

/**
 * The resale claim, ratcheted across the WHOLE app rather than a list.
 *
 * The five surfaces above were enumerated, and enumeration is why the claim survived: it was
 * deleted from `TokenDetailPage` for naming a royalty the contracts do not implement, and the same
 * sentence sat untouched in `lib/learn/concepts.ts` — the long-form explainer a creator reads
 * BEFORE deploying — because that file was not on the list. A creator arriving from Manifold or
 * objkt, where a creator-set royalty is table stakes, read "on every resale, 19% of fees route to
 * the community" and had no reason to doubt it.
 *
 * So this one is not a list. No file under `src/` may claim a resale leg outside a comment, for as
 * long as `royaltyInfo`/ERC-2981 appear nowhere in `contracts/src`. The day a royalty standard
 * lands, this test is what has to be rewritten to describe it — deliberately, by the change that
 * implements it, and not by a surface that assumed it.
 */
describe('no surface claims a resale leg the contracts do not implement', () => {
  const RESALE_CLAIM =
    /every\s+resale|on\s+(?:each|every)\s+(?:resale|secondary)|royalt(?:y|ies)\s+(?:of|route|pay)/i

  it.each(Object.keys(SOURCE_FILES).filter((p) => !p.endsWith('alignmentWordingSurfaces.test.ts')))(
    '%s',
    (path) => {
      const code = stripComments(SOURCE_FILES[path] ?? '')
      expect(code).not.toMatch(RESALE_CLAIM)
    },
  )
})
