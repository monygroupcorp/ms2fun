/**
 * queryPersister — buster-bump regression (noesis-422 amendment).
 *
 * The key-collision fix (see `BoardPage.test.tsx`) only covers new writes. The read cache
 * persists to localStorage (`PersistQueryClientProvider` in `App.tsx`), so a visitor who loaded
 * the app before the fix can still carry a poisoned array-shaped entry under the board's
 * infinite-query key, restored on every reload regardless of the key split. Bumping
 * `PERSIST_BUSTER` discards any cache persisted under an older buster on restore — this proves
 * that discard actually happens.
 */
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PERSIST_BUSTER as PersistBusterType,
  queryPersister as QueryPersisterType,
} from './queryPersister'
import type { Persister } from '@tanstack/react-query-persist-client'

const BOARD_FEED_KEY = ['message-feed', 'global']

// `queryPersister.ts` binds `createSyncStoragePersister` to `window.localStorage` at import
// time; this jsdom/vitest environment does not provision a `Storage` on `window` (no other
// suite in the app exercises real localStorage reads/writes). A minimal in-memory shim,
// installed before the module loads, lets the persister's actual persist/restore code run
// unmodified rather than mocking the module under test.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

let PERSIST_BUSTER: typeof PersistBusterType
let queryPersister: typeof QueryPersisterType

beforeAll(async () => {
  Object.defineProperty(window, 'localStorage', { value: makeMemoryStorage(), configurable: true })
  ;({ PERSIST_BUSTER, queryPersister } = await import('./queryPersister'))
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  window.localStorage.clear()
})

// The app's `@tanstack/react-query` and this package's transitive `@tanstack/query-persist-
// client-core` resolve two distinct (structurally identical) `@tanstack/query-core` installs, so
// `QueryClient` is nominally two different types at the boundary below — a pnpm dependency-graph
// artifact, not a runtime concern (both are real `QueryClient` instances). Narrow at the call site
// rather than widen the public `queryClient`/`saveAndFlush` signatures.
type PersistQueryClient = Parameters<typeof persistQueryClientSave>[0]['queryClient']

/**
 * `createSyncStoragePersister`'s `persistClient` is throttled (1s default) so bursts of cache
 * changes don't spam storage. Awaiting the call alone races the write; flushing the fake timer
 * makes the save land before the test reads it back.
 */
async function saveAndFlush(queryClient: QueryClient, persister: Persister, buster: string) {
  await persistQueryClientSave({
    queryClient: queryClient as unknown as PersistQueryClient,
    persister,
    buster,
  })
  await vi.advanceTimersByTimeAsync(1100)
}

describe('queryPersister buster', () => {
  it('discards a cache persisted under an older buster, protecting the board on restore', async () => {
    // Simulate a pre-fix visitor's persisted blob: the board's infinite-query key carrying a
    // plain array (home's old, colliding shape) under buster 'v1'.
    const savingClient = new QueryClient()
    savingClient.setQueryData(BOARD_FEED_KEY, [{ messageId: 1n }])
    await saveAndFlush(savingClient, queryPersister, 'v1')

    const restoredClient = new QueryClient()
    await persistQueryClientRestore({
      queryClient: restoredClient as unknown as PersistQueryClient,
      persister: queryPersister,
      buster: PERSIST_BUSTER,
    })

    // A stale-buster blob must be discarded, not hydrated — an unbumped buster would restore
    // the poisoned entry unchanged and the board would see it on the very next mount.
    expect(restoredClient.getQueryData(BOARD_FEED_KEY)).toBeUndefined()
  })

  it('restores a cache persisted under the CURRENT buster (the working leg)', async () => {
    const savingClient = new QueryClient()
    savingClient.setQueryData(['some-other-key'], ['ok'])
    await saveAndFlush(savingClient, queryPersister, PERSIST_BUSTER)

    const restoredClient = new QueryClient()
    await persistQueryClientRestore({
      queryClient: restoredClient as unknown as PersistQueryClient,
      persister: queryPersister,
      buster: PERSIST_BUSTER,
    })

    expect(restoredClient.getQueryData(['some-other-key'])).toEqual(['ok'])
  })
})
