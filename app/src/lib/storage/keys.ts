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

/** One gateway's health record. See `lib/metadata/gatewayHealth`, which owns the semantics. */
export interface GatewayHealthRecord {
  /** Epoch ms of the last 2xx from this gateway, or 0 if it has never served us. */
  lastGoodAt: number
  /** Consecutive non-success outcomes; drives the backoff exponent. */
  failures: number
  /** Epoch ms before which this gateway must not be asked again. */
  cooldownUntil: number
}

/**
 * Per-gateway health, keyed by gateway identity.
 *
 * Persisted because a rate-limit window outlives a reload: a viewer who reloads into an empty map
 * immediately re-asks the gateway that is refusing them, which is what keeps the window from
 * clearing. Records that are not the expected shape are dropped rather than trusted, and a stale
 * cooldown simply reads as expired.
 */
export const gatewayHealthStore = storage<Record<string, GatewayHealthRecord>>('gatewayHealth', {
  default: {},
  version: 1,
  parse: (r) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return undefined
    const out: Record<string, GatewayHealthRecord> = {}
    for (const [key, value] of Object.entries(r as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const { lastGoodAt, failures, cooldownUntil } = value as Record<string, unknown>
      if (
        typeof lastGoodAt !== 'number' ||
        typeof failures !== 'number' ||
        typeof cooldownUntil !== 'number'
      ) {
        continue
      }
      out[key] = { lastGoodAt, failures, cooldownUntil }
    }
    return out
  },
})

/** UI colour theme preference. */
export const themeStore = storage<'light' | 'dark'>('theme', {
  default: 'light',
  version: 1,
  parse: (r) => (r === 'light' || r === 'dark' ? r : undefined),
})
