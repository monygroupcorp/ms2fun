/**
 * Shared types for the event-indexed all-collections discovery layer (W-A2).
 *
 * `ProjectCard` is re-exported from `useCreatorCollections` — both hooks share ONE definition
 * derived from the ABI return type; there is no hand-written duplicate.
 */
export type { ProjectCard } from '../../components/useCreatorCollections'

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
 */
export interface CollectionFilters {
  type?: 'ALL' | 'ERC1155' | 'ERC721' | 'ERC404'
  status?: 'ALL' | 'active' | 'ended'
  vault?: `0x${string}`
  search?: string
  sort?: 'recent' | 'tvl' | 'name'
}
