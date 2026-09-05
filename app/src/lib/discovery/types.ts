/**
 * Shared types for the event-indexed all-collections discovery layer (W-A2).
 *
 * `ProjectCard` is derived here directly from the QueryAggregator ABI return type and consumed by
 * both the discovery hooks and `components/useCreatorCollections`; there is ONE definition and no
 * hand-written duplicate.
 */
import type { ContractFunctionReturnType } from 'viem'
import { queryAggregatorAbi } from '../../generated/contracts'

export type ProjectCard = ContractFunctionReturnType<
  typeof queryAggregatorAbi,
  'view',
  'getProjectCardsBatch'
>[number]

/**
 * Client-side filter/sort descriptor passed to `useAllCollections`.
 *
 * All fields are optional — omitting a field means "no constraint on that axis".
 *
 * `sort`:
 *  - 'recent'  → discovery order (registeredAt desc; registry logs are oldest-first so we reverse)
 *  - 'tvl'     → not yet available on ProjectCard; field is accepted but treated as 'recent'
 *                 until a tvl field is added to the contract return; see graceful-omit note in
 *                 useAllCollections.ts
 *  - 'name'    → alphabetical (case-insensitive)
 *
 * `search`: case-insensitive substring, matched against `name` OR `creator`.
 *
 * `status`: the three buckets of `lib/cardStatus`, so a filter selects exactly the cards that draw
 * that chip and nothing else.
 *  - 'live'  → buyable at the block the cards were read
 *  - 'soon'  → not yet buyable, with an opening still ahead of that block
 *  - 'ended' → neither: sold out, graduated, settled, or never armed. The bucket the chip is silent
 *              about; it still gets a filter, because "show me what is over" is a real question even
 *              when the answer needs no badge on each card.
 */
export interface CollectionFilters {
  type?: 'ALL' | 'ERC1155' | 'ERC721' | 'ERC404'
  status?: 'ALL' | 'live' | 'soon' | 'ended'
  vault?: `0x${string}`
  search?: string
  sort?: 'recent' | 'tvl' | 'name'
}
