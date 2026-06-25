/**
 * storage.ts unit tests (W-A3)
 *
 * Vitest 4 (jsdom env) exposes a Node-native localStorage that lacks `.clear()` and a
 * standard prototype chain. We install a Map-backed stub via `vi.stubGlobal` so every
 * test starts from a clean, fully-functional localStorage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storage } from './storage'

// ── localStorage stub ─────────────────────────────────────────────────────────

function makeLocalStorageMock(): Storage {
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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStringEntry(key = 'test-str', version = 1) {
  return storage<string>(key, {
    default: 'default',
    version,
    parse: (r) => (typeof r === 'string' ? r : undefined),
  })
}

function makeNumEntry(key = 'test-num', version = 1) {
  return storage<number>(key, {
    default: 0,
    version,
    parse: (r) => (typeof r === 'number' ? r : undefined),
  })
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns default when key is absent', () => {
    const entry = makeStringEntry()
    expect(entry.get()).toBe('default')
  })

  it('round-trip: set then get returns the stored value', () => {
    const entry = makeStringEntry()
    entry.set('hello')
    expect(entry.get()).toBe('hello')
  })

  it('round-trip: numeric value', () => {
    const entry = makeNumEntry()
    entry.set(42)
    expect(entry.get()).toBe(42)
  })

  it('corruption: non-JSON in localStorage → returns default', () => {
    const entry = makeStringEntry('corrupt-key')
    localStorage.setItem('ms2fun:v1:corrupt-key', '%%%not json%%%')
    expect(entry.get()).toBe('default')
  })

  it('parse-rejection: JSON that fails parse → returns default', () => {
    // Stored value is a number, but parser expects string → parse returns undefined
    const entry = makeStringEntry('reject-key')
    localStorage.setItem('ms2fun:v1:reject-key', '123')
    expect(entry.get()).toBe('default')
  })

  it('remove: clears the key; subsequent get returns default', () => {
    const entry = makeStringEntry()
    entry.set('foo')
    entry.remove()
    expect(entry.get()).toBe('default')
  })

  it('version bump: old value is invisible', () => {
    const v1 = makeStringEntry('shared-key', 1)
    v1.set('old-value')
    // v2 uses a different real key; old value should not be seen
    const v2 = makeStringEntry('shared-key', 2)
    expect(v2.get()).toBe('default')
  })

  it('version bump: writes to the new key, not the old one', () => {
    const v1 = makeStringEntry('shared-key', 1)
    const v2 = makeStringEntry('shared-key', 2)
    v2.set('new-value')
    // v1 key is untouched
    expect(v1.get()).toBe('default')
    expect(v2.get()).toBe('new-value')
  })

  it('uses namespaced key in localStorage', () => {
    const entry = makeStringEntry('mykey', 1)
    entry.set('val')
    expect(localStorage.getItem('ms2fun:v1:mykey')).toBe('"val"')
  })

  describe('SSR-safety: localStorage unavailable', () => {
    beforeEach(() => {
      // Replace global with a throwing mock to simulate quota/security errors.
      // The length getter needs an explicit cast because TS infers `never` for throw-only getters.
      const throwing = {
        get length(): number {
          throw new Error('storage unavailable')
        },
        key(): string | null {
          throw new Error('storage unavailable')
        },
        getItem(): string | null {
          throw new Error('storage unavailable')
        },
        setItem(): void {
          throw new Error('storage unavailable')
        },
        removeItem(): void {
          throw new Error('storage unavailable')
        },
        clear(): void {
          throw new Error('storage unavailable')
        },
      }
      vi.stubGlobal('localStorage', throwing)
    })

    it('get returns default when localStorage throws', () => {
      const entry = makeStringEntry('ssr-key')
      expect(entry.get()).toBe('default')
    })

    it('set is a no-op when localStorage throws', () => {
      const entry = makeStringEntry('ssr-key')
      expect(() => entry.set('value')).not.toThrow()
    })

    it('remove is a no-op when localStorage throws', () => {
      const entry = makeStringEntry('ssr-key')
      expect(() => entry.remove()).not.toThrow()
    })
  })

  describe('cross-tab subscribe', () => {
    it('fires callback when a storage event matches the key', () => {
      const entry = makeStringEntry('sub-key', 1)
      const fn = vi.fn()
      const unsub = entry.subscribe(fn)

      // Set a value first so get() can find it when the callback calls entry.get()
      localStorage.setItem('ms2fun:v1:sub-key', '"tab2-value"')

      // Simulate the storage event fired by another tab.
      // We omit storageArea: jsdom's StorageEvent requires a native Storage instance
      // and our Map-backed stub does not qualify. The subscribe handler only checks
      // event.key, so omitting storageArea does not affect the behaviour under test.
      const event = new StorageEvent('storage', {
        key: 'ms2fun:v1:sub-key',
        newValue: '"tab2-value"',
      })
      window.dispatchEvent(event)

      expect(fn).toHaveBeenCalledOnce()
      expect(fn).toHaveBeenCalledWith('tab2-value')

      unsub()
    })

    it('does NOT fire callback for a different key', () => {
      const entry = makeStringEntry('sub-key', 1)
      const fn = vi.fn()
      const unsub = entry.subscribe(fn)

      const event = new StorageEvent('storage', {
        key: 'ms2fun:v1:other-key',
        newValue: '"irrelevant"',
      })
      window.dispatchEvent(event)

      expect(fn).not.toHaveBeenCalled()
      unsub()
    })

    it('unsubscribe stops future callbacks', () => {
      const entry = makeStringEntry('unsub-key', 1)
      const fn = vi.fn()
      const unsub = entry.subscribe(fn)

      unsub()

      const event = new StorageEvent('storage', {
        key: 'ms2fun:v1:unsub-key',
        newValue: '"value"',
      })
      window.dispatchEvent(event)

      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('useSyncExternalStore contract', () => {
    function makeArrayEntry(key: string) {
      return storage<string[]>(key, {
        default: [],
        version: 1,
        parse: (r) =>
          Array.isArray(r) && r.every((x) => typeof x === 'string') ? (r as string[]) : undefined,
      })
    }

    it('get() returns a referentially STABLE value across calls when unchanged', () => {
      // The useSyncExternalStore contract: re-parsing a new array each call would loop React.
      const entry = makeArrayEntry('stable-key')
      entry.set(['a', 'b'])
      expect(entry.get()).toBe(entry.get())
    })

    it('get() returns a NEW reference after set (snapshot actually changes)', () => {
      const entry = makeArrayEntry('change-key')
      const before = entry.get()
      entry.set(['z'])
      const after = entry.get()
      expect(after).not.toBe(before)
      expect(after).toEqual(['z'])
    })

    it('same-tab set() notifies subscribers with the new value', () => {
      const entry = makeStringEntry('same-tab-set', 1)
      const fn = vi.fn()
      const unsub = entry.subscribe(fn)
      entry.set('written')
      expect(fn).toHaveBeenCalledWith('written')
      unsub()
    })

    it('same-tab remove() notifies subscribers with the default', () => {
      const entry = makeStringEntry('same-tab-rm', 1)
      entry.set('x')
      const fn = vi.fn()
      const unsub = entry.subscribe(fn)
      entry.remove()
      expect(fn).toHaveBeenCalledWith('default')
      unsub()
    })
  })
})
