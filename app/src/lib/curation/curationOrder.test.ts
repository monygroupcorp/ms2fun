import { describe, expect, it } from 'vitest'
import { orderCurations } from './curationOrder'

const at = (id: number, updatedAt: number) => ({ id, updatedAt: BigInt(updatedAt) })

describe('orderCurations', () => {
  it('puts the most recently updated first', () => {
    const ordered = orderCurations([at(1, 100), at(2, 300), at(3, 200)])
    expect(ordered.map((c) => c.id)).toEqual([2, 3, 1])
  })

  it('is stable for curations written in the same block', () => {
    const ordered = orderCurations([at(9, 500), at(8, 500), at(7, 500)])
    expect(ordered.map((c) => c.id)).toEqual([9, 8, 7])
  })

  it('does not mutate its input', () => {
    const input = [at(1, 100), at(2, 300)]
    orderCurations(input)
    expect(input.map((c) => c.id)).toEqual([1, 2])
  })

  it('handles an empty grid', () => {
    expect(orderCurations([])).toEqual([])
  })

  /**
   * The guard on the whole point of the surface: a curation carries no paid score, so there is
   * nothing on it that money could reorder. If a rank field is ever added, this fails to compile.
   */
  it('reads only updatedAt — nothing on a curation is purchasable', () => {
    const paidMore = { updatedAt: 100n, featuredRank: 10n ** 21n, id: 1 }
    const paidNothing = { updatedAt: 200n, featuredRank: 0n, id: 2 }
    expect(orderCurations([paidMore, paidNothing]).map((c) => c.id)).toEqual([2, 1])
  })
})
