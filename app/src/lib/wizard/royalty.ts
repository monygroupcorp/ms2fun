/**
 * The creator's secondary-royalty rate, from what they type to what the factory takes.
 *
 * Creators think in percent — objkt asks for one, Manifold asks for one — and the contracts speak
 * basis points, so the conversion lives here rather than inline in the submit builder, next to the
 * one place that knows the cap.
 *
 * What this rate IS: a request. EIP-2981 publishes "this collection expects X% on a resale" and
 * carries no enforcement whatsoever. OpenSea made creator fees optional in August 2023 and now
 * enforces them only for the transfer-restricting ERC-721-C family, which noesis does not
 * implement; objkt's own documentation says royalties "can't be fully enforced on-chain" and that
 * it honors them by choice. So a venue that honors the standard will pay this, and one that does
 * not will not. It is still strictly better than publishing nothing, which is a guaranteed zero.
 *
 * What this rate is NOT: the 19% alignment tithe. That is a contract constant levied on PRIMARY
 * settlement — an edition mint, an auction close, a curve's graduation — and it takes nothing from
 * a resale. A royalty is creator-set and creator-paid. Two surfaces used to conflate them.
 */

/**
 * Ceiling on a creator-set royalty, in percent. Must equal `RoyaltyLib.MAX_ROYALTY_BPS / 100` in
 * `contracts/src/shared/libraries/RoyaltyLib.sol` — the contract refuses anything above it and
 * takes the whole create down with it, so a wizard that accepted more would only produce a reverted
 * transaction and a creator with no idea why.
 */
export const MAX_ROYALTY_PERCENT = 10

/**
 * Percent as typed → basis points for the factory.
 *
 * Blank, garbage and negative all mean "ask for no royalty", which is the default and a position a
 * creator may hold. Above the cap CLAMPS rather than reverting: the schema's `max` already refuses
 * it at the field, so a value arriving here over the cap is a bug in this app and not a creator's
 * intent — clamping ships them the legal maximum instead of a failed deploy they cannot diagnose.
 *
 * Rounds to the nearest basis point, so 2.5% is 250 and 0.125% is 13 rather than silently 12.
 */
export function royaltyBpsFromPercent(value: string | number | undefined): number {
  const n = typeof value === 'number' ? value : Number((value ?? '').toString().trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_ROYALTY_PERCENT * 100, Math.round(n * 100))
}
