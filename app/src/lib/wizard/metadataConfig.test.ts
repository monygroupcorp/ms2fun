import { describe, expect, it } from 'vitest'
import {
  EMPTY_METADATA_CONFIG,
  encodeBands,
  encodeMetadataConfig,
  hasMetadataConfig,
  tierSupplySummary,
  validateMetadataConfig,
} from './metadataConfig'
import { ZERO_ADDRESS } from './submit'

const RESOLVER = '0x1111111111111111111111111111111111111111' as const
const OVERLAY = '0x2222222222222222222222222222222222222222' as const
const TIER = '0x3333333333333333333333333333333333333333' as const

// A two-row, ascending, non-overlapping band table sitting ABOVE a 10-id supply.
const TWO_ROWS = {
  'tierIdStarts.0': '11',
  'tierIdEnds.0': '15',
  'tierBaseURIs.0': 'ten-',
  'tierIdStarts.1': '16',
  'tierIdEnds.1': '20',
  'tierBaseURIs.1': 'hundred-',
}

// ── encodeBands ──────────────────────────────────────────────────────────────

describe('encodeBands', () => {
  it('zips the parallel lists into Band rows in order', () => {
    const bands = encodeBands(TWO_ROWS)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toEqual({ idStart: 11n, idEnd: 15n, baseURI: 'ten-' })
    expect(bands[1]).toEqual({ idStart: 16n, idEnd: 20n, baseURI: 'hundred-' })
  })

  it('carries no threshold or locked-art field — band art is unconditional', () => {
    const band = encodeBands(TWO_ROWS)[0]!
    expect(Object.keys(band).sort()).toEqual(['baseURI', 'idEnd', 'idStart'])
  })

  it('drops rows whose start id is blank (half-filled trailing row)', () => {
    const bands = encodeBands({
      'tierIdStarts.0': '11',
      'tierIdEnds.0': '15',
      'tierBaseURIs.0': 'a-',
      'tierIdStarts.1': '', // blank start → whole row dropped
      'tierBaseURIs.1': 'orphan',
    })
    expect(bands).toHaveLength(1)
    expect(bands[0]?.baseURI).toBe('a-')
  })

  it('coerces garbage numerics to 0n rather than throwing', () => {
    const bands = encodeBands({ 'tierIdStarts.0': '11', 'tierIdEnds.0': 'NaN' })
    expect(bands[0]?.idEnd).toBe(0n)
  })

  it('allows a blank base URI (falls through to the collection base on-chain)', () => {
    const bands = encodeBands({ 'tierIdStarts.0': '11', 'tierIdEnds.0': '12' })
    expect(bands[0]?.baseURI).toBe('')
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
    expect(cfg.bands).toHaveLength(2)
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

  it('bands are only encoded when the tier module is selected', () => {
    const cfg = encodeMetadataConfig({ overlay: OVERLAY }, TWO_ROWS)
    expect(cfg.bands).toEqual([]) // no tier module → table ignored
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
      { 'tierIdStarts.0': '15', 'tierIdEnds.0': '12', 'tierBaseURIs.0': 'r-' },
    )
    expect(errs['tierIdEnds.0']).toMatch(/≥ start id/)
  })

  it('flags overlapping / non-ascending ranges', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '11',
        'tierIdEnds.0': '15',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '15', // overlaps prev end
        'tierIdEnds.1': '19',
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs['tierIdStarts.1']).toMatch(/ascending/i)
  })

  it('does NOT require a band URI — consistent with the optional main collection URI', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '11', 'tierIdEnds.0': '13' },
    )
    expect(errs['tierBaseURIs.0']).toBeUndefined()
  })

  it('accepts adjacent non-overlapping ranges (start == prevEnd + 1)', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '11',
        'tierIdEnds.0': '15',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '16',
        'tierIdEnds.1': '19',
        'tierBaseURIs.1': 'b-',
      },
    )
    expect(errs).toEqual({})
  })

  // ── supply (nftCount) placement rule (noesis-133, flipped by noesis-141) ─────
  // Band ids are RESERVED above the mintable supply — the auto-mint can never emit them. A band
  // that overlaps `[1, nftCount]` would collide with ordinary ids, which is the opposite of intent.

  // rth's canonical case, re-read: supply 4000, one band reserving 4001–4400 above it.
  const BAND_4001 = { 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400', 'tierBaseURIs.0': 'tier-' }

  it('passes a band that starts one past nftCount (4001 > 4000)', () => {
    const errs = validateMetadataConfig({ tier: TIER }, BAND_4001, 4000n)
    expect(errs).toEqual({})
  })

  it('flags a band that starts inside the supply, with the specific supply message', () => {
    const errs = validateMetadataConfig({ tier: TIER }, BAND_4001, 4400n)
    expect(errs['tierIdStarts.0']).toBe(
      'tier 1: start id 4001 must be above the 4400 NFT supply — tier ids are reserved above the mintable range',
    )
  })

  it('flags a band starting exactly AT nftCount (boundary is inclusive)', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '4000', 'tierIdEnds.0': '4400', 'tierBaseURIs.0': 'tier-' },
      4000n,
    )
    expect(errs['tierIdStarts.0']).toMatch(/must be above the 4000 NFT supply/)
  })

  it('no longer flags a band END past nftCount — that is where bands are supposed to be', () => {
    const errs = validateMetadataConfig({ tier: TIER }, BAND_4001, 4000n)
    expect(errs['tierIdEnds.0']).toBeUndefined()
  })

  it('flags a start id below 1', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '0', 'tierIdEnds.0': '5', 'tierBaseURIs.0': 'r-' },
      4400n,
    )
    expect(errs['tierIdStarts.0']).toMatch(/start id must be ≥ 1/)
  })

  it('skips the above-supply check when nftCount is 0/empty (do not false-error pre-supply)', () => {
    // A band inside a 4400 supply, but with supply unknown → no placement error.
    const errs = validateMetadataConfig({ tier: TIER }, BAND_4001, 0n)
    expect(errs).toEqual({})
    // Default arg (no nftCount) behaves the same as 0n.
    expect(validateMetadataConfig({ tier: TIER }, BAND_4001)).toEqual({})
  })

  it('flags only the offending row when an earlier band sits inside supply', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      {
        'tierIdStarts.0': '3900', // inside the 4000 supply
        'tierIdEnds.0': '3950',
        'tierBaseURIs.0': 'a-',
        'tierIdStarts.1': '4001',
        'tierIdEnds.1': '4400',
        'tierBaseURIs.1': 'b-',
      },
      4000n,
    )
    expect(errs['tierIdStarts.0']).toMatch(/must be above the 4000 NFT supply/)
    expect(errs['tierIdStarts.1']).toBeUndefined()
  })
})

// ── tierSupplySummary ────────────────────────────────────────────────────────

describe('tierSupplySummary', () => {
  it('no bands → nothing reserved, verdict vacuously true', () => {
    const s = tierSupplySummary({}, 4400n)
    expect(s).toEqual({
      nftCount: 4400n,
      supplyKnown: true,
      hasBands: false,
      minId: 0n,
      maxId: 0n,
      bandIdCount: 0n,
      aboveSupply: true,
    })
  })

  it('4,400 case: 4000 mintable + a 400-id band reserved at 4001–4400 → above supply', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 4000n)
    expect(s.hasBands).toBe(true)
    expect(s.minId).toBe(4001n)
    expect(s.maxId).toBe(4400n)
    expect(s.bandIdCount).toBe(400n)
    expect(s.aboveSupply).toBe(true)
  })

  it('band 4001–4400 with supply 4400 → overlaps the mintable range (✗)', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 4400n)
    expect(s.maxId).toBe(4400n)
    expect(s.aboveSupply).toBe(false)
  })

  it('supply unknown (0) → placement is not asserted (true, no false ✗)', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }, 0n)
    expect(s.supplyKnown).toBe(false)
    expect(s.aboveSupply).toBe(true)
    expect(s.bandIdCount).toBe(400n)
  })

  it('sums reserved ids across multiple rows and tracks the outer bounds', () => {
    const s = tierSupplySummary(
      {
        'tierIdStarts.0': '101',
        'tierIdEnds.0': '110',
        'tierIdStarts.1': '120',
        'tierIdEnds.1': '129',
      },
      100n,
    )
    expect(s.minId).toBe(101n)
    expect(s.maxId).toBe(129n)
    expect(s.bandIdCount).toBe(20n) // 10 + 10
    expect(s.aboveSupply).toBe(true)
  })

  it('malformed rows (idEnd < idStart) contribute 0 rather than a negative count', () => {
    const s = tierSupplySummary({ 'tierIdStarts.0': '120', 'tierIdEnds.0': '110' }, 100n)
    expect(s.bandIdCount).toBe(0n)
  })
})
