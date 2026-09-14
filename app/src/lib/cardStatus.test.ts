import { describe, expect, it } from 'vitest'
import { cardStatus } from './cardStatus'

// The whole vocabulary, stated once. Everything downstream — the browse chip, the collection-page
// kicker, the registry row, the /collections status buckets — reads through this function, so this
// table is the definition of what each surface is allowed to say.

describe('cardStatus', () => {
  it('says Live when a buy would go through now', () => {
    expect(cardStatus({ isActive: true, opensAt: 0n })).toBe('Live')
  })

  it('says Soon when the opening is still ahead', () => {
    expect(cardStatus({ isActive: false, opensAt: 1_700_000_000n })).toBe('Soon')
  })

  it('says nothing for a collection that is over', () => {
    expect(cardStatus({ isActive: false, opensAt: 0n })).toBeNull()
  })

  it('prefers Live when a collection is both open and has more scheduled', () => {
    // An ERC-1155 with one edition minting and another dated for next week. Both facts are true;
    // the one a buyer can act on wins.
    expect(cardStatus({ isActive: true, opensAt: 1_700_000_000n })).toBe('Live')
  })

  it('never invents a third word', () => {
    const states = [
      { isActive: true, opensAt: 0n },
      { isActive: true, opensAt: 1n },
      { isActive: false, opensAt: 1n },
      { isActive: false, opensAt: 0n },
    ]
    for (const s of states) {
      expect([null, 'Live', 'Soon']).toContain(cardStatus(s))
    }
  })
})
