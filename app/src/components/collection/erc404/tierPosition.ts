/**
 * Token Tiers position math — the pure counterpart to `useTierPosition.ts`. No wagmi, no React, so
 * the band walk and the escrow arithmetic are unit-testable without a chain.
 *
 * Mirrors `ERC404BondingStorage._bandOf` / `ERC404BondingInstance.coinBalanceOf`
 * (`contracts/src/factories/erc404/ERC404BondingStorage.sol`, `ERC404BondingInstance.sol`) — read
 * those before changing this file. The contract's band walk is the single source of truth; this is a
 * third implementation of the same walk and must keep agreeing with it.
 */

/** One rung of the sealed ladder. `idStart`/`idEnd` are inclusive; `weight` is in `unit()`s. */
export interface TierBand {
  idStart: bigint
  idEnd: bigint
  weight: bigint
}

export interface BandInfo {
  isBand: boolean
  /** 1-based tier number (`tierBands[tierN - 1]`). */
  tierN: number
  weight: bigint
}

/**
 * Classifies `id` against the sealed ladder. A band id is one **strictly above** `idLimit` — an id
 * `=== idLimit` is the top of the ordinary space, not a band. Which band it is comes from walking
 * `tierBands` and matching `idStart <= id <= idEnd`, exactly as `_bandOf` does on-chain.
 *
 * Returns `null` for an ordinary id (`id <= idLimit`) or an above-limit id that matches no sealed
 * band (should not occur against a live ladder — bands cover every id above the limit at seal time —
 * but the walk does not assume it).
 */
export function bandOf(
  id: bigint,
  tierBands: readonly TierBand[],
  idLimit: bigint,
): BandInfo | null {
  if (id <= idLimit) return null
  for (let i = 0; i < tierBands.length; i++) {
    const band = tierBands[i]
    if (band && id >= band.idStart && id <= band.idEnd) {
      return { isBand: true, tierN: i + 1, weight: band.weight }
    }
  }
  return null
}

/**
 * Coin escrowed behind one band NFT of the given `weight`, in base units. A band NFT is worth this
 * escrow **plus** the one unit of balance the NFT itself already is — the two are kept separate here
 * (never pre-summed) because the hook's consumers display them differently.
 */
export function escrowBehind(weight: bigint, unit: bigint): bigint {
  return (weight - 1n) * unit
}

/**
 * Local reconstruction of `coinBalanceOf`: liquid `balance` plus the escrow behind every owned band
 * piece. The contract value is authoritative for display — this exists because a future caller
 * (noesis-173) must predict a position that does not exist on-chain yet, which no view can answer.
 */
export function coinHoldings(
  balance: bigint,
  bandPieces: readonly { weight: bigint }[],
  unit: bigint,
): bigint {
  return bandPieces.reduce((total, piece) => total + escrowBehind(piece.weight, unit), balance)
}
