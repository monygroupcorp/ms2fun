import { describe, expect, it } from 'vitest'
import {
  type BondingView,
  buyableCeiling,
  canDeployLiquidity,
  derivePhase,
  isGraduated,
} from './bondingPhase'

// The default fixture reserves nothing, so `buyableCeiling` is `maxSupply` and every pre-existing
// expectation below still reads as it did. The ceiling cases opt in by setting the reserve terms.
function bonding(over: Partial<BondingView> = {}): BondingView {
  return {
    bondingActive: true,
    bondingOpenTime: 100n,
    bondingMaturityTime: 1000n,
    graduated: false,
    totalBondingSupply: 0n,
    maxSupply: 1000n,
    liquidityReserve: 0n,
    freeMintAllocation: 0n,
    unit: 1n,
    ...over,
  }
}

describe('isGraduated', () => {
  it('false before deploy', () => {
    expect(isGraduated({ graduated: false })).toBe(false)
  })
  it('true via the graduated flag', () => {
    expect(isGraduated({ graduated: true })).toBe(true)
  })
  // A configured (non-zero) liquidityDeployer must NOT read as graduated: it is set at construction,
  // so it is always non-zero even mid-curve. Only the `graduated` flag closes the curve.
})

describe('derivePhase', () => {
  it('graduated wins over everything (even pre-open time)', () => {
    expect(derivePhase(bonding({ graduated: true, bondingActive: false }), 0n)).toBe('graduated')
  })
  it('preopen when bonding is inactive', () => {
    expect(derivePhase(bonding({ bondingActive: false }), 500n)).toBe('preopen')
  })
  it('preopen before the open time', () => {
    expect(derivePhase(bonding({ bondingOpenTime: 100n }), 50n)).toBe('preopen')
  })
  it('bonding once open and active', () => {
    expect(derivePhase(bonding(), 150n)).toBe('bonding')
  })
  it('bonding exactly at the open time (boundary)', () => {
    expect(derivePhase(bonding({ bondingOpenTime: 100n }), 100n)).toBe('bonding')
  })
})

describe('canDeployLiquidity', () => {
  it('false outside the bonding phase (preopen)', () => {
    expect(canDeployLiquidity(bonding({ bondingActive: false }), 500n)).toBe(false)
  })
  it('false once already graduated', () => {
    expect(canDeployLiquidity(bonding({ graduated: true }), 500n)).toBe(false)
  })
  it('false mid-curve, not full, not matured', () => {
    expect(canDeployLiquidity(bonding({ totalBondingSupply: 500n }), 500n)).toBe(false)
  })
  it('true when the curve is full', () => {
    expect(canDeployLiquidity(bonding({ totalBondingSupply: 1000n, maxSupply: 1000n }), 500n)).toBe(
      true,
    )
  })
  it('true when matured even if not full', () => {
    expect(canDeployLiquidity(bonding({ bondingMaturityTime: 1000n }), 1000n)).toBe(true)
  })
  it('full check ignores a zero maxSupply (uncapped)', () => {
    expect(canDeployLiquidity(bonding({ maxSupply: 0n, totalBondingSupply: 5n }), 500n)).toBe(false)
  })
})

/**
 * The shipped shape: a 10% liquidity reserve plus a free-mint allocation. `maxSupply` is 1000 and no
 * buy can take the supply past 850, so 850 is where the curve ends.
 */
function reserved(over: Partial<BondingView> = {}): BondingView {
  return bonding({ liquidityReserve: 100n, freeMintAllocation: 5n, unit: 10n, ...over })
}

describe('buyableCeiling', () => {
  it('subtracts the reserve and the free-mint allocation in coin', () => {
    expect(buyableCeiling(reserved())).toBe(850n)
  })
  it('is maxSupply when nothing is held back', () => {
    expect(buyableCeiling(bonding())).toBe(1000n)
  })
  it('clamps to zero rather than underflowing when the whole supply is reserved', () => {
    expect(buyableCeiling(bonding({ liquidityReserve: 4000n }))).toBe(0n)
  })
})

describe('canDeployLiquidity at the buyable ceiling', () => {
  // NON-VACUITY: this is the case that separates the ceiling from `maxSupply`. Reverting the
  // predicate to `totalBondingSupply >= maxSupply` makes this expectation false — 850 < 1000 — while
  // every other test in this file still passes, so it is the assertion that holds the fix in place.
  it('true at the ceiling, which is short of maxSupply', () => {
    const b = reserved({ totalBondingSupply: 850n, bondingMaturityTime: 0n })
    expect(buyableCeiling(b)).toBeLessThan(b.maxSupply)
    expect(canDeployLiquidity(b, 500n)).toBe(true)
  })
  it('false one coin below the ceiling', () => {
    expect(
      canDeployLiquidity(reserved({ totalBondingSupply: 849n, bondingMaturityTime: 0n }), 500n),
    ).toBe(false)
  })
  // The curve can sit above the ceiling: a free-mint claim or a reserve raised after the fact adds
  // supply the buy path never priced. Still full — there is nothing left to buy.
  it('true past the ceiling', () => {
    expect(
      canDeployLiquidity(reserved({ totalBondingSupply: 900n, bondingMaturityTime: 0n }), 500n),
    ).toBe(true)
  })
  it('a wholly-reserved curve reads not-full, matching the lens', () => {
    expect(
      canDeployLiquidity(
        bonding({ liquidityReserve: 1000n, totalBondingSupply: 0n, bondingMaturityTime: 0n }),
        500n,
      ),
    ).toBe(false)
  })
})
