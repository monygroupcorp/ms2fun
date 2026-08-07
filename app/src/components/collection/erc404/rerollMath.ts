/**
 * Reroll arithmetic — the app-side mirror of `rerollSelectedNFTs` + `_effectiveExemptions`
 * (`contracts/src/factories/erc404/ERC404BondingOps.sol`).
 *
 * Reroll exempts the ids the holder selected AND, automatically, every tier NFT they own. A tier
 * NFT is one unit of the position and therefore consumes one unit of the amount passed in, exactly
 * as an explicitly exempted id always has. So the number of ORDINARY pieces a given amount rerolls
 * is smaller than the number of units entered, and it can be zero — a case the chain rejects.
 *
 * This lives here, pure and unit-tested, rather than inline in JSX: it is the one piece of logic on
 * this surface that can be wrong in a way a screenshot will not reveal. The two revert conditions
 * below are the contract's, in the contract's order:
 *   1. `tokenAmount < exemptCount * unit`             → TokenAmountMustRepresentNFT
 *   2. `(tokenAmount - exemptCount * unit) / unit == 0` → TokenAmountMustRepresentNFT
 * Dedupe is load-bearing on both sides: the contract appends only the tier ids the caller did NOT
 * already name, so a holder who selects their own tier NFT must not be charged for it twice.
 */

export interface RerollPiece {
  id: bigint
  isTier: boolean
}

export type RerollBlockReason =
  | 'amount-below-exempt-cost'
  | 'nothing-left-to-reroll'
  | 'all-tier-position'

export interface RerollPlan {
  /** Ids the contract will exempt: the holder's selection plus their un-named tier NFTs. */
  exemptedIds: bigint[]
  /** `exemptedIds.length` — the contract's `exemptCount`. */
  exemptCount: number
  /** Ordinary pieces this amount actually rerolls. Zero means the transaction would revert. */
  effectiveCount: number
  /** True when the submit is safe to send. */
  canReroll: boolean
  /** Why not, when `canReroll` is false and an amount was entered. */
  blockReason: RerollBlockReason | undefined
}

/**
 * @param amount   Token amount the holder entered, in base units. `undefined` = nothing entered yet.
 * @param unit     `unit()` — coin per whole NFT. `undefined` = read has not landed.
 * @param pieces   The holder's owned pieces, tier flag included.
 * @param keptIds  Ids the holder explicitly selected to keep.
 */
export function planReroll({
  amount,
  unit,
  pieces,
  keptIds,
}: {
  amount: bigint | undefined
  unit: bigint | undefined
  pieces: RerollPiece[]
  keptIds: bigint[]
}): RerollPlan {
  // `_effectiveExemptions`: the supplied list first, then every owned tier id not already in it.
  const named = new Set(keptIds.map((id) => id.toString()))
  const autoExempt = pieces.filter((p) => p.isTier && !named.has(p.id.toString())).map((p) => p.id)
  const exemptedIds = [...keptIds, ...autoExempt]
  const exemptCount = exemptedIds.length

  const tierCount = pieces.filter((p) => p.isTier).length
  const allTier = pieces.length > 0 && tierCount === pieces.length

  const base = { exemptedIds, exemptCount }

  if (allTier) {
    return { ...base, effectiveCount: 0, canReroll: false, blockReason: 'all-tier-position' }
  }
  if (amount === undefined || unit === undefined || unit <= 0n || amount <= 0n) {
    return { ...base, effectiveCount: 0, canReroll: false, blockReason: undefined }
  }

  const exemptCost = BigInt(exemptCount) * unit
  if (amount < exemptCost) {
    return {
      ...base,
      effectiveCount: 0,
      canReroll: false,
      blockReason: 'amount-below-exempt-cost',
    }
  }

  // Round down, matching the contract's integer NFT count.
  const effectiveCount = Number((amount - exemptCost) / unit)
  if (effectiveCount === 0) {
    return { ...base, effectiveCount: 0, canReroll: false, blockReason: 'nothing-left-to-reroll' }
  }

  return { ...base, effectiveCount, canReroll: true, blockReason: undefined }
}
