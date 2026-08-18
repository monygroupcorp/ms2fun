import { describe, expect, it } from 'vitest'
import { orderFeatured } from './featuredOrder'

const card = (id: string, featuredRank: bigint) => ({ id, featuredRank })

describe('orderFeatured', () => {
  // noesis-311: the defect this function exists for. The chain sells placement by rank score;
  // the grid must lead with the biggest payer, not the smallest.
  it('leads with the biggest payer', () => {
    const ordered = orderFeatured([card('small', 1n * 10n ** 18n), card('big', 5n * 10n ** 18n)])
    expect(ordered.map((c) => c.id)).toEqual(['big', 'small'])
  })

  it('sorts descending by featuredRank', () => {
    const ordered = orderFeatured([card('a', 3n), card('b', 9n), card('c', 5n)])
    expect(ordered.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts unranked entries last', () => {
    const ordered = orderFeatured([card('unranked', 0n), card('ranked', 1n)])
    expect(ordered.map((c) => c.id)).toEqual(['ranked', 'unranked'])
  })

  it('is stable for equal ranks — the chain already made that tiebreak', () => {
    const ordered = orderFeatured([card('first', 7n), card('second', 7n), card('third', 7n)])
    expect(ordered.map((c) => c.id)).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate its input', () => {
    const input = [card('a', 1n), card('b', 2n)]
    orderFeatured(input)
    expect(input.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
