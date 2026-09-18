/**
 * Where a curation's pick points.
 *
 * A pick is an address plus an optional token id, which is all the curator authored. The ROUTE it
 * resolves to needs two more facts the curator never types — the collection's slug and its contract
 * type — and both live on the `ProjectCard` the aggregator returns for that address. So resolving a
 * pick to an href is a join, done here, once, rather than in each surface that renders a pick.
 *
 * A pick whose address the registry does not know resolves to `null`: the collection may never have
 * existed, or may not be on the chain this build talks to. The card renders it as unresolved rather
 * than linking somewhere that 404s.
 */

import type { ProjectCard } from '../discovery'
import type { CurationItem } from '../metadata'

/** Index a card list by lowercased instance address — the key a pick is authored with. */
export function cardsByInstance(
  cards: readonly ProjectCard[] | undefined,
): ReadonlyMap<string, ProjectCard> {
  const map = new Map<string, ProjectCard>()
  for (const card of cards ?? []) map.set(card.instance.toLowerCase(), card)
  return map
}

/** A collection's own page: `/<chainId>/<slug>`, the slug being its lowercased on-chain name. */
export function collectionHref(chainId: number, card: ProjectCard): string {
  return `/${chainId}/${card.name.toLowerCase()}`
}

/**
 * The page for one piece inside a collection.
 *
 * ERC-1155 numbers EDITIONS and routes at `/edition/:id`; ERC-721 and ERC-404 number TOKENS and
 * route at `/token/:id`. The two are different pages, so the contract type decides — a pick cannot
 * carry the distinction because the curator picked from a page, not from a type.
 */
export function pieceHref(chainId: number, card: ProjectCard, tokenId: string): string {
  const segment = card.contractType === 'ERC1155' ? 'edition' : 'token'
  return `${collectionHref(chainId, card)}/${segment}/${tokenId}`
}

/** Where this pick goes, or `null` when no known collection answers to its address. */
export function curationItemHref(
  chainId: number,
  item: CurationItem,
  cards: ReadonlyMap<string, ProjectCard>,
): string | null {
  const card = cards.get(item.instance.toLowerCase())
  if (card === undefined) return null
  return item.tokenId === ''
    ? collectionHref(chainId, card)
    : pieceHref(chainId, card, item.tokenId)
}
