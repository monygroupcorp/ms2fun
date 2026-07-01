import { describe, expect, it } from 'vitest'
import {
  EMPTY_METADATA_CONFIG,
  encodeMetadataConfig,
  encodeTiers,
  hasMetadataConfig,
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
  'tierMinBalances.0': '1000000000000000000',
  'tierBaseURIs.0': 'rare-',
  'tierLockedURIs.0': 'locked-',
  'tierIdStarts.1': '6',
  'tierIdEnds.1': '10',
  'tierMinBalances.1': '5000000000000000000',
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
    const errs = validateMetadataConfig({ resolver: RESOLVER, overlay: OVERLAY, tier: TIER }, TWO_ROWS)
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

  it('flags a missing revealed (base) URI', () => {
    const errs = validateMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '1', 'tierIdEnds.0': '3' },
    )
    expect(errs['tierBaseURIs.0']).toMatch(/required/i)
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
})
