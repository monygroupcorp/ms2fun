import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { useReadQueryAggregatorGetHomePageData } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { CollectionCard } from '../components/CollectionCard'
import styles from './CollectionsPage.module.css'
import browseStyles from '../components/CollectionsBrowse.module.css'

type ContractTypeFilter = 'ALL' | 'ERC1155' | 'ERC721' | 'ERC404'
type StatusFilter = 'ALL' | 'active'

/**
 * All-collections browse with client-side filters. Data source: `QueryAggregator.getHomePageData`
 * (featured set only — no full-registry enumeration exists yet; indexed domain layer deferred to
 * Phase 2/3). Filters operate over the featured set; a note reflects this limitation.
 */
export function CollectionsPage() {
  const [typeFilter, setTypeFilter] = useState<ContractTypeFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [search, setSearch] = useState('')

  const { data, isPending, isError } = useReadQueryAggregatorGetHomePageData({
    address: forkAddresses.QueryAggregator,
    chainId: forkChainId,
    args: [0n, 24n],
  })

  const rawCards = data?.[0]

  const filtered = useMemo(() => {
    const allCards = rawCards ?? []
    return allCards.filter((c) => {
      if (typeFilter !== 'ALL' && c.contractType !== typeFilter) return false
      if (statusFilter === 'active' && !c.isActive) return false
      if (search.trim() !== '') {
        const q = search.trim().toLowerCase()
        if (!c.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rawCards, typeFilter, statusFilter, search])

  const allCards = rawCards ?? []

  const typeOptions: ContractTypeFilter[] = ['ALL', 'ERC1155', 'ERC721', 'ERC404']

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
          {isPending
            ? 'loading…'
            : isError
              ? 'error'
              : `${filtered.length} result${filtered.length === 1 ? '' : 's'} · featured set`}
        </span>
        <span className={styles.resultsNote}>
          featured placements only — full browse needs indexed domain layer (Phase 2/3)
        </span>
      </div>

      {isPending && <p className={browseStyles.note}>loading collections…</p>}
      {isError && <p className={browseStyles.note}>discovery unreachable — is the fork up?</p>}

      {!isPending && !isError && filtered.length === 0 && (
        <p className={browseStyles.note} data-testid="collections-empty">
          {allCards.length === 0
            ? 'nothing featured yet — run the seed script to populate.'
            : 'no collections match the current filters.'}
        </p>
      )}

      {!isPending && !isError && filtered.length > 0 && (
        <div className={browseStyles.grid} data-testid="collections-list">
          {filtered.map((c) => (
            <CollectionCard key={c.instance} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}
