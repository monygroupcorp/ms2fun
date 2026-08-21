/**
 * Typed storage registry (W-A3) — the entire persisted surface in one auditable file.
 *
 * Adding a new entry here is the only place a developer needs to touch to introduce
 * a new persisted value. Bumping `version` makes all existing values for that key
 * invisible (migration-by-discard).
 */

import { storage } from './storage'

/** Favorite collection addresses (lowercased). */
export const favoritesStore = storage<string[]>('favorites', {
  default: [],
  version: 1,
  parse: (r) =>
    Array.isArray(r) && r.every((x) => typeof x === 'string')
      ? r.map((s) => s.toLowerCase())
      : undefined,
})

/**
 * Custom IPFS gateway URL override, or null to use the built-in default.
 * Consumed by W-A4.
 */
export const customGatewayStore = storage<string | null>('ipfsGateway', {
  default: null,
  version: 1,
  parse: (r) => (r === null || typeof r === 'string' ? r : undefined),
})

/** UI colour theme preference. */
export const themeStore = storage<'light' | 'dark'>('theme', {
  default: 'light',
  version: 1,
  parse: (r) => (r === 'light' || r === 'dark' ? r : undefined),
})

/**
 * Persisted per-gateway health, keyed by gateway base (the string the roster carries).
 *
 * Persisted rather than in-memory because a rate-limit window outlives a reload: a browser that has
 * just been told "429, come back in ten minutes" and then reloads would otherwise start over at
 * request one and walk straight back into the wall, which is exactly what stops the bucket
 * refilling. Values are timestamps in epoch ms.
 */
export interface GatewayHealthRecord {
  /** Epoch ms of the last 2xx from this gateway; 0 = never seen good. */
  lastGood: number
  /** Consecutive faults that were the gateway's own (a missing CID does not count). */
  failures: number
  /** Epoch ms before which this gateway must not be contacted; 0 = ready. */
  cooldownUntil: number
  /** Why it is cooling: a throttle is reportable to the user, a network fault is not. */
  reason: 'throttled' | 'network' | null
}

function parseHealthRecord(raw: unknown): GatewayHealthRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const { lastGood, failures, cooldownUntil, reason } = r
  if (typeof lastGood !== 'number' || typeof failures !== 'number') return undefined
  if (typeof cooldownUntil !== 'number') return undefined
  if (reason !== null && reason !== 'throttled' && reason !== 'network') return undefined
  return { lastGood, failures, cooldownUntil, reason }
}

export const gatewayHealthStore = storage<Record<string, GatewayHealthRecord>>('gatewayHealth', {
  default: {},
  version: 1,
  parse: (r) => {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return undefined
    const out: Record<string, GatewayHealthRecord> = {}
    for (const [key, value] of Object.entries(r as Record<string, unknown>)) {
      const record = parseHealthRecord(value)
      // One corrupt entry discards only itself — health is advisory, never worth failing a fetch.
      if (record) out[key] = record
    }
    return out
  },
})
