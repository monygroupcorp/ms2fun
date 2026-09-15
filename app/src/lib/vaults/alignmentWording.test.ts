/**
 * The 19% is one law and two flows, and the strings have to say which. These assertions are what
 * stops the page drifting back to a single sentence: the two families must not produce the same
 * text, the endowment string must name yield rather than fees, and neither may claim the creator's
 * 80% is the community's.
 */
import { describe, expect, it } from 'vitest'
import {
  ALIGNMENT_LAW_NOTE,
  ALIGNMENT_LAW_SECTION_SENTENCE,
  ALIGNMENT_LAW_SENTENCE,
  ALIGNMENT_SPLIT,
  alignmentLawSentence,
  communityCutSentence,
} from './alignmentWording'

describe('ALIGNMENT_SPLIT', () => {
  it('is the 1/19/80 the contracts hold, and sums to the whole', () => {
    expect(ALIGNMENT_SPLIT.protocolBps).toBe(100)
    expect(ALIGNMENT_SPLIT.communityBps).toBe(1_900)
    expect(
      ALIGNMENT_SPLIT.protocolBps + ALIGNMENT_SPLIT.communityBps + ALIGNMENT_SPLIT.remainderBps,
    ).toBe(10_000)
  })
})

describe('communityCutSentence', () => {
  it('says FEES for an LP vault', () => {
    const s = communityCutSentence('lp', 'Nouns')
    expect(s).toMatch(/trading fees/i)
    expect(s).not.toMatch(/yield/i)
  })

  it('says YIELD ON A CORPUS for an endowment vault, and names the tithe it is made of', () => {
    const s = communityCutSentence('yield', 'Nouns')
    expect(s).toMatch(/yield/i)
    expect(s).toMatch(/corpus/i)
    // The thing the old single sentence hid: on this family the other 80% is the CREATOR's.
    expect(s).toMatch(/creators? take/i)
  })

  it('is a DIFFERENT sentence per family — one string for both is the defect', () => {
    expect(communityCutSentence('lp', 'Nouns')).not.toBe(communityCutSentence('yield', 'Nouns'))
  })

  it('names the community it is paying', () => {
    expect(communityCutSentence('lp', 'Nouns')).toContain('Nouns')
    expect(communityCutSentence('yield', 'Nouns')).toContain('Nouns')
  })

  it('falls back to "the community" when the target title is missing or blank', () => {
    expect(communityCutSentence('lp')).toContain('the community')
    expect(communityCutSentence('yield', '   ')).toContain('the community')
  })

  it('quotes 19% on both, because the ratio is the half that does not vary', () => {
    expect(communityCutSentence('lp', 'Nouns')).toContain('19%')
    expect(communityCutSentence('yield', 'Nouns')).toContain('19%')
  })
})

describe('the cross-family sentences', () => {
  // A summary page spans both families, so it may state the RATIO but must not pick one family's
  // source and assert it over the other — which is exactly what "of every collection's fees" did.
  it('state the ratio without claiming a single source for it', () => {
    for (const s of [ALIGNMENT_LAW_SENTENCE, ALIGNMENT_LAW_SECTION_SENTENCE]) {
      expect(s).toContain('19%')
      expect(s).not.toMatch(/fees/i)
      expect(s).not.toMatch(/yield/i)
    }
  })
})

describe('alignmentLawSentence', () => {
  // A collection page and a token page know the vault's NAME and not its `vaultType()`, so they may
  // name the payee and must not name a source.
  it('names the payee', () => {
    expect(alignmentLawSentence('Nouns')).toContain('Nouns')
  })

  it('falls back to "the community" when the vault name is missing or blank', () => {
    expect(alignmentLawSentence()).toContain('the community')
    expect(alignmentLawSentence('  ')).toContain('the community')
  })

  it('states the ratio', () => {
    expect(alignmentLawSentence('Nouns')).toContain('19%')
  })

  it('claims NO source — not fees, not yield, and above all not a resale royalty', () => {
    const s = alignmentLawSentence('Nouns')
    expect(s).not.toMatch(/fees?/i)
    expect(s).not.toMatch(/yield/i)
    // `royaltyInfo`/ERC2981 are implemented in no file under `contracts/src`; "19% of every resale"
    // was a claim with nothing behind it.
    expect(s).not.toMatch(/resale|royalt/i)
    // The bind lands at edition mint, auction close OR ERC404 graduation — never "every mint".
    expect(s).not.toMatch(/every mint/i)
  })

  it('says the ratio is fixed, which is the half that is true on every family', () => {
    expect(alignmentLawSentence('Nouns')).toMatch(/nobody can change/i)
  })
})

describe('ALIGNMENT_LAW_NOTE', () => {
  it('states the ratio in a caption-width slot and still names no source', () => {
    expect(ALIGNMENT_LAW_NOTE).toContain('19%')
    expect(ALIGNMENT_LAW_NOTE).not.toMatch(/fees?/i)
    expect(ALIGNMENT_LAW_NOTE).not.toMatch(/yield/i)
    expect(ALIGNMENT_LAW_NOTE).not.toMatch(/resale/i)
  })

  it("says the number is the contract's and not the creator's", () => {
    expect(ALIGNMENT_LAW_NOTE).toMatch(/not a creator setting/i)
  })
})
