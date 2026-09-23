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
  swapTitheSentence,
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
  // ERC-404's after-market answer is a property of the DEPLOYER, not of the standard: the same
  // ERC-404 launch pays the community forever or never, depending on the module it graduates
  // through. A fixed string here could only be a hedge, so there is none — `swapTitheSentence`
  // answers it from the chain.
  it('has no fixed answer for ERC-404, because the standard does not have one', () => {
    expect(secondaryEarnSentence('erc404')).toBeNull()
  })

  it('says plainly that editions and auctions take nothing after the primary sale', () => {
    for (const s of ['erc1155', 'erc721'] as const) {
      const said = secondaryEarnSentence(s) ?? ''
      expect(said).toMatch(/nothing is taken/i)
      expect(said).toMatch(/resale/i)
      expect(said).toMatch(/never again/i)
    }
  })

  it('claims no resale share on ANY standard — no contract under contracts/src takes one', () => {
    for (const s of STANDARDS) {
      expect(secondaryEarnSentence(s) ?? '').not.toMatch(/\d+% of (every |each |the )?resale/i)
    }
  })
})

/**
 * The tri-state. Each branch is a different promise to a creator deciding where to graduate, and
 * the two silent branches are load-bearing: the wizard renders nothing at all for them, so a
 * sentence leaking out of `pending` or `unknown` IS the defect.
 */
describe('swapTitheSentence', () => {
  it('states the tithe flat when the deployer mints a hook — no "can carry", no "may"', () => {
    const said = swapTitheSentence({ kind: 'taxed', feeBips: 100n }) ?? ''
    expect(said).toMatch(/every swap/i)
    expect(said).toMatch(/pays/i)
    expect(said).not.toMatch(/can carry|could|may |might|possible/i)
  })

  /**
   * The bound the earlier wording overstated. `UniAlignmentV4Hook.haltTithe` is permissionless and
   * gated only on `masterRegistry.isVaultRegistered(vault)` having gone false — which the protocol
   * owner causes with `deactivateVault` — and while `titheHalted` is set the hook takes nothing at
   * all. `resumeTithe` is the permissionless mirror, reachable only once the registry carries the
   * vault again. So the charge runs while the VAULT is curated, not while the POOL trades.
   *
   * The second half matters as much: a halted tithe is not folded into the creator's leg the way a
   * de-curated settlement cut is (`LiquidityDeployerModule._postUnlock`). The swapper keeps it. A
   * creator told only "it stops" would reasonably read that as "it comes to me instead".
   */
  it('bounds the tithe by curation, and says a halt does not pay the creator instead', () => {
    const said = swapTitheSentence({ kind: 'taxed', feeBips: 100n }) ?? ''
    expect(said).not.toMatch(/as long as the pool trades/i)
    expect(said).toMatch(/as long as that vault stays curated/i)
    expect(said).toMatch(/does not come back to you/i)
  })

  /**
   * The rate quoted is read off `LiquidityDeployerModule.hookFeeBips`, which `setHookFeeBips` lets
   * the protocol owner change right up until this collection graduates. Only the HOOK's
   * `hookFeeBips` is `immutable`, and that hook is not minted until graduation — so "fixed at
   * deploy", in a wizard whose deploy button is the next step, promised a lock nobody holds yet.
   */
  it("names graduation as the moment the rate locks, not the creator's own deploy", () => {
    const said = swapTitheSentence({ kind: 'taxed', feeBips: 100n }) ?? ''
    expect(said).toMatch(/at graduation/i)
    expect(said).not.toMatch(/fixed .{0,30}at deploy/i)
  })

  it('renders bips as bips: 100 is 1%, not 100%', () => {
    expect(swapTitheSentence({ kind: 'taxed', feeBips: 100n })).toContain('1% of the ETH side')
    expect(swapTitheSentence({ kind: 'taxed', feeBips: 50n })).toContain('0.5% of the ETH side')
    expect(swapTitheSentence({ kind: 'taxed', feeBips: 1_900n })).toContain('19% of the ETH side')
    expect(swapTitheSentence({ kind: 'taxed', feeBips: 10_000n })).toContain('100% of the ETH side')
  })

  it('quotes the rate it was given and hardcodes none', () => {
    const said = swapTitheSentence({ kind: 'taxed', feeBips: 137n }) ?? ''
    expect(said).toContain('1.37%')
  })

  it('words a hook wired at zero bips as untaxed — it exists and moves nothing', () => {
    expect(swapTitheSentence({ kind: 'taxed', feeBips: 0n })).toBe(
      swapTitheSentence({ kind: 'untaxed' }),
    )
  })

  it('tells an untaxed venue straight, so nobody banks on an earn that will not arrive', () => {
    const said = swapTitheSentence({ kind: 'untaxed' }) ?? ''
    expect(said).toMatch(/untaxed/i)
    expect(said).toMatch(/whole of it/i)
    expect(said).not.toMatch(/\d+% of the ETH side/)
  })

  it('says NOTHING while the read is in flight — a flash of "untaxed" is already a lie', () => {
    expect(swapTitheSentence({ kind: 'pending' })).toBeNull()
  })

  it('says NOTHING when the answer did not come back, rather than guessing either way', () => {
    expect(swapTitheSentence({ kind: 'unknown' })).toBeNull()
  })

  it('never claims a resale royalty on any branch', () => {
    for (const t of [
      { kind: 'taxed', feeBips: 100n },
      { kind: 'untaxed' },
      { kind: 'pending' },
      { kind: 'unknown' },
    ] as const) {
      expect(swapTitheSentence(t) ?? '').not.toMatch(/resale|royalt/i)
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
