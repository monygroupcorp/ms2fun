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

/**
 * The surfaces that are not TypeScript.
 *
 * `index.html` is the social preview — the meta, og: and twitter: descriptions, which are the first
 * sentence a stranger reads about noesis and the only copy a scraper ever sees, since this is a
 * serverless SPA and no route renders its own card. It shipped "a fixed share of every fee" on all
 * three tags, a base that is a fee on no family, and every ratchet in this file was blind to it:
 * they glob `/src/**` and the defect was one directory up. A ban that can only see the language it
 * was written in is not a ban on what a person reads.
 */
const MARKUP_FILES = import.meta.glob('/index.html', {
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
 * in a URL from eating the rest of its line, and `<!-- -->` is stripped for the same reason the
 * other two forms are: `index.html` carries the note explaining why its card names no source, and
 * that note has to be able to quote the sentence it replaced.
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
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

  // "every fee", "every resale" and "every mint" used to be banned HERE, on these four files. They
  // are not a property of these four files — the base is never a fee on any family, the bind lands
  // at graduation, edition mint or auction close depending on the standard, and no contract under
  // `contracts/src` takes a share of a resale at all — so they belong in the derived ban below,
  // which holds every shipped surface rather than a list written in 2026-09. What stays here is
  // "Fee split", which is a LABEL rather than a reading: the landing ledger's row heading, wrong
  // only on a surface that spans families, and legitimate prose elsewhere.
  it.each(WORDING_SURFACES)('%s labels no "Fee split" outside a comment', (path) => {
    const code = stripComments(SOURCE_FILES[path] ?? '')
    expect(code).not.toMatch(/Fee split/i)
  })
})

/**
 * The struck-out readings, banned EVERYWHERE rather than on a list of files.
 *
 * The creator-facing claim used to be spelled out on two surfaces, and both said the share was
 * taken "on mint and on every resale", from "fees", on "every launch":
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
 *
 * A ban that names its files by hand only holds the files it was written against, and prose moves.
 * When the wizard's copy was lifted into `lib/vaults/alignmentWording.ts` the sentences kept their
 * meaning and lost their guard: the same struck-out claim, retyped in the new home, would have gone
 * in green. So the ban is derived — every shipped source under `src/` is scanned, and the list of
 * what may not be said is the list that is maintained. Tests are excluded because these very
 * patterns are written out here as pattern literals.
 */
const TEST_FILE = /\.test\.tsx?$|(^|\/)__tests__\//

/**
 * Every shipped surface the claim could move into — derived, so moving prose cannot escape it, and
 * spanning markup as well as source so it cannot escape by changing language either.
 */
const SHIPPED_FILES: Record<string, string> = { ...SOURCE_FILES, ...MARKUP_FILES }
const SHIPPED_SOURCES = Object.keys(SHIPPED_FILES)
  .filter((path) => !TEST_FILE.test(path))
  .sort()

/**
 * A share word, then `base`, inside one sentence — the shape of asserting what the 19% comes out
 * of. Every struck sentence this file records is built that way: "19% of every fee routes to…",
 * "a fixed share of every fee to the communities…", "19% of fees route to the community on every
 * mint".
 */
function SHARE_OF(base: RegExp): RegExp {
  return new RegExp(
    `(\\d+\\s*%|\\bshare\\b|\\bcut\\b|\\bportion\\b|\\bpercentage\\b)[^.!?]{0,60}${base.source}`,
    'i',
  )
}

/** The readings the ruling struck out. None of them is true of any family, on any surface. */
const STRUCK_READINGS = [
  ['takes a share of every resale', /every resale/i],
  ['takes a percentage of a resale', /\d+% of (every |each |the )?resale/i],
  ['splits the moment across mint and something else', /on mint and/i],
  ['calls the base a fee', /\d+% of (every |each |the )?(collection'?s? )?fees?/i],
  // Moved off the four-file list 2026-09-24. Reachable there: the phrase typed into a component
  // that was on no list passed all 34 tests. Neither reading is true of any family — the 19% comes
  // out of the SALE (the ERC-404 raise, an ERC-1155 withdrawal of mint proceeds, an ERC-721 winning
  // bid) and never out of a fee levied on top of one, and only the edition standard settles at mint
  // at all. Both bans are universal in the same way "every resale" already was.
  //
  // What is struck is a SHARE whose base is every fee or every mint, not the bare words. Going
  // derived found that out immediately: the ERC-1155 creator panel hints "sweep every fee bucket in
  // one transaction" about `claimAllFees()`, which is honest prose about a different mechanism
  // entirely. A ban that reds that is a ban the next author routes around, and a guard nobody
  // trusts stops being read. The `[^.!?]` window keeps the two halves inside one sentence.
  ['makes every fee the base of a share', SHARE_OF(/every\s+fees?\b/)],
  ['makes every mint the moment of a share', SHARE_OF(/every\s+mint\b/)],
  ['has a launch route a share of its fees', /routes? .{0,20}\d+% of its fees/i],
] as const

describe('no shipped source re-asserts a struck-out reading', () => {
  it('has sources to scan', () => {
    // Guards the glob itself: an empty set would pass every ban below without reading anything.
    expect(SHIPPED_SOURCES.length).toBeGreaterThan(50)
    expect(SHIPPED_SOURCES).toContain('/src/lib/vaults/alignmentWording.ts')
    // Named explicitly: if the markup glob ever resolves to nothing the scan above still passes,
    // and the surface this ratchet was extended to cover would go unread in green.
    expect(SHIPPED_SOURCES).toContain('/index.html')
  })

  it.each(STRUCK_READINGS)('no file %s', (_reading, pattern) => {
    const offenders = SHIPPED_SOURCES.filter((path) =>
      pattern.test(stripComments(SHIPPED_FILES[path] ?? '')),
    )
    expect(offenders, `struck-out reading ${String(pattern)} is back`).toEqual([])
  })
})

/**
 * The surfaces that state the claim in full prose, and their POSITIVE obligations — the ones a
 * derived ban cannot express: the `/learn` concept registry, the launch wizard, and the wording
 * module the other two draw from.
 *
 * These three may spell `19%`: the learn body quotes the whole 1/19/80 law, the wizard's bind
 * diagram is the number rendered large, and the wording module is where the number lives. What
 * they owe in exchange is the royalty no, said out loud, at the place a creator is deciding.
 */
const CLAIM_SURFACES = [
  '/src/lib/vaults/alignmentWording.ts',
  '/src/lib/learn/concepts.ts',
  '/src/routes/WizardPage.tsx',
] as const

describe('the per-standard alignment claim', () => {
  it.each(CLAIM_SURFACES)('%s exists on disk', (path) => {
    expect(SOURCE_FILES[path], `missing on disk: ${path}`).toBeDefined()
  })

  it.each(CLAIM_SURFACES)('%s says the royalty no out loud', (path) => {
    const src = SOURCE_FILES[path] ?? ''
    // The wording module writes it; the learn body quotes it; the wizard draws
    // `NO_ROYALTY_SENTENCE` from `alignmentWording`.
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

/**
 * The social preview's own obligation, which a ban cannot state.
 *
 * `index.html` carries the claim three times — `name="description"`, `og:description`,
 * `twitter:description` — because a serverless SPA renders no card per route and a scraper runs no
 * JS, so these three static tags are the whole of what a stranger is shown. Three copies of one
 * sentence is three chances to correct two of them, which is how the card ends up telling a
 * scraper on one network something it does not tell a scraper on another. So the requirement is not
 * only that the sentence be true: it is that there be ONE of it.
 */
describe('the social preview states one claim', () => {
  const INDEX = '/index.html'

  /** Every `content=` on a tag whose name or property ends in `description`. */
  function descriptions(markup: string): string[] {
    const tags = markup.match(/<meta\b[\s\S]*?\/?>/g) ?? []
    return tags
      .filter((tag) => /(?:name|property)="[^"]*description"/.test(tag))
      .map((tag) => tag.match(/content="([^"]*)"/)?.[1] ?? '')
  }

  it('has the three description tags this file expects to find', () => {
    expect(descriptions(MARKUP_FILES[INDEX] ?? '')).toHaveLength(3)
  })

  it('says the same thing on all three', () => {
    const [first, ...rest] = descriptions(MARKUP_FILES[INDEX] ?? '')
    expect(first).not.toBe('')
    for (const other of rest) expect(other).toBe(first)
  })

  it('states the ratio and names no source for it', () => {
    const [claim] = descriptions(MARKUP_FILES[INDEX] ?? '')
    // The ratio is the one part that is invariant across the three standards, so it is the one part
    // a family-blind surface may assert.
    expect(claim).toContain('19%')
    // The base is not. `alignmentWording.ts` documents why per standard; the derived ban above
    // catches the specific readings, and this catches the shape of naming a base at all.
    expect(claim).not.toMatch(/\bof (every |each |the )?(fee|sale|mint|resale|trade|swap)/i)
  })
})

/**
 * The ban's own proof.
 *
 * A derived ban goes green two ways: because nothing says the struck thing, or because the pattern
 * no longer matches it. Those are indistinguishable from the scan result, and the second one is
 * silent — this is the file whose whole subject is a guard that held four files and missed the
 * fifth. So every reading is driven against the sentence it was written for, and against the
 * honest prose nearby that it must not red.
 */
describe('each struck reading still catches what struck it', () => {
  const STRUCK_IN_THE_WILD: ReadonlyArray<readonly [string, string]> = [
    ['takes a share of every resale', '19% of every resale routes to the community'],
    ['takes a percentage of a resale', 'the creator keeps 81% of each resale'],
    ['splits the moment across mint and something else', 'On mint and on every resale, 19% routes'],
    ['calls the base a fee', "19% of every collection's fees route to a vault"],
    [
      'has a launch route a share of its fees',
      'Every launch routes 19% of its fees to a community',
    ],
    ['makes every fee the base of a share', 'route a fixed share of every fee to the communities'],
    ['makes every mint the moment of a share', '19% of fees route to the community on every mint'],
  ]

  it('drives every reading in the list', () => {
    // The two lists are matched by reading name, so a reading added above with no sentence here
    // fails rather than shipping unproven.
    expect(STRUCK_IN_THE_WILD.map(([name]) => name).sort()).toEqual(
      STRUCK_READINGS.map(([name]) => name).sort(),
    )
  })

  it.each(STRUCK_IN_THE_WILD)('%s is caught', (name, sentence) => {
    const reading = STRUCK_READINGS.find(([n]) => n === name)
    expect(reading, `no reading named ${name}`).toBeDefined()
    expect(reading?.[1].test(sentence), `${name} no longer catches: ${sentence}`).toBe(true)
  })

  /**
   * Prose that lives in the tree today and is not the claim. `claimAllFees()` sweeps fee buckets on
   * a collection the creator owns; it is a different mechanism from the alignment split and it is
   * allowed to say so.
   */
  const HONEST_NEARBY = [
    'sweep every fee bucket in one transaction',
    'sweep every fee bucket at once',
    'every mint is recorded on-chain',
  ] as const

  it.each(HONEST_NEARBY)('honest prose is left alone: %s', (sentence) => {
    const offenders = STRUCK_READINGS.filter(([, pattern]) => pattern.test(sentence))
    expect(
      offenders.map(([name]) => name),
      `reds honest prose: ${sentence}`,
    ).toEqual([])
  })
})
