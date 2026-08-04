import { describe, expect, it } from 'vitest'
import {
  EMPTY_METADATA_CONFIG,
  encodeMetadataConfig,
  encodeTiers,
  hasMetadataConfig,
  tierSupplySummary,
  validateMetadataConfig,
} from './metadataConfig'
import { ZERO_ADDRESS } from './submit'

const RESOLVER = '0x1111111111111111111111111111111111111111' as const
const OVERLAY = '0x2222222222222222222222222222222222222222' as const
const TIER = '0x3333333333333333333333333333333333333333' as const

// A two-row, ascending, non-overlapping tier table.
const TWO_ROWS = {
  'tierIdStarts.0': '1',
  'tierIdEnds.0': '5',
  'tierMinBalances.0': '1', // 1 whole token → 1e18 wei
  'tierBaseURIs.0': 'rare-',
  'tierLockedURIs.0': 'locked-',
  'tierIdStarts.1': '6',
  'tierIdEnds.1': '10',
  'tierMinBalances.1': '5', // 5 whole tokens → 5e18 wei
  'tierBaseURIs.1': 'legend-',
  'tierLockedURIs.1': '',
}

// ── encodeTiers ────────────────────────────────────────────────────────────────

describe('encodeTiers', () => {
  it('zips the parallel lists into Tier rows in order', () => {
    const tiers = encodeTiers(TWO_ROWS)
    expect(tiers).toHaveLength(2)
    expect(tiers[0]).toEqual({
      idStart: 1n,
      idEnd: 5n,
      minBalance: 1000000000000000000n,
      baseURI: 'rare-',
      lockedURI: 'locked-',
    })
    expect(tiers[1]?.baseURI).toBe('legend-')
    expect(tiers[1]?.lockedURI).toBe('') // empty locked URI is allowed (falls through to base)
  })

  it('drops rows whose start id is blank (half-filled trailing row)', () => {
    const tiers = encodeTiers({
      'tierIdStarts.0': '1',
      'tierIdEnds.0': '5',
      'tierBaseURIs.0': 'a-',
      'tierIdStarts.1': '', // blank start → whole row dropped
      'tierBaseURIs.1': 'orphan',
    })
    expect(tiers).toHaveLength(1)
    expect(tiers[0]?.baseURI).toBe('a-')
  })

  it('coerces garbage numerics to 0n rather than throwing', () => {
    const tiers = encodeTiers({ 'tierIdStarts.0': '1', 'tierMinBalances.0': 'NaN' })
    expect(tiers[0]?.minBalance).toBe(0n)
  })

  it('scales human whole-token min balances to exact 18-decimal wei', () => {
    const min = (v: string): bigint =>
      encodeTiers({ 'tierIdStarts.0': '1', 'tierMinBalances.0': v })[0]!.minBalance
    expect(min('1')).toBe(10n ** 18n) // 1 token
    expect(min('1000')).toBe(1000n * 10n ** 18n) // 1000 tokens
    expect(min('0.5')).toBe(500000000000000000n) // fractional token
    expect(min('')).toBe(0n) // blank → 0
  })
})

// ── encodeMetadataConfig ─────────────────────────────────────────────────────

describe('encodeMetadataConfig', () => {
  it('router + both children → ordered [overlay, tier] precedence', () => {
    const cfg = encodeMetadataConfig({ resolver: RESOLVER, overlay: OVERLAY, tier: TIER }, TWO_ROWS)
    expect(cfg.resolver).toBe(RESOLVER)
    expect(cfg.childResolvers).toEqual([OVERLAY, TIER])
    expect(cfg.overlay).toBe(OVERLAY)
    expect(cfg.tier).toBe(TIER)
    expect(cfg.tiers).toHaveLength(2)
    expect(hasMetadataConfig(cfg)).toBe(true)
  })

  it('single child, no router → points directly at the module, empty children', () => {
    const cfg = encodeMetadataConfig({ tier: TIER }, TWO_ROWS)
    expect(cfg.resolver).toBe(TIER)
    expect(cfg.childResolvers).toEqual([])
    expect(cfg.tier).toBe(TIER)
    expect(hasMetadataConfig(cfg)).toBe(true)
  })

  it('two children but no router → feature off (resolver zero); validation flags it', () => {
    const cfg = encodeMetadataConfig({ overlay: OVERLAY, tier: TIER }, TWO_ROWS)
    expect(cfg.resolver).toBe(ZERO_ADDRESS)
    expect(hasMetadataConfig(cfg)).toBe(false)
  })

  it('nothing selected → empty config', () => {
    const cfg = encodeMetadataConfig({}, {})
    expect(cfg).toEqual(EMPTY_METADATA_CONFIG)
    expect(hasMetadataConfig(cfg)).toBe(false)
  })

  it('overlay flags: autoLatest + SPLIT payout', () => {
    const cfg = encodeMetadataConfig(
      { overlay: OVERLAY },
      { overlayAutoLatest: 'true', overlayDefaultPayout: '1' },
    )
    expect(cfg.autoLatest).toBe(true)
    expect(cfg.defaultPayout).toBe(1)
  })

  it('overlay flags default to false / ARTIST payout', () => {
    const cfg = encodeMetadataConfig({ overlay: OVERLAY }, {})
    expect(cfg.autoLatest).toBe(false)
    expect(cfg.defaultPayout).toBe(0)
  })

  it('tiers are only encoded when the tier module is selected', () => {
    const cfg = encodeMetadataConfig({ overlay: OVERLAY }, TWO_ROWS)
    expect(cfg.tiers).toEqual([]) // no tier module → table ignored
  })

  it('treats an explicit ZERO_ADDRESS selection as not selected', () => {
    const cfg = encodeMetadataConfig({ resolver: ZERO_ADDRESS, tier: TIER }, TWO_ROWS)
    expect(cfg.resolver).toBe(TIER) // resolver was zero → single-module direct pointer
  })
})

// ── validateMetadataConfig ───────────────────────────────────────────────────

describe('validateMetadataConfig', () => {
  it('passes a well-formed router + overlay + tier stack', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, overlay: OVERLAY, tier: TIER },
      TWO_ROWS,
    )
    expect(errs).toEqual({})
  })

  it('flags two children with no router', () => {
    const errs = validateMetadataConfig({ overlay: OVERLAY, tier: TIER }, TWO_ROWS)
    expect(errs['resolver']).toMatch(/router/i)
  })

  it('flags a router with no children to stack', () => {
    const errs = validateMetadataConfig({ resolver: RESOLVER }, {})
    expect(errs['resolver']).toMatch(/no overlay or tier/i)
  })

  it('flags a tier module selected with an empty table', () => {
    const errs = validateMetadataConfig({ tier: TIER }, {})
    expect(errs['tierIdStarts']).toMatch(/at least one tier/i)
  })

  it('flags end id below start id', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '5', 'tierIdEnds.0': '2', 'tierBaseURIs.0': 'r-' },
    )
    expect(errs['tierIdEnds.0']).toMatch(/≥ start id/)
  })

  it('flags overlapping / non-ascending ranges', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '1',
        'tierIdEnds.0': '5',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '5', // overlaps prev end
        'tierIdEnds.1': '9',
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs['tierIdStarts.1']).toMatch(/ascending/i)
  })

  it('does NOT require a revealed (base) URI — consistent with the optional main collection URI', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '1', 'tierIdEnds.0': '3' },
    )
    expect(errs['tierBaseURIs.0']).toBeUndefined()
  })

  it('accepts adjacent non-overlapping ranges (start == prevEnd + 1)', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '1',
        'tierIdEnds.0': '5',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '6',
        'tierIdEnds.1': '9',
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs).toEqual({})
  })

  // ── supply (nftCount) range validation (noesis-133) ──────────────────────────

  // rth's canonical case: supply 4400, one tier covering 4001–4400 (400 rare ids) → in range.
  const T4400 = { 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400', 'tierBaseURIs.0': 'rare-' }

  it('passes a tier range that ends exactly at nftCount (4001–4400 ⊆ 4400)', () => {
    const errs = validateMetadataConfig({ tier: TIER }, T4400, 4400n)
    expect(errs).toEqual({})
  })

  it('flags a tier end id past nftCount with the specific supply message', () => {
    const errs = validateMetadataConfig({ tier: TIER }, T4400, 4000n)
    expect(errs['tierIdEnds.0']).toBe(
      'tier 1: end id 4400 exceeds NFT supply 4000 — raise supply or lower the range',
    )
  })

  it('flags a start id below 1', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '0', 'tierIdEnds.0': '5', 'tierBaseURIs.0': 'r-' },
      4400n,
    )
    expect(errs['tierIdStarts.0']).toMatch(/start id must be ≥ 1/)
  })

  it('skips the ⊆-supply check when nftCount is 0/empty (do not false-error pre-supply)', () => {
    // Same range that would exceed a 4000 supply, but with supply unknown → no supply error.
    const errs = validateMetadataConfig({ tier: TIER }, T4400, 0n)
    expect(errs).toEqual({})
    // Default arg (no nftCount) behaves the same as 0n.
    expect(validateMetadataConfig({ tier: TIER }, T4400)).toEqual({})
  })

  it('flags only the offending row when a later tier exceeds supply', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '1',
        'tierIdEnds.0': '100',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '101',
        'tierIdEnds.1': '5000', // past supply
        'tierBaseURIs.1': 'b-',
      },
      4000n,
    )
    expect(errs['tierIdEnds.0']).toBeUndefined()
    expect(errs['tierIdEnds.1']).toMatch(/exceeds NFT supply 4000/)
  })
})

// ── tierSupplySummary ────────────────────────────────────────────────────────

describe('tierSupplySummary', () => {
  it('no tiers → all-untiered, within supply, no coverage', () => {
    const s = tierSupplySummary({}, 4400n)
    expect(s).toEqual({
      nftCount: 4400n,
      supplyKnown: true,
      hasTiers: false,
      minId: 0n,
      maxId: 0n,
      tierIdCount: 0n,
      untieredCount: 4400n,
      withinSupply: true,
    })
  })

  it('4,400 case: 4000 base + 400 tier (4001–4400) → within supply', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 4400n)
    expect(s.hasTiers).toBe(true)
    expect(s.minId).toBe(4001n)
    expect(s.maxId).toBe(4400n)
    expect(s.tierIdCount).toBe(400n)
    expect(s.untieredCount).toBe(4000n)
    expect(s.withinSupply).toBe(true)
  })

  it('tier 4001–4400 with supply 4000 → exceeds supply (✗)', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 4000n)
    expect(s.maxId).toBe(4400n)
    expect(s.withinSupply).toBe(false)
  })

  it('supply unknown (0) → within supply is not asserted (true, no false ✗)', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 0n)
    expect(s.supplyKnown).toBe(false)
    expect(s.withinSupply).toBe(true)
    expect(s.tierIdCount).toBe(400n)
  })

  it('sums coverage across multiple rows and tracks the outer bounds', () => {
    const s = tierSupplySummary(
      {
        'tierIdStarts.0': '1',
        'tierIdEnds.0': '10',
        'tierIdStarts.1': '20',
        'tierIdEnds.1': '29',
      },
      100n,
    )
    expect(s.minId).toBe(1n)
    expect(s.maxId).toBe(29n)
    expect(s.tierIdCount).toBe(20n) // 10 + 10
    expect(s.untieredCount).toBe(80n)
    expect(s.withinSupply).toBe(true)
  })
})
