import { useMemo } from 'react'
import type { CollectionFilters, ProjectCard } from './types'
import { useAllCollectionsRaw } from './useAllCollectionsRaw'

/**
 * All-collections hook with client-side filter / sort / search.
 *
 * Wraps `useAllCollectionsRaw` (cached React Query fetch) and applies `CollectionFilters` via
 * `useMemo` — no additional network round-trips.
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

      // status
      if (filters?.status === 'active' && !c.isActive) return false
      if (filters?.status === 'ended' && c.isActive) return false

      // vault (exact address match)
      if (filters?.vault !== undefined && c.vault !== filters.vault) return false

      // search (name, case-insensitive substring)
      const q = filters?.search?.trim().toLowerCase() ?? ''
      if (q !== '' && !c.name.toLowerCase().includes(q)) return false

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
