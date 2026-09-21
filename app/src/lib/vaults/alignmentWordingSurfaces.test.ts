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
 * The claim that must never come back: that the 19% is taken on resales.
 *
 * The five surfaces above were enumerated, and enumeration is why the claim survived: it was
 * deleted from `TokenDetailPage` for naming a royalty the contracts did not implement, and the same
 * sentence sat untouched in the wizard's alignment step and in `lib/learn/concepts.ts` — the two
 * screens a creator actually reads BEFORE deploying — because neither file was on the list. A
 * creator arriving from Manifold or objkt, where a creator-set royalty is table stakes, read "on
 * mint and every resale, 19% of fees route to the community" and had no reason to doubt it.
 *
 * So this one is not a list: no file under `src/` may say it, ever.
 *
 * Note what this does NOT forbid. noesis now implements EIP-2981, so the app is expected to discuss
 * royalties at length — `lib/learn/concepts.ts` has a whole page on them. A royalty is creator-set
 * and creator-paid and has nothing to do with the alignment tithe, which is a contract constant
 * levied on primary settlement. The forbidden thing is narrow and specific: attaching a per-resale
 * levy to the 19%. Saying plainly that a resale pays the community nothing is the fix, not a
 * relapse, so the pattern must keep matching the claim and not the word.
 */
describe('no surface puts the 19% on a resale', () => {
  const RESALE_TITHE_CLAIM = /every\s+resale|on\s+(?:each|every)\s+(?:resale|secondary)/i

  it.each(Object.keys(SOURCE_FILES).filter((p) => !p.endsWith('alignmentWordingSurfaces.test.ts')))(
    '%s',
    (path) => {
      const code = stripComments(SOURCE_FILES[path] ?? '')
      expect(code).not.toMatch(RESALE_TITHE_CLAIM)
    },
  )
})
