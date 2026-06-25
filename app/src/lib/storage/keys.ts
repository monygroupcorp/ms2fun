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
