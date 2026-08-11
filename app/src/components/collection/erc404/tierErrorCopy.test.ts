import { describe, expect, it } from 'vitest'
import { tierErrorCopy } from './tierErrorCopy'

describe('tierErrorCopy', () => {
  const cases: Array<[name: string, expected: string]> = [
    [
      'TierOpFailed',
      'The op did not go through and no cause is reported. Check that the ladder is still sealed as ' +
        'expected, that you still own the id, and that your balance covers the escrow the op needs — ' +
        'coin already escrowed behind a band NFT cannot fund another.',
    ],
    [
      'NotTierZeroId',
      'The id given is not an ordinary id you own, or it sits above the ordinary range.',
    ],
    ['NotBandId', 'That id is not a band NFT you own.'],
    ['InvalidBand', "The tier chosen is not on this collection's ladder."],
    ['TiersNotConfigured', 'This collection has no tier ladder; nothing to mint up or down into.'],
    [
      'NothingToClaim',
      'No escrow is waiting; a claim already landed, or nothing has been released yet.',
    ],
    [
      'EscrowReleaseFailed',
      'The release could not be paid out; the claim can be retried and the credit is not lost.',
    ],
    [
      'UnapprovedResolver',
      'The metadata resolver this collection points at is not approved, so the launch or metadata ' +
        'write cannot proceed.',
    ],
  ]

  for (const [name, expected] of cases) {
    it(`decodes bare selector name "${name}()"`, () => {
      expect(tierErrorCopy(`${name}()`)).toBe(expected)
    })

    it(`decodes composite reason for "${name}"`, () => {
      expect(tierErrorCopy(`The contract function "x" reverted. (${name}())`)).toBe(expected)
    })
  }

  it("TierOpFailed's copy never claims a cause", () => {
    const copy = tierErrorCopy('TierOpFailed()')
    expect(copy).toBeDefined()
    expect(copy).not.toMatch(/this usually means|this is because|caused by/i)
  })

  it('passes through an unrecognised reason as undefined (no generic fallback)', () => {
    expect(tierErrorCopy('SomeOtherError()')).toBeUndefined()
    expect(tierErrorCopy('User rejected the request.')).toBeUndefined()
  })

  it('undefined in, undefined out', () => {
    expect(tierErrorCopy(undefined)).toBeUndefined()
  })
})
