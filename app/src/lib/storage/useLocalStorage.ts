import { useSyncExternalStore } from 'react'
import type { StorageEntry } from './storage'

/**
 * React hook for a StorageEntry.
 *
 * Uses `useSyncExternalStore` so the value is reactive across tabs and SSR-safe.
 * The server snapshot is the entry's `get()` which returns the default in SSR.
 *
 * Returns `[value, setValue, remove]`.
 */
export function useLocalStorage<T>(
  entry: StorageEntry<T>,
): readonly [T, (v: T) => void, () => void] {
  const value = useSyncExternalStore(
    entry.subscribe,
    entry.get,
    entry.get, // server snapshot — get() is SSR-safe and returns default
  )

  function setValue(v: T): void {
    entry.set(v)
  }

  function remove(): void {
    entry.remove()
  }

  return [value, setValue, remove] as const
}
