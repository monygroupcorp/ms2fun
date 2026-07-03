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

/** Bump to discard all previously-persisted cache (breaking read/schema change). */
export const PERSIST_BUSTER = 'v1'

/** How long a persisted cache entry is trusted on restore (staleTime still governs refetch). */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 // 1 hour

export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'ms2.read-cache',
  serialize,
  deserialize,
})
