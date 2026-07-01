import { describe, expect, it } from 'vitest'
import { deriveVaultFlavor, groupVaultsByFamily, venueLabel, type VaultLike } from './vaultFlavor'

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
