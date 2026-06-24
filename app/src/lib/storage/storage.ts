/**
 * Typed, versioned, SSR-safe localStorage factory (W-A3).
 *
 * Real key = `ms2fun:v{version}:{key}`.
 * Bumping `version` makes old values invisible (migration-by-discard — no data migration needed).
 * Every localStorage call is wrapped in try/catch so quota/security errors are silent no-ops.
 * In SSR (typeof window === 'undefined') all reads return the default, all writes no-op.
 */

export interface StorageEntry<T> {
  /** Returns the stored value; falls back to default on miss, corruption, or parse rejection. */
  get(): T
  /** Persists the value. No-op if storage is unavailable. */
  set(value: T): void
  /** Removes the key from storage. */
  remove(): void
  /**
   * Fires `fn` whenever the value changes in *another* tab (cross-tab sync via `storage` event).
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

  function get(): T {
    if (isServer()) return opts.default
    try {
      const raw = localStorage.getItem(realKey)
      if (raw === null) return opts.default
      const parsed: unknown = JSON.parse(raw)
      const result = opts.parse(parsed)
      return result !== undefined ? result : opts.default
    } catch {
      return opts.default
    }
  }

  function set(value: T): void {
    if (isServer()) return
    try {
      localStorage.setItem(realKey, JSON.stringify(value))
    } catch {
      // quota exceeded or security error — silently ignore
    }
  }

  function remove(): void {
    if (isServer()) return
    try {
      localStorage.removeItem(realKey)
    } catch {
      // security error — silently ignore
    }
  }

  function subscribe(fn: (value: T) => void): () => void {
    if (isServer()) return () => undefined

    function onStorage(event: StorageEvent): void {
      if (event.key !== realKey) return
      fn(get())
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }

  return { get, set, remove, subscribe }
}
