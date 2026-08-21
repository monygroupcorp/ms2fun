/**
 * Test-only helper: a Map-backed `localStorage`.
 *
 * The jsdom environment exposes a Node-native localStorage that lacks `.clear()` and a standard
 * prototype chain, so a suite that persists anything needs a real one installed. `storage.test.ts`
 * carries its own copy for the storage unit tests themselves; this is the shared one for every other
 * suite that exercises a persisted store.
 *
 * Imported only from `*.test.ts(x)` — it is not referenced by any app entry point.
 */
import { vi } from 'vitest'

export function makeLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      store.set(key, value)
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
  }
}

/** Install a fresh, empty localStorage for the current test. */
export function installLocalStorageMock(): Storage {
  const mock = makeLocalStorageMock()
  vi.stubGlobal('localStorage', mock)
  return mock
}
