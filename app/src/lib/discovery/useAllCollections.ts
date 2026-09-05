import { useMemo } from 'react'
import { cardStatus } from '../cardStatus'
import type { CollectionFilters, ProjectCard } from './types'
import { useAllCollectionsRaw } from './useAllCollectionsRaw'

/**
 * All-collections hook with client-side filter / sort / search.
 *
 * Wraps `useAllCollectionsRaw` (cached React Query fetch) and applies `CollectionFilters` via
 * `useMemo` — no additional network round-trips.
 *
 * Search matches `name` or `creator` as a case-insensitive substring, which is what the search
 * box on /collections advertises.
 *
 * Status filters through `lib/cardStatus`, the one function the browse chip also renders from — the
 * Live bucket is exactly the set of cards showing a Live chip, Soon likewise, and Ended is the set
 * showing none.
 *
 * Sort behaviour:
 *  - 'recent' (default) → reverse discovery order (newest registered first).
 *    `registeredAt` is a uint256 block-timestamp; logs are returned oldest-first so reversing
 *    gives newest-first. Falls back gracefully if registeredAt is 0n (returns stable order).
 *  - 'tvl'    → no tvl field on `ProjectCard` yet; falls through to 'recent' ordering.
 *    When a tvl field is added to the contract / ABI, replace the TODO below.
 *  - 'name'   → case-insensitive alphabetical by `name`.
 *
 * Returns `total` = count of matched (filtered) cards so callers can render "N results" without
 * an extra slice.
 */
export function useAllCollections(filters?: CollectionFilters): {
  data: ProjectCard[] | undefined
  isPending: boolean
  isError: boolean
  total: number
} {
  const { data: raw, isPending, isError } = useAllCollectionsRaw()

  const data = useMemo((): ProjectCard[] | undefined => {
    if (!raw) return undefined

    // ── filter ──────────────────────────────────────────────────────────────────────────────
    let result = raw.filter((c) => {
      // type
      const typeFilter = filters?.type ?? 'ALL'
      if (typeFilter !== 'ALL' && c.contractType !== typeFilter) return false

      // status — read through `cardStatus`, the same function the chip renders from, so a card can
      // never sit in a bucket whose name it does not wear. 'ended' is the bucket that draws no chip.
      const status = filters?.status ?? 'ALL'
      if (status === 'live' && cardStatus(c) !== 'Live') return false
      if (status === 'soon' && cardStatus(c) !== 'Soon') return false
      if (status === 'ended' && cardStatus(c) !== null) return false

      // vault (exact address match, case-insensitive — c.vault is EIP-55 checksummed from the
      // contract read; filters.vault may arrive lowercase, e.g. from a route param)
      if (filters?.vault !== undefined && c.vault?.toLowerCase() !== filters.vault.toLowerCase())
        return false

      // search (name OR creator address, case-insensitive substring). The box on /collections
      // reads "Search collections, creators…", so a pasted creator address — full or a prefix —
      // has to hit; matching `name` alone returned "no results", which reads as "this creator has
      // nothing" rather than "this box does not search that".
      const q = filters?.search?.trim().toLowerCase() ?? ''
      if (q !== '' && !c.name.toLowerCase().includes(q) && !c.creator.toLowerCase().includes(q))
        return false

      return true
    })

    // ── sort ─────────────────────────────────────────────────────────────────────────────────
    const sort = filters?.sort ?? 'recent'

    if (sort === 'name') {
      result = [...result].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    } else if (sort === 'tvl') {
      // TODO: sort by tvl when a tvl field is added to ProjectCard / QueryAggregator.
      // For now fall through to 'recent' (discovery order reversed).
      result = [...result].reverse()
    } else {
      // 'recent': newest registered first — reverse the log-order array.
      result = [...result].reverse()
    }

    return result
  }, [raw, filters?.type, filters?.status, filters?.vault, filters?.search, filters?.sort])

  return {
    data,
    isPending,
    isError,
    total: data?.length ?? 0,
  }
}
