import { describe, expect, it } from 'vitest'
import { DN404_MAX_TOTAL_SUPPLY, maxNftSupplyForUnit, supplyCeilingError } from './supplyCeiling'

// The three presets DeployCore installs (script/DeployCore.sol) — the numbers a creator actually meets.
const NICHE = 1_000_000_000n
const STANDARD = 1_000_000n
const HYPE = 1_000n

describe('maxNftSupplyForUnit', () => {
  it('matches the deployed presets', () => {
    expect(maxNftSupplyForUnit(NICHE)).toBe(79n)
    expect(maxNftSupplyForUnit(STANDARD)).toBe(79_228n)
    expect(maxNftSupplyForUnit(HYPE)).toBe(79_228_162n)
  })

  // The ceiling must be the LAST value that does not overflow — an off-by-one here reverts a create
  // the wizard just told the creator was fine.
  it('is exact at the boundary: ceiling fits, ceiling + 1 overflows', () => {
    for (const unit of [NICHE, STANDARD, HYPE]) {
      const max = maxNftSupplyForUnit(unit)
      expect(max * unit * 10n ** 18n <= DN404_MAX_TOTAL_SUPPLY).toBe(true)
      expect((max + 1n) * unit * 10n ** 18n > DN404_MAX_TOTAL_SUPPLY).toBe(true)
    }
  })

  it('returns 0 for a unit of 0 (setPreset rejects it; admit no supply rather than divide by zero)', () => {
    expect(maxNftSupplyForUnit(0n)).toBe(0n)
    expect(maxNftSupplyForUnit(-1n)).toBe(0n)
  })
})

describe('supplyCeilingError', () => {
  const ceiling = maxNftSupplyForUnit(NICHE) // 79

  it('flags a supply above the ceiling, naming the preset and the max', () => {
    const msg = supplyCeilingError('1000', ceiling, 'NICHE')
    expect(msg).toMatch(/NICHE/)
    expect(msg).toMatch(/79/)
    expect(msg).toMatch(/1,000/)
  })

  it('accepts the ceiling exactly', () => {
    expect(supplyCeilingError('79', ceiling, 'NICHE')).toBeNull()
  })

  it('accepts a supply below the ceiling', () => {
    expect(supplyCeilingError('50', ceiling, 'NICHE')).toBeNull()
  })

  it('is silent while the on-chain ceiling has not loaded', () => {
    expect(supplyCeilingError('1000000', undefined, 'NICHE')).toBeNull()
  })

  it('is silent on blank or unparsable input (other validators own those)', () => {
    expect(supplyCeilingError('', ceiling, 'NICHE')).toBeNull()
    expect(supplyCeilingError('   ', ceiling, 'NICHE')).toBeNull()
    expect(supplyCeilingError('abc', ceiling, 'NICHE')).toBeNull()
    expect(supplyCeilingError(undefined, ceiling, 'NICHE')).toBeNull()
  })

  it('handles a supply far beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    expect(supplyCeilingError('9007199254740993', ceiling, 'NICHE')).not.toBeNull()
  })
})
