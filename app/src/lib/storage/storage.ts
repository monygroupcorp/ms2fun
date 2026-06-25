/**
 * Typed, versioned, SSR-safe localStorage factory (W-A3).
 *
 * Real key = `ms2fun:v{version}:{key}`.
 * Bumping `version` makes old values invisible (migration-by-discard — no data migration needed).
 * Every localStorage call is wrapped in try/catch so quota/security errors are silent no-ops.
 * In SSR (typeof window === 'undefined') all reads return the default, all writes no-op.
 *
 * Two correctness requirements for `useSyncExternalStore` consumers (see useLocalStorage):
 *  1. `get()` must be REFERENTIALLY STABLE when the underlying value is unchanged — otherwise React
 *     treats every render as a store change and loops. So the parsed value is cached by raw string.
 *  2. Same-tab `set()`/`remove()` must notify subscribers — the browser `storage` event only fires
 *     in *other* tabs, so an in-memory listener set drives same-tab reactivity.
 */

export interface StorageEntry<T> {
  /** Returns the stored value; falls back to default on miss, corruption, or parse rejection. */
  get(): T
  /** Persists the value and notifies subscribers (same tab + cross tab). No-op if unavailable. */
  set(value: T): void
  /** Removes the key and notifies subscribers with the default. */
  remove(): void
  /**
   * Fires `fn` whenever the value changes — same tab (set/remove) or another tab (`storage` event).
   * Returns an unsubscribe function.
   */
  subscribe(fn: (value: T) => void): () => void
}

export interface StorageOptions<T> {
  /** Return `undefined` to reject the raw value → caller will use `default`. */
  parse: (raw: unknown) => T | undefined
  default: T
  /** Defaults to 1. The real key becomes `ms2fun:v{version}:{key}`. */
  version?: number
}

function isServer(): boolean {
  return typeof window === 'undefined'
}

export function storage<T>(key: string, opts: StorageOptions<T>): StorageEntry<T> {
  const version = opts.version ?? 1
  const realKey = `ms2fun:v${version}:${key}`
  const listeners = new Set<(value: T) => void>()

  // Snapshot cache: the parsed value is recomputed only when the raw string changes, so `get()`
  // returns a stable reference across calls/renders (the useSyncExternalStore contract).
  let cachedRaw: string | null | undefined // undefined = not yet read
  let cachedValue: T = opts.default

  function compute(raw: string | null): T {
    if (raw === null) return opts.default
    try {
      const parsed: unknown = JSON.parse(raw)
      const result = opts.parse(parsed)
      return result !== undefined ? result : opts.default
    } catch {
      return opts.default
    }
  }

  function get(): T {
    if (isServer()) return opts.default
    let raw: string | null
    try {
      raw = localStorage.getItem(realKey)
    } catch {
      return opts.default
    }
    if (cachedRaw !== undefined && raw === cachedRaw) return cachedValue
    cachedRaw = raw
    cachedValue = compute(raw)
    return cachedValue
  }

  function emit(value: T): void {
    for (const fn of listeners) fn(value)
  }

  function set(value: T): void {
    if (isServer()) return
    try {
      const raw = JSON.stringify(value)
      localStorage.setItem(realKey, raw)
      cachedRaw = raw
      cachedValue = value
    } catch {
      return // quota/security error — don't notify with an unpersisted value
    }
    emit(value)
  }

  function remove(): void {
    if (isServer()) return
    try {
      localStorage.removeItem(realKey)
    } catch {
      return
    }
    cachedRaw = null
    cachedValue = opts.default
    emit(opts.default)
  }

  let onStorage: ((event: StorageEvent) => void) | undefined

  function subscribe(fn: (value: T) => void): () => void {
    if (isServer()) return () => undefined
    listeners.add(fn)
    if (!onStorage) {
      onStorage = (event: StorageEvent): void => {
        if (event.key !== realKey) return
        cachedRaw = undefined // force recompute from the other tab's write
        emit(get())
      }
      window.addEventListener('storage', onStorage)
    }
    return () => {
      listeners.delete(fn)
      if (listeners.size === 0 && onStorage) {
        window.removeEventListener('storage', onStorage)
        onStorage = undefined
      }
    }
  }

  return { get, set, remove, subscribe }
}
