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
 *  - 'name'    → alphabetical (case-insensitive)
 *
 * There is deliberately no 'tvl' option: `ProjectCard` carries no value figure, so a TVL sort
 * would have to invent one. Add it back only alongside a real per-instance figure on the card.
 *
 * `search`: case-insensitive substring, matched against `name` OR `creator`.
 */
export interface CollectionFilters {
  type?: 'ALL' | 'ERC1155' | 'ERC721' | 'ERC404'
  status?: 'ALL' | 'active' | 'ended'
  vault?: `0x${string}`
  search?: string
  sort?: 'recent' | 'name'
}
