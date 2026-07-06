import { useState } from 'react'
import { Link } from 'wouter'
import { formatGwei } from 'viem'
import { useAllCollections } from '../lib/discovery'
import type { CollectionFilters, ProjectCard } from '../lib/discovery'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { truncateAddress } from '../lib/format'
import { CollectionCard } from '../components/CollectionCard'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './CollectionsPage.module.css'
import browseStyles from '../components/CollectionsBrowse.module.css'

type TypeFilter = NonNullable<CollectionFilters['type']>
type StatusFilter = NonNullable<CollectionFilters['status']>
type SortFilter = NonNullable<CollectionFilters['sort']>
type View = 'grid' | 'list'

const TYPE_LABEL: Record<string, string> = {
  ERC404: 'ERC-404',
  ERC1155: 'ERC-1155',
  ERC721: 'ERC-721',
}

/**
 * All-collections browse ("the wall") — full registry enumeration via `useAllCollections` (W-A2):
 * `MasterRegistryV1.CreatorInstanceAdded` scan → `getProjectCardsBatch`. Filters/sort/search are
 * client-side. NOESIS: a contact-sheet GRID of `.noesis-card`s, or a de-arted registry LIST
 * (`.noesis-reg`) via the Grid/List toggle — the same data, two readings.
 */
export function CollectionsPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [sort, setSort] = useState<SortFilter>('recent')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('grid')

  const { data, isPending, isError, total } = useAllCollections({
    type: typeFilter,
    status: statusFilter,
    sort,
    search,
  })

  const trimmedSearch = search.trim()
  const filtersActive =
    typeFilter !== 'ALL' || statusFilter !== 'ALL' || trimmedSearch !== '' || sort !== 'recent'

  const typeOptions: { value: TypeFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'ERC404', label: '404' },
    { value: 'ERC1155', label: '1155' },
    { value: 'ERC721', label: '721' },
  ]
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'active', label: 'Live' },
    { value: 'ended', label: 'Ended' },
    { value: 'ALL', label: 'All' },
  ]
  const sortOptions: { value: SortFilter; label: string }[] = [
    { value: 'recent', label: 'Recent' },
    { value: 'name', label: 'Name' },
    { value: 'tvl', label: 'TVL' },
  ]

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
        </Link>
      </nav>

      <header className={styles.head}>
        <div className={styles.headLine}>
          <h1 className={styles.title}>Collections</h1>
          <span className={styles.count} data-testid="collections-count">
            {isPending
              ? 'loading…'
              : isError
                ? 'error'
                : `${total} ${filtersActive ? 'shown' : 'registered'}`}
          </span>
        </div>
        <nav className="noesis-viewtoggle">
          <button
            type="button"
            className={`${styles.toggleBtn} ${view === 'grid' ? styles.toggleOn : ''}`}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${view === 'list' ? styles.toggleOn : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
        </nav>
      </header>

      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search collections, creators…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="search collections"
        />
        <div className={styles.chips} role="group" aria-label="type">
          {typeOptions.map((t) => (
            <button
              key={t.value}
              className={`${styles.chip} ${typeFilter === t.value ? styles.chipOn : ''}`}
              onClick={() => setTypeFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.chips} role="group" aria-label="status">
          {statusOptions.map((s) => (
            <button
              key={s.value}
              className={`${styles.chip} ${statusFilter === s.value ? styles.chipOn : ''}`}
              onClick={() => setStatusFilter(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className={styles.chips} role="group" aria-label="sort">
          {sortOptions.map((s) => (
            <button
              key={s.value}
              className={`${styles.chip} ${sort === s.value ? styles.chipOn : ''}`}
              onClick={() => setSort(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}
      {isError && <StateBlock variant="error">discovery unreachable — is the fork up?</StateBlock>}

      {!isPending && !isError && total === 0 && (
        <StateBlock variant="empty" boxed testId="collections-empty">
          {data !== undefined && data.length === 0 && !filtersActive
            ? 'this wall is empty — run the seed script to populate.'
            : 'nothing matches the current filters.'}
        </StateBlock>
      )}

      {!isPending && !isError && data !== undefined && data.length > 0 && view === 'grid' && (
        <div className={browseStyles.grid} data-testid="collections-list">
          {data.map((c) => (
            <CollectionCard key={c.instance} card={c} />
          ))}
        </div>
      )}

      {!isPending && !isError && data !== undefined && data.length > 0 && view === 'list' && (
        <div className={`noesis-reg ${styles.reg}`} data-testid="collections-list">
          <div className="colhead">
            <span>Collection</span>
            <span>Type</span>
            <span>Minted</span>
            <span>Status</span>
            <span>Aligned to</span>
            <span className={styles.regPriceHead}>Price</span>
          </div>
          {data.map((c) => (
            <RegistryRow key={c.instance} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One de-arted registry row — the same collection, reduced to a 30px thumbnail + mono columns. */
function RegistryRow({ card }: { card: ProjectCard }) {
  const metadata = useCollectionMetadata(card.metadataURI)
  const cap = card.maxSupply
  const minted = card.totalSupply
  const mintedLabel =
    cap > 0n
      ? `${minted.toString()} / ${cap.toString()}`
      : card.contractType === 'ERC1155'
        ? 'open'
        : minted.toString()
  const aligned =
    card.vaultName ||
    (card.vault && card.vault !== '0x0000000000000000000000000000000000000000'
      ? truncateAddress(card.vault)
      : '')

  return (
    <Link href={`/collection/${card.instance}`} className="row">
      <span className={styles.regName}>
        <span className="sw">
          {metadata?.image && <IpfsImage uri={metadata.image} alt="" className={styles.regThumb} />}
        </span>
        <span className={styles.regNameText}>
          <span className="nm">{metadata?.name || card.name}</span>
          <span className="by">by {truncateAddress(card.creator)}</span>
        </span>
      </span>
      <span>{TYPE_LABEL[card.contractType] ?? card.contractType}</span>
      <span>{mintedLabel}</span>
      <span>{card.isActive ? 'Live' : 'Ended'}</span>
      <span className="al">
        {aligned ? (
          <>
            <span className="s" />
            {aligned} · ~20%
          </>
        ) : (
          '—'
        )}
      </span>
      <span className={styles.regPrice}>{formatGwei(card.currentPrice)} gwei</span>
    </Link>
  )
}
