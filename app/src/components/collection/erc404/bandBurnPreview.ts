/**
 * Debit-burns-your-band preview — the app-side mirror of DN404's reconciliation burn
 * (`contracts/lib/dn404/src/DN404.sol`, `_burn`'s burn loop) as it applies to a coin-path debit
 * (sell or stake) on a tiered ERC-404 position.
 *
 * DN404 reconciles every debit by burning `ownedLength - balance/unit` NFTs LIFO off the TAIL of
 * `owned[holder]`. `mintUp`'s escrow leg is an in-place id SWAP — `ownedLength`, `balance` and
 * `totalNFTSupply` are all unchanged by it (`contracts/src/factories/erc404/ERC404BondingOps.sol`,
 * `mintUp`) — so `ownedLength == balance / unit` holds on a tiered instance exactly as it does on an
 * untiered one, and the burn COUNT is pure arithmetic over `balance`, the debited `amount` and
 * `unit`. No array knowledge required for the count.
 *
 * Which ids burn is a different question. `mintUp` ends by moving the new band to owned index 0
 * (`_moveOwnedIdToFront`) — the position the tail burn reaches LAST — so a holder with exactly ONE
 * band has it protected from every debit except one that empties the whole position: the burn count
 * only reaches index 0 when it burns everything. That is knowable and reported here as `exact`. A
 * second `mintUp` displaces whatever already sat at index 0 into an arbitrary slot (wherever the new
 * band's `tierZeroId` was), so with two or more bands the app has no positional knowledge left and
 * can only report the combinatorial worst case: at most `bandCount` of the burned pieces are bands,
 * at least `piecesBurned - ordinaryCount` of them are (pigeonhole).
 *
 * Pure, no chain access — the caller resolves `balance`/`unit`/`bandPieces` from `useTierPosition` /
 * `useErc404OwnedPieces` and predicts a position that does not exist on-chain yet (a post-debit
 * preview, before the transaction is signed).
 */
import { escrowBehind } from './tierPosition'

export interface BandBurnPiece {
  id: bigint
  tierN: number
  weight: bigint
}

export interface BandBurnPreview {
  /** NFT pieces the debit burns: ownedLength - (balance - amount)/unit. Exact, always. */
  piecesBurned: number
  /** Fewest band NFTs that can be among them: max(0, piecesBurned - ordinaryCount). */
  bandsBurnedMin: number
  /** Most that can be: min(piecesBurned, bandCount). Zero here means NO warning is shown. */
  bandsBurnedMax: number
  /** True when bandsBurnedMin === bandsBurnedMax AND the holder owns exactly one band — the
   *  only case where the outcome is knowable, not bounded. */
  exact: boolean
  /** The band that burns, when `exact` and a band burns at all. Otherwise undefined. */
  bandBurned: BandBurnPiece | undefined
  /** Escrow credited to the HOLDER as claimable, worst case: the highest-weight bands the bound
   *  allows. Exact when `exact`. */
  escrowReleasedMax: bigint
}

const EMPTY_PREVIEW: BandBurnPreview = {
  piecesBurned: 0,
  bandsBurnedMin: 0,
  bandsBurnedMax: 0,
  exact: false,
  bandBurned: undefined,
  escrowReleasedMax: 0n,
}

/**
 * @param balance    `balanceOf(holder)` BEFORE the debit, in base units. `balanceOf`-primacy —
 *                   never `coinBalanceOf`/holdings (see `useTierPosition`'s docstring).
 * @param amount     The coin amount the pending sell/stake would debit, in base units. `undefined`
 *                   = nothing entered yet.
 * @param unit       `unit()` — coin per whole NFT.
 * @param bandPieces The holder's currently owned band pieces (empty on an untiered instance).
 */
export function previewBandBurn({
  balance,
  amount,
  unit,
  bandPieces,
}: {
  balance: bigint | undefined
  amount: bigint | undefined
  unit: bigint | undefined
  bandPieces: readonly BandBurnPiece[]
}): BandBurnPreview {
  if (balance === undefined || amount === undefined || unit === undefined || unit <= 0n) {
    return EMPTY_PREVIEW
  }
  // `amount > balance` is not this module's business — the sell/stake path already guards it.
  if (amount > balance) return EMPTY_PREVIEW

  const bandCount = bandPieces.length
  if (bandCount === 0) return EMPTY_PREVIEW // untiered — every ERC-404 shipped to date

  const ownedLen = balance / unit
  const remainingLen = (balance - amount) / unit
  const piecesBurned = Number(ownedLen - remainingLen)
  if (piecesBurned === 0) return EMPTY_PREVIEW

  // A lone band sits at owned index 0 (`_moveOwnedIdToFront`) — the last slot DN404's LIFO tail
  // burn reaches. It cannot be touched short of a debit that empties the whole position, so the
  // single-band case is knowable exactly rather than merely bounded.
  if (bandCount === 1) {
    const wholePosition = piecesBurned === Number(ownedLen)
    if (!wholePosition) return { ...EMPTY_PREVIEW, piecesBurned }
    const band = bandPieces[0] as BandBurnPiece
    return {
      piecesBurned,
      bandsBurnedMin: 1,
      bandsBurnedMax: 1,
      exact: true,
      bandBurned: band,
      escrowReleasedMax: escrowBehind(band.weight, unit),
    }
  }

  // Two or more bands: a second `mintUp` displaces whatever sat at index 0 into an arbitrary slot,
  // so no positional knowledge survives. Combinatorial worst case over the count alone.
  const ordinaryCount = Number(ownedLen) - bandCount
  const bandsBurnedMin = Math.max(0, piecesBurned - ordinaryCount)
  const bandsBurnedMax = Math.min(piecesBurned, bandCount)
  if (bandsBurnedMax === 0) return { ...EMPTY_PREVIEW, piecesBurned }

  const worstCaseBands = [...bandPieces]
    .sort((a, b) => (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1))
    .slice(0, bandsBurnedMax)
  const escrowReleasedMax = worstCaseBands.reduce(
    (sum, piece) => sum + escrowBehind(piece.weight, unit),
    0n,
  )

  return {
    piecesBurned,
    bandsBurnedMin,
    bandsBurnedMax,
    exact: false,
    bandBurned: undefined,
    escrowReleasedMax,
  }
}
