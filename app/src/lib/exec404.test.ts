import { describe, expect, it } from 'vitest'
import { ownedIdsFromTransfers, type MirrorTransfer } from './exec404'

const A = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const
const B = '0xBbBbBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

function t(
  from: `0x${string}`,
  to: `0x${string}`,
  id: number,
  blockNumber: number,
  logIndex: number,
): MirrorTransfer {
  return { from, to, id: BigInt(id), blockNumber: BigInt(blockNumber), logIndex }
}

describe('ownedIdsFromTransfers', () => {
  it('mint then hold → owned', () => {
    expect(ownedIdsFromTransfers([t(ZERO, A, 5, 10, 0)], A)).toEqual([5n])
  })

  it('received then sent away → not owned', () => {
    const logs = [t(ZERO, A, 5, 10, 0), t(A, B, 5, 20, 0)]
    expect(ownedIdsFromTransfers(logs, A)).toEqual([])
    expect(ownedIdsFromTransfers(logs, B)).toEqual([5n])
  })

  it('replays in chain order regardless of input order, and sorts ids ascending', () => {
    // Out-of-order input: id 7 sent away (block 30) before it was received (block 20).
    const logs = [t(A, B, 7, 30, 0), t(ZERO, A, 3, 15, 0), t(ZERO, A, 7, 20, 0)]
    // 7 received @20 then sent @30 → gone; 3 stays. B holds 7.
    expect(ownedIdsFromTransfers(logs, A)).toEqual([3n])
    expect(ownedIdsFromTransfers(logs, B)).toEqual([7n])
  })

  it('same block ordered by logIndex', () => {
    const logs = [t(A, B, 9, 40, 2), t(ZERO, A, 9, 40, 1)]
    // @40: idx1 mints 9 to A, idx2 sends 9 to B → A empty, B holds.
    expect(ownedIdsFromTransfers(logs, A)).toEqual([])
    expect(ownedIdsFromTransfers(logs, B)).toEqual([9n])
  })

  it('re-received after sending (reroll churn) → owned again', () => {
    const logs = [t(ZERO, A, 4, 10, 0), t(A, B, 4, 20, 0), t(B, A, 4, 30, 0)]
    expect(ownedIdsFromTransfers(logs, A)).toEqual([4n])
  })

  it('case-insensitive address match', () => {
    expect(ownedIdsFromTransfers([t(ZERO, A.toLowerCase() as `0x${string}`, 1, 1, 0)], A)).toEqual([
      1n,
    ])
  })
})
