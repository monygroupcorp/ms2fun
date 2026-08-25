import { describe, expect, it } from 'vitest'
import {
  deriveVaultFlavor,
  groupTargetsByToken,
  groupVaultsByFamily,
  venueLabel,
  type TargetLike,
  type VaultLike,
} from './vaultFlavor'

describe('deriveVaultFlavor', () => {
  it('maps AaveEndowment to the yield family', () => {
    expect(deriveVaultFlavor('AaveEndowment')).toEqual({ family: 'yield', venue: 'AaveEndowment' })
  })
  it('maps each LP type to the lp family with the "LP" suffix stripped', () => {
    expect(deriveVaultFlavor('UniswapV4LP')).toEqual({ family: 'lp', venue: 'UniswapV4' })
    expect(deriveVaultFlavor('ZAMMLP')).toEqual({ family: 'lp', venue: 'ZAMM' })
    expect(deriveVaultFlavor('CypherLP')).toEqual({ family: 'lp', venue: 'Cypher' })
  })
  it('treats an unknown non-LP type as yield, passing the venue through', () => {
    expect(deriveVaultFlavor('SomethingElse')).toEqual({ family: 'yield', venue: 'SomethingElse' })
  })
})

describe('venueLabel', () => {
  it('labels the known venues', () => {
    expect(venueLabel('UniswapV4')).toBe('Uniswap V4')
    expect(venueLabel('ZAMM')).toBe('ZAMM')
    expect(venueLabel('Cypher')).toBe('Cypher')
    expect(venueLabel('AaveEndowment')).toBe('Aave')
  })
  it('passes an unknown venue id through', () => {
    expect(venueLabel('Mystery')).toBe('Mystery')
  })
})

/** Build a minimal enriched vault (plus any extra fields the grouping carries through). */
const v = <T extends object>(vaultType: string, ready: boolean, extra?: T) => {
  const { family, venue } = deriveVaultFlavor(vaultType)
  return { family, venue, ready, ...(extra ?? {}) } as VaultLike & T
}

describe('groupVaultsByFamily', () => {
  it('groups into families and orders LP venues Uni → ZAMM → Cypher', () => {
    // Deliberately out of order to prove the sort.
    const groups = groupVaultsByFamily([
      v('CypherLP', true),
      v('AaveEndowment', true),
      v('ZAMMLP', true),
      v('UniswapV4LP', true),
    ])
    expect(groups.map((g) => g.family)).toEqual(['yield', 'lp'])
    const yieldG = groups.find((g) => g.family === 'yield')!
    const lpG = groups.find((g) => g.family === 'lp')!
    expect(yieldG.venues.map((o) => o.venue)).toEqual(['AaveEndowment'])
    expect(lpG.venues.map((o) => o.venue)).toEqual(['UniswapV4', 'ZAMM', 'Cypher'])
  })

  it('marks an unready LP venue disabled but never yield', () => {
    const groups = groupVaultsByFamily([
      v('AaveEndowment', false), // ready flag ignored for gating — yield is always selectable
      v('UniswapV4LP', true),
      v('ZAMMLP', false),
    ])
    const disabledByVenue = new Map(
      groups.flatMap((g) => g.venues).map((o) => [o.venue, o.disabled]),
    )
    expect(disabledByVenue.get('AaveEndowment')).toBe(false)
    expect(disabledByVenue.get('UniswapV4')).toBe(false)
    expect(disabledByVenue.get('ZAMM')).toBe(true)
  })

  it('collapses duplicate venues, preferring a ready vault', () => {
    const groups = groupVaultsByFamily([
      v('UniswapV4LP', false, { address: '0xunready' }),
      v('UniswapV4LP', true, { address: '0xready' }),
    ])
    const lpG = groups.find((g) => g.family === 'lp')!
    expect(lpG.venues).toHaveLength(1)
    expect(lpG.venues[0]!.disabled).toBe(false)
    expect((lpG.venues[0]!.vault as { address: string }).address).toBe('0xready')
  })

  it('omits a family with no vaults', () => {
    const groups = groupVaultsByFamily([v('AaveEndowment', true)])
    expect(groups.map((g) => g.family)).toEqual(['yield'])
  })
})

/** Build a minimal target row for the token-grouping tests. */
const t = (id: number, token: `0x${string}` | undefined): TargetLike => ({ id: BigInt(id), token })

const CULT = '0x00000000000000000000000000000000000c01' as const
const MS2 = '0x00000000000000000000000000000000000ac2' as const

describe('groupTargetsByToken', () => {
  it('leaves a single-target token as a one-target group', () => {
    const groups = groupTargetsByToken([t(1, MS2)])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.targets.map((x) => x.id)).toEqual([1n])
    expect(groups[0]!.primary.id).toBe(1n)
  })

  it('collapses a token registered under two targets into one group carrying both ids', () => {
    // CULT registered under target 2 (e.g. Uniswap V4 route) and target 3 (e.g. Cypher/Algebra route).
    const groups = groupTargetsByToken([t(1, MS2), t(2, CULT), t(3, CULT)])
    expect(groups).toHaveLength(2)
    const cultGroup = groups.find((g) => g.targets.length > 1)!
    expect(cultGroup.targets.map((x) => x.id)).toEqual([2n, 3n])
    expect(cultGroup.primary.id).toBe(2n)
  })

  it('groups regardless of input order, sorting the collapsed ids ascending', () => {
    const groups = groupTargetsByToken([t(5, CULT), t(2, CULT)])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.targets.map((x) => x.id)).toEqual([2n, 5n])
    expect(groups[0]!.primary.id).toBe(2n)
  })

  it('never groups targets with no known token together', () => {
    const groups = groupTargetsByToken([t(1, undefined), t(2, undefined)])
    expect(groups).toHaveLength(2)
  })

  it('would render the multi-target token as two entries if grouping were removed (non-vacuity)', () => {
    // The picker maps one row per array entry — this is what "grouping removed" looks like, and it's
    // exactly the CULT-shown-twice defect the grouping exists to fix.
    const ungrouped = [t(2, CULT), t(3, CULT)]
    expect(ungrouped).toHaveLength(2)
    // With grouping applied, the same input collapses to one row.
    expect(groupTargetsByToken(ungrouped)).toHaveLength(1)
  })
})
