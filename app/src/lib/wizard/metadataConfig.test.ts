import { describe, expect, it } from 'vitest'
import {
  EMPTY_METADATA_CONFIG,
  encodeTiers,
  encodeMetadataConfig,
  hasMetadataConfig,
  tierSupplySummary,
  validateMetadataConfig,
} from './metadataConfig'
import { ZERO_ADDRESS } from './submit'

const RESOLVER = '0x1111111111111111111111111111111111111111' as const
const OVERLAY = '0x2222222222222222222222222222222222222222' as const
const TIER = '0x3333333333333333333333333333333333333333' as const

// A two-rung ladder: ×10 then ×100, both uncapped. Against a 1000-id supply the contract derives
// 1001–1100 (100 ids) and 1101–1110 (10 ids). The creator never types an id.
const TWO_ROWS = {
  'tierWeights.0': '10',
  'tierCounts.0': '',
  'tierBaseURIs.0': 'ten-',
  'tierWeights.1': '100',
  'tierCounts.1': '',
  'tierBaseURIs.1': 'hundred-',
}

// ── encodeTiers ──────────────────────────────────────────────────────────────

describe('encodeTiers', () => {
  it('zips the parallel lists into TierSpec rows in order', () => {
    const tiers = encodeTiers(TWO_ROWS)
    expect(tiers).toHaveLength(2)
    expect(tiers[0]).toEqual({ weight: 10, count: 0, baseURI: 'ten-' })
    expect(tiers[1]).toEqual({ weight: 100, count: 0, baseURI: 'hundred-' })
  })

  it('carries no id range — ranges are derived on-chain, never app input', () => {
    const spec = encodeTiers(TWO_ROWS)[0]!
    expect(Object.keys(spec).sort()).toEqual(['baseURI', 'count', 'weight'])
  })

  it('drops rows whose weight is blank (half-filled trailing row)', () => {
    const tiers = encodeTiers({
      'tierWeights.0': '10',
      'tierBaseURIs.0': 'a-',
      'tierWeights.1': '', // blank weight → whole row dropped
      'tierBaseURIs.1': 'orphan',
    })
    expect(tiers).toHaveLength(1)
    expect(tiers[0]?.baseURI).toBe('a-')
  })

  it('coerces garbage numerics to 0 rather than throwing', () => {
    const tiers = encodeTiers({ 'tierWeights.0': '10', 'tierCounts.0': 'NaN' })
    expect(tiers[0]?.count).toBe(0)
  })

  it('a blank count encodes as 0 — the contract reads that as "as many as the supply allows"', () => {
    const tiers = encodeTiers({ 'tierWeights.0': '10', 'tierCounts.0': '' })
    expect(tiers[0]?.count).toBe(0)
  })

  it('allows a blank base URI (falls through to the collection base on-chain)', () => {
    const tiers = encodeTiers({ 'tierWeights.0': '10' })
    expect(tiers[0]?.baseURI).toBe('')
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

  it('the ladder is only encoded when the tier module is selected', () => {
    const cfg = encodeMetadataConfig({ overlay: OVERLAY }, TWO_ROWS)
    expect(cfg.tiers).toEqual([]) // no tier module → ladder ignored
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

  it('flags a tier selection with no resolver — the factory rejects a direct tier pointer', () => {
    const errs = validateMetadataConfig({ tier: TIER }, TWO_ROWS)
    expect(errs['resolver']).toMatch(/select a metadata resolver/i)
  })

  it('a tier selection paired with a resolver clears the resolver error', () => {
    const errs = validateMetadataConfig({ resolver: RESOLVER, tier: TIER }, TWO_ROWS)
    expect(errs['resolver']).toBeUndefined()
  })

  it('flags a tier module selected with an empty ladder (the contract reverts at create)', () => {
    const errs = validateMetadataConfig({ resolver: RESOLVER, tier: TIER }, {})
    expect(errs['tierWeights']).toMatch(/at least one tier/i)
  })

  it('flags a weight below 2 — the escrow math needs a real denomination', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '1', 'tierBaseURIs.0': 'r-' },
    )
    expect(errs['tierWeights.0']).toMatch(/weight must be ≥ 2/)
  })

  it('flags a non-increasing ladder', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      {
        'tierWeights.0': '10',
        'tierBaseURIs.0': 'a-',
        'tierWeights.1': '10', // equal to the tier below
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs['tierWeights.1']).toMatch(/greater than tier 1/)
  })

  it('does NOT require a band URI — consistent with the optional main collection URI', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '10' },
    )
    expect(errs['tierBaseURIs.0']).toBeUndefined()
  })

  it('does NOT constrain count — 0 means "as many as possible" and a large value is clamped', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '10', 'tierCounts.0': '999999' },
      1000n,
    )
    expect(errs).toEqual({})
  })

  it('accepts a strictly climbing ladder', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      {
        'tierWeights.0': '2',
        'tierBaseURIs.0': 'a-',
        'tierWeights.1': '3',
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs).toEqual({})
  })

  // ── supply (nftCount) rule ──────────────────────────────────────────────────
  // Ids are no longer app input, so the placement rule is gone: bands are DERIVED above the supply
  // and cannot overlap it. What the supply still decides is whether a weight yields any ids at all —
  // `floor(nftCount / weight) == 0` reverts at create.

  it('passes a weight the supply can back', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '10' },
      4000n,
    )
    expect(errs).toEqual({})
  })

  it('flags a weight above the supply, with the specific supply message', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '5000' },
      4000n,
    )
    expect(errs['tierWeights.0']).toBe(
      'tier 1: weight 5000 is above the 4000 NFT supply, so the tier would have no ids',
    )
  })

  it('a weight exactly equal to the supply is fine — it derives a single id', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      { 'tierWeights.0': '4000' },
      4000n,
    )
    expect(errs).toEqual({})
  })

  it('skips the supply check when nftCount is 0/empty (do not false-error pre-supply)', () => {
    const big = { 'tierWeights.0': '5000' }
    expect(validateMetadataConfig({ resolver: RESOLVER, tier: TIER }, big, 0n)).toEqual({})
    // Default arg (no nftCount) behaves the same as 0n.
    expect(validateMetadataConfig({ resolver: RESOLVER, tier: TIER }, big)).toEqual({})
  })

  it('flags only the offending row', () => {
    const errs = validateMetadataConfig(
      { resolver: RESOLVER, tier: TIER },
      {
        'tierWeights.0': '1', // below 2
        'tierBaseURIs.0': 'a-',
        'tierWeights.1': '10',
        'tierBaseURIs.1': 'b-',
      },
      4000n,
    )
    expect(errs['tierWeights.0']).toMatch(/weight must be ≥ 2/)
    expect(errs['tierWeights.1']).toBeUndefined()
  })
})

// ── tierSupplySummary ────────────────────────────────────────────────────────

describe('tierSupplySummary', () => {
  it('no tiers → nothing derived', () => {
    const s = tierSupplySummary({}, 4400n)
    expect(s).toEqual({
      nftCount: 4400n,
      supplyKnown: true,
      hasTiers: false,
      tiers: [],
      bandIdCount: 0n,
    })
  })

  it('derives the same geometry the factory does: packed above supply, sized supply ÷ weight', () => {
    // rth's canonical case: 4000 mintable, a ×10 tier → 400 ids reserved at 4001–4400.
    const s = tierSupplySummary({ 'tierWeights.0': '10' }, 4000n)
    expect(s.tiers).toHaveLength(1)
    expect(s.tiers[0]).toEqual({
      tierNumber: 1,
      weight: 10,
      idStart: 4001n,
      idEnd: 4400n,
      count: 400n,
      maxCount: 400n,
      scarce: false,
    })
    expect(s.bandIdCount).toBe(400n)
  })

  it('packs a second tier contiguously above the first', () => {
    const s = tierSupplySummary(TWO_ROWS, 1000n)
    expect(s.tiers.map((t) => [t.idStart, t.idEnd])).toEqual([
      [1001n, 1100n],
      [1101n, 1110n],
    ])
    expect(s.bandIdCount).toBe(110n)
  })

  it('shows a capped tier as scarce, with the count it gets and the count it could have', () => {
    const s = tierSupplySummary({ 'tierWeights.0': '10', 'tierCounts.0': '40' }, 4000n)
    expect(s.tiers[0]?.count).toBe(40n)
    expect(s.tiers[0]?.maxCount).toBe(400n)
    expect(s.tiers[0]?.scarce).toBe(true)
    expect(s.tiers[0]?.idEnd).toBe(4040n) // 4001 + 40 - 1
  })

  it('clamps a count above the maximum, exactly as the contract does', () => {
    const s = tierSupplySummary({ 'tierWeights.0': '10', 'tierCounts.0': '99999' }, 4000n)
    expect(s.tiers[0]?.count).toBe(400n)
    expect(s.tiers[0]?.scarce).toBe(false)
  })

  it('supply unknown (0) → no ranges are invented', () => {
    const s = tierSupplySummary({ 'tierWeights.0': '10' }, 0n)
    expect(s.supplyKnown).toBe(false)
    expect(s.hasTiers).toBe(true)
    expect(s.tiers).toEqual([])
    expect(s.bandIdCount).toBe(0n)
  })

  it('a weight the supply cannot back derives no range (the contract reverts on it)', () => {
    const s = tierSupplySummary({ 'tierWeights.0': '5000' }, 4000n)
    expect(s.tiers).toEqual([])
    expect(s.bandIdCount).toBe(0n)
  })

  it('rounds the band size DOWN — a band never over-promises ids', () => {
    const s = tierSupplySummary({ 'tierWeights.0': '3' }, 1000n)
    expect(s.tiers[0]?.maxCount).toBe(333n) // floor(1000 / 3)
    expect(s.tiers[0]?.idEnd).toBe(1333n)
  })
})
