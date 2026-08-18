/**
 * Featured-grid ordering.
 *
 * `featuredRank` is a wei-denominated SCORE, not a position: `FeaturedQueueManager._effectiveRank`
 * returns the slot's cumulative rank payment less decay, and `getFeaturedInstances` sorts it
 * DESCENDING ("position 1 first"). Higher rank = paid more = higher placement.
 *
 * The landing page previously re-sorted the chain's array ascending, on the belief that rank was a
 * position — which led the grid with the SMALLEST payer (noesis-311). This is the one place that
 * ordering is expressed, so the direction is stated once and tested.
 */
export interface RankedCard {
  readonly featuredRank: bigint
}

/**
 * Highest `featuredRank` first. Unranked (0) entries land at the end by construction. Stable, so
 * equal ranks keep the order the chain returned them in — that tiebreak is already the chain's.
 */
export function orderFeatured<T extends RankedCard>(cards: readonly T[]): readonly T[] {
  return [...cards].sort((a, b) =>
    a.featuredRank > b.featuredRank ? -1 : a.featuredRank < b.featuredRank ? 1 : 0,
  )
}
