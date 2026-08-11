import { describe, expect, it } from 'vitest'
import { previewBandBurn, type BandBurnPiece } from './bandBurnPreview'
import { escrowBehind } from './tierPosition'

const UNIT = 1_000_000_000_000_000_000n // 1e18 coin per whole NFT

const band = (id: bigint, tierN: number, weight: bigint): BandBurnPiece => ({ id, tierN, weight })

describe('previewBandBurn', () => {
  it('renders nothing on an untiered instance regardless of how much burns — the invariant is DN404 default', () => {
    const preview = previewBandBurn({
      balance: 5n * UNIT,
      amount: 5n * UNIT,
      unit: UNIT,
      bandPieces: [],
    })
    expect(preview.bandsBurnedMax).toBe(0)
  })

  it('pins ownedLength == balance/unit (ERC404BondingOps.sol mintUp docstring): derives piecesBurned from balance/unit alone and it agrees with a fixture where the owned-piece count (3 ordinary + 2 bands = 5) was set to match balance == 5*UNIT exactly', () => {
    const ownedPieceCount = 3 /* ordinary */ + 2 /* bands */
    const preview = previewBandBurn({
      balance: BigInt(ownedPieceCount) * UNIT,
      amount: 2n * UNIT,
      unit: UNIT,
      bandPieces: [band(1n, 1, 2n), band(2n, 2, 5n)],
    })
    // ownedLen (balance/unit) == 5, matching ownedPieceCount independently — if the invariant
    // broke (a mismatched owned-pieces count), piecesBurned below would be off by the drift.
    expect(preview.piecesBurned).toBe(2)
  })

  it('one band, sub-unit debit: floor division means ownedLength does not move — no NFT burns at all', () => {
    // ownedLen = 3 (2 ordinary + 1 band). Debit half a unit: balance stays above 2*UNIT, so
    // remainingLen is still 3 and piecesBurned is 0.
    const preview = previewBandBurn({
      balance: 3n * UNIT + UNIT / 2n,
      amount: UNIT / 2n,
      unit: UNIT,
      bandPieces: [band(9001n, 1, 3n)],
    })
    expect(preview.piecesBurned).toBe(0)
    expect(preview.bandsBurnedMax).toBe(0)
  })

  it('one band, partial sell that burns ordinary pieces only: `_moveOwnedIdToFront` (ERC404BondingOps.sol) keeps the band at index 0, the LAST slot the LIFO tail burn reaches, so a non-whole-position debit cannot touch it', () => {
    // ownedLen = 4 (3 ordinary + 1 band). Debit 2 whole units — burns 2 ordinary pieces off the
    // tail; the band at index 0 is untouched because the position is not emptied.
    const preview = previewBandBurn({
      balance: 4n * UNIT,
      amount: 2n * UNIT,
      unit: UNIT,
      bandPieces: [band(9001n, 1, 3n)],
    })
    expect(preview.piecesBurned).toBe(2)
    expect(preview.bandsBurnedMax).toBe(0) // no warning — the band cannot be among the 2 burned
  })

  it('one band, whole position: the debit that empties the position is the ONLY one that reaches index 0 — exact and named', () => {
    const weight = 3n
    const preview = previewBandBurn({
      balance: 4n * UNIT,
      amount: 4n * UNIT,
      unit: UNIT,
      bandPieces: [band(9001n, 1, weight)],
    })
    expect(preview.piecesBurned).toBe(4)
    expect(preview.bandsBurnedMin).toBe(1)
    expect(preview.bandsBurnedMax).toBe(1)
    expect(preview.exact).toBe(true)
    expect(preview.bandBurned).toEqual(band(9001n, 1, weight))
    expect(preview.escrowReleasedMax).toBe(escrowBehind(weight, UNIT))
  })

  it('two bands: a second mintUp displaces the first band off index 0 into an unknown slot, so the burn is a genuine range, not a name', () => {
    // ownedLen = 5 (3 ordinary + 2 bands). Debit 4 units: piecesBurned = 4, ordinaryCount = 3.
    // bandsBurnedMin = max(0, 4-3) = 1 (pigeonhole: at least one band must be among 4 burned
    // pieces when only 3 are ordinary). bandsBurnedMax = min(4, 2) = 2.
    const preview = previewBandBurn({
      balance: 5n * UNIT,
      amount: 4n * UNIT,
      unit: UNIT,
      bandPieces: [band(1n, 1, 2n), band(2n, 2, 5n)],
    })
    expect(preview.piecesBurned).toBe(4)
    expect(preview.bandsBurnedMin).toBe(1)
    expect(preview.bandsBurnedMax).toBe(2)
    expect(preview.exact).toBe(false)
    expect(preview.bandBurned).toBeUndefined()
    // Worst case: the two highest-weight bands among bandsBurnedMax — here both bands.
    expect(preview.escrowReleasedMax).toBe(escrowBehind(2n, UNIT) + escrowBehind(5n, UNIT))
  })

  it('two bands, the boundary where piecesBurned exactly equals ordinaryCount: the lower bound drops to zero but the upper bound stays open — a range, not a clearance', () => {
    // ownedLen = 5 (3 ordinary + 2 bands). Debit exactly 3 units: piecesBurned == ordinaryCount,
    // so bandsBurnedMin = max(0, 3-3) = 0 — but bandsBurnedMax = min(3, 2) = 2 still, because the
    // worst case (both bands sitting in the burned tail) remains possible.
    const preview = previewBandBurn({
      balance: 5n * UNIT,
      amount: 3n * UNIT,
      unit: UNIT,
      bandPieces: [band(1n, 1, 2n), band(2n, 2, 5n)],
    })
    expect(preview.piecesBurned).toBe(3)
    expect(preview.bandsBurnedMin).toBe(0)
    expect(preview.bandsBurnedMax).toBe(2)
    expect(preview.exact).toBe(false)
  })

  it('two bands, amount === balance (full clearance): both bands are guaranteed to burn, min meets max, but the two-band case is still reported as a bound, not a name — naming is reserved for exactly one band', () => {
    const preview = previewBandBurn({
      balance: 5n * UNIT,
      amount: 5n * UNIT,
      unit: UNIT,
      bandPieces: [band(1n, 1, 2n), band(2n, 2, 5n)],
    })
    expect(preview.piecesBurned).toBe(5)
    expect(preview.bandsBurnedMin).toBe(2)
    expect(preview.bandsBurnedMax).toBe(2)
    expect(preview.exact).toBe(false) // bandCount !== 1
  })

  it("amount > balance is not this module's business — returns a zeroed preview rather than negative counts", () => {
    const preview = previewBandBurn({
      balance: 1n * UNIT,
      amount: 2n * UNIT,
      unit: UNIT,
      bandPieces: [band(1n, 1, 2n)],
    })
    expect(preview).toEqual({
      piecesBurned: 0,
      bandsBurnedMin: 0,
      bandsBurnedMax: 0,
      exact: false,
      bandBurned: undefined,
      escrowReleasedMax: 0n,
    })
  })

  it('undefined inputs (reads not yet landed) return a zeroed preview, not a throw', () => {
    expect(
      previewBandBurn({ balance: undefined, amount: 1n * UNIT, unit: UNIT, bandPieces: [] })
        .bandsBurnedMax,
    ).toBe(0)
    expect(
      previewBandBurn({ balance: 1n * UNIT, amount: undefined, unit: UNIT, bandPieces: [] })
        .bandsBurnedMax,
    ).toBe(0)
    expect(
      previewBandBurn({ balance: 1n * UNIT, amount: 1n * UNIT, unit: undefined, bandPieces: [] })
        .bandsBurnedMax,
    ).toBe(0)
  })
})
