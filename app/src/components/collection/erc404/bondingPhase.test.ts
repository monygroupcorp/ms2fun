import { describe, expect, it } from 'vitest'
import { type BondingView, canDeployLiquidity, derivePhase, isGraduated } from './bondingPhase'

const ZERO = '0x0000000000000000000000000000000000000000' as const
const DEPLOYER = '0x2222222222222222222222222222222222222222' as const

function bonding(over: Partial<BondingView> = {}): BondingView {
  return {
    bondingActive: true,
    bondingOpenTime: 100n,
    bondingMaturityTime: 1000n,
    graduated: false,
    liquidityDeployer: ZERO,
    totalBondingSupply: 0n,
    maxSupply: 1000n,
    ...over,
  }
}

describe('isGraduated', () => {
  it('false before deploy', () => {
    expect(isGraduated({ graduated: false, liquidityDeployer: ZERO })).toBe(false)
  })
  it('true via the graduated flag', () => {
    expect(isGraduated({ graduated: true, liquidityDeployer: ZERO })).toBe(true)
  })
  it('true via a non-zero deployer', () => {
    expect(isGraduated({ graduated: false, liquidityDeployer: DEPLOYER })).toBe(true)
  })
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
