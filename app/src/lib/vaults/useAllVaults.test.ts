import { describe, expect, it } from 'vitest'
import { dedupeVaults } from './useAllVaults'

const A = '0xAAaAAaAAaAAAAaAaaAaAAaAAAaaAaAaAaAAAAAAa' as const
const B = '0xBbBBBBBbBbBbbbbBBbBbbbBBbBBbbbbBbBBbBbBb' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

describe('dedupeVaults', () => {
  it('dedupes by vault, counts alignments, keeps first non-empty name', () => {
    const rows = dedupeVaults([
      { vault: A, vaultName: '' },
      { vault: A, vaultName: 'Neon vault' },
      { vault: B, vaultName: 'Molten vault' },
      { vault: A.toLowerCase() as `0x${string}`, vaultName: 'ignored' },
    ])
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.address.toLowerCase() === A.toLowerCase())
    expect(a?.collectionCount).toBe(3)
    expect(a?.name).toBe('Neon vault') // first non-empty wins
  })

  it('skips the zero address and missing vaults', () => {
    const rows = dedupeVaults([
      { vault: ZERO, vaultName: 'none' },
      { vault: undefined, vaultName: 'none' },
      { vault: A, vaultName: 'Real' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.address).toBe(A)
  })

  it('orders most-aligned first', () => {
    const rows = dedupeVaults([
      { vault: A, vaultName: 'A' },
      { vault: B, vaultName: 'B' },
      { vault: B, vaultName: 'B' },
    ])
    expect(rows.map((r) => r.address)).toEqual([B, A])
  })
})
