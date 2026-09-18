/**
 * Curation-grid ordering — and the one place the reason for it is written down.
 *
 * The featured grid next to it is ordered by `featuredRank`, a wei score of what the slot PAID less
 * decay (`lib/featuredOrder`). That is a legitimate way to sell placement and it is labelled as one.
 * It is also, until this surface existed, the ONLY way anything reached the landing page: a person
 * who buys rather than mints could produce nothing noesis would show, at any price they were
 * willing to pay or refuse to.
 *
 * So the curation grid is ordered by RECENCY and by nothing else — `updatedAt`, the chain's own
 * record of when the curator last touched the set, newest first. No score, no payment, no operator
 * list, no engagement signal that a curator could farm and a buyer could buy. The only way to move
 * up this grid is to work on your curation, which is the behaviour the surface is for.
 *
 * Deliberately NOT ordered by item count, curator holdings, or "quality": each of those is either a
 * number someone can buy or a judgement someone would have to make, and re-introducing either would
 * hand the surface back to whoever has the most of it.
 */

/** The ordering key: a curation's last on-chain write, as unix seconds. */
export interface RankedCuration {
  readonly updatedAt: bigint
}

/**
 * Most recently updated first. Stable, so curations written in the same block keep the order the
 * chain returned them in — which is descending id, i.e. still newest-first.
 */
export function orderCurations<T extends RankedCuration>(curations: readonly T[]): readonly T[] {
  return [...curations].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0,
  )
}
