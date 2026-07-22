import { describe, expect, it } from 'vitest'
import { CONFIG_SCHEMAS, PROJECT_TYPES } from '../wizard'
import { getConcept } from './concepts'
import { MODULE_CONCEPT_BY_CONFIG_TYPE } from './moduleConcepts'

/**
 * COVERAGE guard (noesis-049) — the inverse of `deadLinks.test.ts`.
 *
 * `deadLinks` asserts every wired `learnMore` slug RESOLVES. This asserts the other direction:
 * every decision-bearing wizard surface either carries a resolving `learnMore` OR is on the
 * explicit, commented EXEMPT allowlist below. A new decision field added later with neither fails
 * this test — that is the point: doc coverage cannot silently regress. The allowlist is the
 * contract of what is intentionally undocumented.
 *
 * Surfaces walked:
 *   - each `PROJECT_TYPES` entry's `learnMore` (the standard explainer on the type card)
 *   - each type's top-level `coreFields` and each `moduleSlots` slot
 *   - each `CONFIG_SCHEMAS` module's top-level `fields`
 *   - each `MODULE_CONCEPT_BY_CONFIG_TYPE` mapping (its slug must resolve)
 *
 * Granularity is the top-level field / slot / type. We do NOT recurse into `group.fields` or list
 * `item`s: those are sub-inputs that inherit their parent unit's doc (e.g. the free-mint group
 * carries `free-mint-reserve` for its allocation/scope children). `postCreate` edition / auction-
 * piece fields are out of scope — they are not decision surfaces of the create step.
 */

type Unit = { id: string; learnMore: string | undefined }

function walk(): Unit[] {
  const out: Unit[] = []
  for (const pt of PROJECT_TYPES) {
    out.push({ id: `type:${pt.key}`, learnMore: pt.learnMore })
    for (const f of pt.coreFields) out.push({ id: `${pt.key}.${f.key}`, learnMore: f.learnMore })
    for (const s of pt.moduleSlots)
      out.push({ id: `${pt.key}/slot:${s.key}`, learnMore: s.learnMore })
  }
  for (const cs of CONFIG_SCHEMAS) {
    for (const f of cs.fields)
      out.push({ id: `cfg:${cs.configType}.${f.key}`, learnMore: f.learnMore })
  }
  return out
}

const isDocumented = (u: Unit): boolean =>
  u.learnMore !== undefined && getConcept(u.learnMore) !== undefined

/**
 * Intentionally-undocumented surfaces → WHY. Adding a `learnMore` to any of these would be
 * redundant (its concept is already linked upstream in the same step) or would point at a field
 * that has no dedicated concept. Never add a link to a field with no concept — exempt it here.
 */
const EXEMPT: Record<string, string> = {
  // Trivial / mechanical inputs.
  'erc404.symbol': 'trivial ticker string',
  'erc721.symbol': 'trivial ticker string',
  'erc404.creator':
    'defaults to the connected wallet; the agent-creates-on-your-behalf nuance is the agent-delegation concept, reachable from the /learn index',
  'erc1155.creator': 'defaults to the connected wallet; see agent-delegation via the /learn index',
  'erc721.creator': 'defaults to the connected wallet; see agent-delegation via the /learn index',
  // Raw-URI fields — paste-a-link inputs, no decision to explain.
  'erc404.tokenBaseURI': 'raw URI field',
  'erc404.styleUri': 'raw URI field',
  'erc1155.styleUri': 'raw URI field',
  // Creator carve disclosure — documented inside bonding-curve-graduation (linked from the
  // liquidityDeployer slot in the same step) and by extensive inline help; no dedicated concept and
  // 049 adds none.
  'erc404.declaredMaxAllowanceBps':
    'carve disclosure documented in bonding-curve-graduation (liquidityDeployer slot) + inline help; no dedicated concept',
  // ERC-721 auction mechanics — all explained in the `erc721` standard concept linked from the type
  // card; there is no per-parameter concept.
  'erc721.lines': 'auction mechanics documented in the erc721 standard concept (type-card link)',
  'erc721.baseDuration':
    'auction mechanics documented in the erc721 standard concept (type-card link)',
  'erc721.timeBuffer':
    'auction mechanics documented in the erc721 standard concept (type-card link)',
  'erc721.bidIncrement':
    'auction mechanics documented in the erc721 standard concept (type-card link)',
  // Optional modules with no dedicated concept in the registry (049 adds none).
  'erc404/slot:stakingModule': 'staking module; no dedicated staking concept exists',
  'erc404/slot:resolver':
    'on/off router for the overlay/tier stack; the concepts live on the overlay (metadata-overlay) and tier (tier-reveal) slots it drives',
  // Overlay / tier config fields — the module concept is linked from the matching moduleSlot
  // (overlay→metadata-overlay, tier→tier-reveal); per-knob links would just re-point there.
  'cfg:metadata-overlay.overlayAutoLatest':
    'concept linked from the overlay slot (metadata-overlay)',
  'cfg:metadata-overlay.overlayDefaultPayout':
    'concept linked from the overlay slot (metadata-overlay)',
  'cfg:metadata-tier.tierIdStarts': 'concept linked from the tier slot (tier-reveal)',
  'cfg:metadata-tier.tierIdEnds': 'concept linked from the tier slot (tier-reveal)',
  'cfg:metadata-tier.tierMinBalances': 'concept linked from the tier slot (tier-reveal)',
  'cfg:metadata-tier.tierBaseURIs': 'concept linked from the tier slot (tier-reveal)',
  'cfg:metadata-tier.tierLockedURIs': 'concept linked from the tier slot (tier-reveal)',
}

describe('wizard doc-coverage', () => {
  const all = walk()

  it('every decision surface is documented or explicitly exempt', () => {
    const missing = all.filter((u) => !isDocumented(u) && !(u.id in EXEMPT)).map((u) => u.id)
    expect(
      missing,
      `decision surfaces with no resolving learnMore — wire one, or add to EXEMPT with a reason: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('every wired learnMore resolves to a concept', () => {
    for (const u of all) {
      if (u.learnMore === undefined) continue
      expect(
        getConcept(u.learnMore),
        `unresolved learnMore on ${u.id}: ${u.learnMore}`,
      ).toBeDefined()
    }
  })

  it('no stale exemptions — each EXEMPT id is a real, still-undocumented surface', () => {
    const byId = new Map(all.map((u) => [u.id, u]))
    for (const id of Object.keys(EXEMPT)) {
      const u = byId.get(id)
      expect(u, `EXEMPT lists an unknown surface id (rename/rot?): ${id}`).toBeDefined()
      expect(isDocumented(u!), `EXEMPT id is now documented — drop the exemption: ${id}`).toBe(
        false,
      )
    }
  })

  it('every module-card concept mapping resolves', () => {
    const entries = Object.entries(MODULE_CONCEPT_BY_CONFIG_TYPE)
    expect(entries.length).toBeGreaterThan(0)
    for (const [configType, slug] of entries) {
      expect(
        getConcept(slug),
        `module-card map ${configType} → ${slug} has no concept`,
      ).toBeDefined()
    }
  })
})
