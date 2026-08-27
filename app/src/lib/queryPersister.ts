/**
 * React-Query cache persistence (ADR-0010, Tier 0) — a static IPFS-hosted client gets reloaded a lot,
 * so we persist the read cache to localStorage: revisits/reloads paint instantly from cache and only
 * fetch deltas, instead of cold-starting every chain read.
 *
 * BigInt-safe: wagmi read results are full of bigints, which `JSON.stringify` throws on. We use
 * wagmi's `serialize`/`deserialize` (the same ones wagmi uses for its own storage) so the persisted
 * blob round-trips bigints correctly.
 *
 * `buster` invalidates the whole persisted cache when the shape changes (bump on a breaking read
 * change or an ABI/schema change). localStorage (sync, ~5MB) is the v1; move to an IndexedDB async
 * persister if the cached event data grows large.
 */
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { deserialize, serialize } from 'wagmi'

/**
 * Bump to discard all previously-persisted cache (breaking read/schema change).
 *
 * v2: the board's infinite-query key (`['message-feed', 'global']`) and home's plain query used
 * to share one cache key with incompatible shapes (noesis-422) — home's `FeedMessage[]` restored
 * under the board's key could crash the board's `InfiniteQueryObserver`. The key split alone only
 * covers new writes; a persisted v1 blob still carries an entry poisoned before the split. This
 * bump discards it on the next restore.
 */
export const PERSIST_BUSTER = 'v2'

/**
 * How long a persisted cache entry is trusted on restore (staleTime still governs refetch).
 *
 * Content-addressed metadata (`ipfs://`, `ar://`, `data:`) is immutable — the pointer is a hash of
 * the bytes — so an entry restored a week later is exactly as correct as one restored a second
 * later, and re-fetching it spends the visitor's own public-gateway budget to receive bytes we
 * already hold. Mutable reads (chain state, `http(s)://` metadata) are unaffected by the age: they
 * carry a finite `staleTime` and revalidate on mount regardless of how long the entry was kept.
 *
 * A week is the working span this is sized for — a visitor who returns to the same collections over
 * a few days pays for their bytes once — while staying short enough that the localStorage blob is
 * bounded by recent browsing rather than accumulating indefinitely.
 */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7 // 7 days

export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'noesis.read-cache',
  serialize,
  deserialize,
})
