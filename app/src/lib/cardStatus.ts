/**
 * The one status vocabulary the browse surfaces speak.
 *
 * Two words, because two are all a buyer can act on. `Live` means a buy placed now would go
 * through. `Soon` means it would not, and there is a moment when it will. Everything else — a curve
 * bought out or graduated, an auction ended, an edition run finished, a collection its creator
 * never armed — gets NO label. A finished thing does not need a badge announcing that it is
 * finished: the minted-of-cap figure sitting beside it already says so, and the badge was the
 * loudest element on a card whose only news was that there was no news.
 *
 * Both terms are decided on chain. `isActive` is the buy path's own predicate, mirrored per family
 * by the lens; `opensAt` is non-zero only while the opening is still ahead of the block the card was
 * read at. Nothing here consults the browser's clock, so a machine set five minutes fast cannot
 * disagree with the chain about which state a collection is in.
 *
 * `isActive` wins over `opensAt` when both hold — a collection with one edition open and another
 * scheduled is buyable now, and Live is the more actionable of the two.
 */
export type CardStatus = 'Live' | 'Soon'

/** The card fields a status is read from — structural, so a preview can pass a small mock. */
export interface CardStatusFields {
  isActive: boolean
  opensAt: bigint
}

/** `null` = this collection gets no chip. See the note above for why that is a state and not a gap. */
export function cardStatus(card: CardStatusFields): CardStatus | null {
  if (card.isActive) return 'Live'
  if (card.opensAt > 0n) return 'Soon'
  return null
}
