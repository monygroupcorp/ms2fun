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
  NO_ROYALTY_NOTE,
  NO_ROYALTY_SENTENCE,
  alignmentLawSentence,
  communityCutSentence,
  secondaryEarnSentence,
  settlementMomentSentence,
  type LaunchStandard,
} from './alignmentWording'

const STANDARDS: LaunchStandard[] = ['erc404', 'erc1155', 'erc721']

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

describe('settlementMomentSentence', () => {
  it('names a different moment per standard — one sentence for all three is the defect', () => {
    const said = STANDARDS.map((s) => settlementMomentSentence(s))
    expect(new Set(said).size).toBe(STANDARDS.length)
  })

  it('states the ratio on every standard, because the ratio is what does not vary', () => {
    for (const s of STANDARDS) expect(settlementMomentSentence(s)).toContain('19%')
  })

  it('names the raise, the mint proceeds and the winning bid — the real base on each', () => {
    expect(settlementMomentSentence('erc404')).toMatch(/raise/i)
    expect(settlementMomentSentence('erc1155')).toMatch(/mint proceeds/i)
    expect(settlementMomentSentence('erc721')).toMatch(/winning bid/i)
  })

  it('calls the base a sale and never a fee — `RevenueSplitLib.split` takes the price, not a fee', () => {
    for (const s of STANDARDS) {
      expect(settlementMomentSentence(s)).not.toMatch(/19% of (every |the )?fees?/i)
    }
  })
})

describe('secondaryEarnSentence', () => {
  it('gives ERC-404 the pool, because the pool is the only thing here that charges after a sale', () => {
    const s = secondaryEarnSentence('erc404')
    expect(s).toMatch(/swap/i)
    expect(s).toMatch(/Uniswap V4/)
    // The venue divergence is a decision, not an oversight: ZAMM graduates into an untaxed pool.
    expect(s).toMatch(/ZAMM/)
  })

  it('says plainly that editions and auctions take nothing after the primary sale', () => {
    for (const s of ['erc1155', 'erc721'] as const) {
      const said = secondaryEarnSentence(s)
      expect(said).toMatch(/nothing is taken/i)
      expect(said).toMatch(/resale/i)
      expect(said).toMatch(/never again/i)
    }
  })

  it('claims no resale share on ANY standard — no contract under contracts/src takes one', () => {
    for (const s of STANDARDS) {
      expect(secondaryEarnSentence(s)).not.toMatch(/\d+% of (every |each |the )?resale/i)
    }
  })
})

describe('the royalty no', () => {
  it('is stated as a decision, not an omission', () => {
    expect(NO_ROYALTY_SENTENCE).toMatch(/no royalty field/i)
    expect(NO_ROYALTY_SENTENCE).toMatch(/position rather than a gap/i)
  })

  it('gives the reason a creator can check: a marketplace may decline the request', () => {
    expect(NO_ROYALTY_SENTENCE).toMatch(/decline/i)
    expect(NO_ROYALTY_SENTENCE).toMatch(/settlement/i)
  })

  it('survives the caption-width slot with both halves intact', () => {
    expect(NO_ROYALTY_NOTE).toMatch(/no secondary royalty/i)
    expect(NO_ROYALTY_NOTE).toMatch(/ignore/i)
    expect(NO_ROYALTY_NOTE).toMatch(/settlement/i)
  })
})
