import { useState } from 'react'
import { Link } from 'wouter'
import { useAllCollections } from '../lib/discovery'
import type { CollectionFilters } from '../lib/discovery'
import { CollectionCard } from '../components/CollectionCard'
import styles from './CollectionsPage.module.css'
import browseStyles from '../components/CollectionsBrowse.module.css'

type TypeFilter = NonNullable<CollectionFilters['type']>
type StatusFilter = NonNullable<CollectionFilters['status']>
type SortFilter = NonNullable<CollectionFilters['sort']>

/**
 * All-collections browse — full registry enumeration via `useAllCollections` (W-A2).
 *
 * Data source: `MasterRegistryV1.CreatorInstanceAdded` event scan → deduped instance list →
 * `QueryAggregator.getProjectCardsBatch`. This is the complete set of registered instances, not
 * just featured ones. Filters and sort are applied client-side via `useAllCollections`.
 *
 * After a create or feature tx, invalidate the cache with:
 *   queryClient.invalidateQueries({ queryKey: ['all-collections'] })
 * (wiring this into the wizard / admin panel is a later task — not part of W-A2).
 */
export function CollectionsPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [sort, setSort] = useState<SortFilter>('recent')
  const [search, setSearch] = useState('')

  const { data, isPending, isError, total } = useAllCollections({
    type: typeFilter,
    status: statusFilter,
    sort,
    search,
  })

  const typeOptions: TypeFilter[] = ['ALL', 'ERC1155', 'ERC721', 'ERC404']
  const sortOptions: { value: SortFilter; label: string }[] = [
    { value: 'recent', label: 'RECENT' },
    { value: 'name', label: 'NAME' },
    { value: 'tvl', label: 'TVL' },
  ]

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <h1 className={`${styles.title} text-chromatic-medium`}>COLLECTIONS</h1>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>TYPE</span>
          <div className={styles.filterButtons}>
            {typeOptions.map((t) => (
              <button
                key={t}
                className={`${styles.filterBtn} ${typeFilter === t ? styles.filterBtnActive : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>STATUS</span>
          <div className={styles.filterButtons}>
            {(['ALL', 'active'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={`${styles.filterBtn} ${statusFilter === s ? styles.filterBtnActive : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>SORT</span>
          <div className={styles.filterButtons}>
            {sortOptions.map(({ value, label }) => (
              <button
                key={value}
                className={`${styles.filterBtn} ${sort === value ? styles.filterBtnActive : ''}`}
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="collections-search">
            SEARCH
          </label>
          <input
            id="collections-search"
            className={styles.searchInput}
            type="text"
            placeholder="name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount}>
          {isPending ? 'loading…' : isError ? 'error' : `${total} result${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {isPending && <p className={browseStyles.note}>loading collections…</p>}
      {isError && <p className={browseStyles.note}>discovery unreachable — is the fork up?</p>}

      {!isPending && !isError && total === 0 && (
        <p className={browseStyles.note} data-testid="collections-empty">
          {data !== undefined &&
          data.length === 0 &&
          search === '' &&
          typeFilter === 'ALL' &&
          statusFilter === 'ALL'
            ? 'nothing registered yet — run the seed script to populate.'
            : 'no collections match the current filters.'}
        </p>
      )}

      {!isPending && !isError && data !== undefined && data.length > 0 && (
        <div className={browseStyles.grid} data-testid="collections-list">
          {data.map((c) => (
            <CollectionCard key={c.instance} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}
