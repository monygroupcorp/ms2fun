import { describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import {
  EMPTY_TIER_CONFIG,
  encodeTierConfig,
  hasTierConfig,
  validateTierConfig,
} from './gatingConfig'

const hash = (s: string) => keccak256(toHex(s))

describe('hasTierConfig', () => {
  it('is false with no passwords', () => {
    expect(hasTierConfig({})).toBe(false)
    expect(hasTierConfig({ tierType: '0' })).toBe(false)
  })
  it('ignores blank password rows', () => {
    expect(hasTierConfig({ 'passwords.0': '   ' })).toBe(false)
  })
  it('is true with at least one non-empty password', () => {
    expect(hasTierConfig({ 'passwords.0': 'alpha' })).toBe(true)
  })
})

describe('encodeTierConfig (VOLUME_CAP)', () => {
  it('hashes passwords and pairs caps by index', () => {
    const cfg = encodeTierConfig({
      tierType: '0',
      'passwords.0': 'alpha',
      'passwords.1': 'beta',
      'volumeCaps.0': '100',
      'volumeCaps.1': '500',
    })
    expect(cfg.tierType).toBe(0)
    expect(cfg.passwordHashes).toEqual([hash('alpha'), hash('beta')])
    expect(cfg.volumeCaps).toEqual([100n, 500n])
    expect(cfg.tierUnlockTimes).toEqual([])
  })

  it('drops a blank password row AND its paired cap to keep arrays matched', () => {
    const cfg = encodeTierConfig({
      tierType: '0',
      'passwords.0': 'alpha',
      'passwords.1': '',
      'passwords.2': 'gamma',
      'volumeCaps.0': '100',
      'volumeCaps.1': '999',
      'volumeCaps.2': '300',
    })
    expect(cfg.passwordHashes).toEqual([hash('alpha'), hash('gamma')])
    expect(cfg.volumeCaps).toEqual([100n, 300n])
    expect(cfg.passwordHashes.length).toBe(cfg.volumeCaps.length)
  })
})

describe('encodeTierConfig (TIME_BASED)', () => {
  it('uses tierUnlockTimes and leaves volumeCaps empty', () => {
    const cfg = encodeTierConfig({
      tierType: '1',
      'passwords.0': 'early',
      'tierUnlockTimes.0': '3600',
    })
    expect(cfg.tierType).toBe(1)
    expect(cfg.passwordHashes).toEqual([hash('early')])
    expect(cfg.tierUnlockTimes).toEqual([3600n])
    expect(cfg.volumeCaps).toEqual([])
  })
})

describe('validateTierConfig', () => {
  it('flags a tier missing its volume cap', () => {
    const errors = validateTierConfig({ tierType: '0', 'passwords.0': 'alpha' })
    expect(errors['volumeCaps.0']).toBeDefined()
  })
  it('flags a tier missing its unlock time', () => {
    const errors = validateTierConfig({ tierType: '1', 'passwords.0': 'alpha' })
    expect(errors['tierUnlockTimes.0']).toBeDefined()
  })
  it('passes when every tier is paired', () => {
    const errors = validateTierConfig({
      tierType: '0',
      'passwords.0': 'alpha',
      'volumeCaps.0': '100',
    })
    expect(errors).toEqual({})
  })
})

describe('EMPTY_TIER_CONFIG', () => {
  it('encodes to an open/unconfigured shape', () => {
    expect(EMPTY_TIER_CONFIG.passwordHashes).toEqual([])
  })
})
