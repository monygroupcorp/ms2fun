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
 * The second ratchet: the two CREATOR-FACING surfaces that state the claim in full prose — the
 * `/learn` concept registry and the launch wizard.
 *
 * These two may spell `19%`: the learn body quotes the whole 1/19/80 law, and the wizard's bind
 * diagram is the number rendered large. What they may NOT do is re-assert the reading the ruling
 * struck out. Both used to say the share was taken "on mint and on every resale", from "fees", on
 * "every launch":
 *
 *   concepts.ts     "On mint and on every resale, 19% of fees route to the community"
 *   WizardPage.tsx  "Every launch routes 19% of its fees … on mint and every resale"
 *
 * Every clause of that is wrong. The base is the sale — `RevenueSplitLib.split` takes the ERC404
 * raise, the ERC1155 withdrawal of mint proceeds, or the ERC721 winning bid — never a fee levied
 * on top of one. The moment differs per standard. And no contract under `contracts/src` takes a
 * share of a resale at all: `royaltyInfo`/ERC-2981 are implemented nowhere, so a resale claim on
 * an edition or an auction had nothing behind it, and on ERC404 the after-market share is the
 * graduated pool's own swap hook rather than anything a marketplace is asked to honour.
 */
const CLAIM_SURFACES = ['/src/lib/learn/concepts.ts', '/src/routes/WizardPage.tsx'] as const

describe('the per-standard alignment claim', () => {
  it.each(CLAIM_SURFACES)('%s exists on disk', (path) => {
    expect(SOURCE_FILES[path], `missing on disk: ${path}`).toBeDefined()
  })

  it.each(CLAIM_SURFACES)('%s takes no share of a resale', (path) => {
    const code = stripComments(SOURCE_FILES[path] ?? '')
    expect(code).not.toMatch(/every resale/i)
    expect(code).not.toMatch(/\d+% of (every |each |the )?resale/i)
    expect(code).not.toMatch(/on mint and/i)
  })

  it.each(CLAIM_SURFACES)('%s does not call the base a fee', (path) => {
    const code = stripComments(SOURCE_FILES[path] ?? '')
    expect(code).not.toMatch(/\d+% of (every |each |the )?(collection'?s? )?fees?/i)
    expect(code).not.toMatch(/routes? .{0,20}\d+% of its fees/i)
  })

  it.each(CLAIM_SURFACES)('%s says the royalty no out loud', (path) => {
    const src = SOURCE_FILES[path] ?? ''
    // The learn body writes it; the wizard draws `NO_ROYALTY_SENTENCE` from `alignmentWording`.
    expect(src).toMatch(/NO_ROYALTY_SENTENCE|no secondary royalty|no royalty field/i)
  })
})

/**
 * The third ratchet: the ERC-404 after-market claim is READ, never written down.
 *
 * The sentence the earlier pass left behind was true but conditional — the graduated pool "can
 * carry" a hook that taxes every swap — and it was conditional only because the app never asked.
 * `LiquidityDeployerModule.alignmentHookFactory()` is the switch and `hookFeeBips()` is the rate,
 * both public getters, both on the module the wizard has already selected. So the copy is a
 * function of what that module says, and these assertions stop it drifting back into either a
 * hedge or a hardcoded number:
 *
 *  - `alignmentWording.ts` must not spell a swap-tithe percentage of its own. The rate is
 *    owner-set on-chain (`setHookFeeBips`); a literal here is a number that goes stale silently
 *    and is read by a creator sizing a decision.
 *  - `WizardPage.tsx` must draw `swapTitheSentence`, so the branch that renders nothing at all —
 *    read in flight, or read failed — stays reachable from the surface.
 */
describe('the ERC-404 swap tithe is read off the deployer', () => {
  const WORDING = '/src/lib/vaults/alignmentWording.ts'
  const WIZARD = '/src/routes/WizardPage.tsx'

  it('states no swap-tithe percentage of its own — the rate is owner-set on-chain', () => {
    const code = stripComments(SOURCE_FILES[WORDING] ?? '')
    expect(code).not.toMatch(/\d+(\.\d+)?%\s+of the ETH/i)
  })

  it('does not hedge the tithe into a "can carry" — the deployer answers it outright', () => {
    const code = stripComments(SOURCE_FILES[WORDING] ?? '')
    expect(code).not.toMatch(/(can|may|could|might)\s+carry/i)
  })

  it('leaves ERC-404 with no fixed after-market string to drift', () => {
    const code = stripComments(SOURCE_FILES[WORDING] ?? '')
    expect(code).toMatch(/erc404:\s*null/)
  })

  it('has the wizard draw the tri-state rather than write a claim of its own', () => {
    const src = SOURCE_FILES[WIZARD] ?? ''
    expect(src).toMatch(/swapTitheSentence/)
    expect(src).toMatch(/useSwapTithe/)
  })

  // The silent branches only stay silent if the surface GUARDS the render. An unguarded
  // `{swapTitheSentence(...)}` would put a bare `null` in the tree — harmless — but the guard is
  // also what keeps the paragraph element itself from being emitted empty, and it is the line a
  // later edit is most likely to drop.
  it('renders the tithe paragraph only when there is a sentence to put in it', () => {
    const src = SOURCE_FILES[WIZARD] ?? ''
    expect(src).toMatch(/\{titheSentence && </)
  })

  it('has the wizard spell no swap-tithe percentage either', () => {
    const code = stripComments(SOURCE_FILES[WIZARD] ?? '')
    expect(code).not.toMatch(/\d+(\.\d+)?%\s+of the ETH/i)
  })
})
