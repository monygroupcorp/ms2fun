/**
 * Gateway health — the one shared notion of "is this gateway worth asking right now".
 *
 * Public IPFS gateways rate-limit per client IP, so every request the app makes lands in the same
 * bucket as every other. That makes the ordering decision a budget decision: a gateway that has just
 * refused us must be left alone until its window passes, and a gateway that just served us is the
 * cheapest one to ask next. Both the JSON path (`fetchJson`) and the image path (`IpfsImage`) read
 * this module, so what one of them learns the other acts on.
 *
 * Not every failure is the gateway's fault. A `404` means the CID is not there — the gateway
 * answered correctly and must not be cooled, or one dead pointer would take the whole roster out for
 * every other item on the page. Only a refusal (`429`/`503`) or a transport fault demotes.
 *
 * Pure TS: no React, no wagmi, SSR-safe (every persisted read/write is a no-op without a window).
 */
import { gatewayHealthStore, type GatewayHealthRecord } from '../storage/keys'

/** How a failed attempt is attributed. */
export type GatewayFault =
  /** The gateway refused us for volume — cool it for the full window. */
  | 'throttled'
  /** The content is not there. The gateway is fine and is NOT penalised. */
  | 'missing'
  /** Transport error, timeout, or a malformed answer — soft demote, short cooldown. */
  | 'network'

/** A refusal costs a real window: long enough for the bucket to refill, capped so it can recover. */
const THROTTLE_BASE_MS = 60_000
const THROTTLE_CAP_MS = 15 * 60_000
/** A transport fault is cheap to retry — deprioritise briefly rather than sideline the gateway. */
const NETWORK_BASE_MS = 5_000
const NETWORK_CAP_MS = 60_000
/** A `Retry-After` further out than this is treated as the cap; the roster stays usable. */
const RETRY_AFTER_CAP_MS = 60 * 60_000

const EMPTY: GatewayHealthRecord = { lastGood: 0, failures: 0, cooldownUntil: 0, reason: null }

let cache: Record<string, GatewayHealthRecord> | null = null
let version = 0
const listeners = new Set<() => void>()

function read(): Record<string, GatewayHealthRecord> {
  cache ??= gatewayHealthStore.get()
  return cache
}

function write(next: Record<string, GatewayHealthRecord>): void {
  cache = next
  version += 1
  gatewayHealthStore.set(next)
  for (const fn of listeners) fn()
}

/** Subscribe to health changes (the `useSyncExternalStore` contract). */
export function subscribeGatewayHealth(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Monotonic counter — a stable snapshot for `useSyncExternalStore`. */
export function gatewayHealthVersion(): number {
  return version
}

/** The record for one gateway base; never throws, never undefined. */
export function gatewayHealth(base: string): GatewayHealthRecord {
  return read()[base] ?? EMPTY
}

/** Drop all health. Test seam, and the honest way to answer "let me try again now". */
export function resetGatewayHealth(): void {
  cache = {}
  version += 1
  gatewayHealthStore.remove()
  for (const fn of listeners) fn()
}

/**
 * Attribute an HTTP status to a fault class. `429`/`503` is the gateway refusing us; `404`/`410` is
 * the content being absent; anything else non-2xx is treated as the gateway misbehaving, which is a
 * soft demote rather than a refusal.
 */
export function classifyStatus(status: number): GatewayFault {
  if (status === 429 || status === 503) return 'throttled'
  if (status === 404 || status === 410) return 'missing'
  return 'network'
}

/**
 * `Retry-After` in ms, or null when absent/unparseable. Both wire forms are accepted: delta-seconds
 * and an HTTP-date. A value in the past clamps to zero rather than becoming a negative cooldown.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (value === null || value === undefined) return null
  const raw = value.trim()
  if (raw === '') return null
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, RETRY_AFTER_CAP_MS)
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return Math.min(Math.max(at - now, 0), RETRY_AFTER_CAP_MS)
}

/** Exponential backoff for the nth consecutive fault of a class, capped. */
function backoffMs(fault: 'throttled' | 'network', failures: number): number {
  const base = fault === 'throttled' ? THROTTLE_BASE_MS : NETWORK_BASE_MS
  const cap = fault === 'throttled' ? THROTTLE_CAP_MS : NETWORK_CAP_MS
  const step = Math.min(Math.max(failures - 1, 0), 10)
  return Math.min(base * 2 ** step, cap)
}

/** Record a 2xx: clears the failure count and cooldown, and stamps last-known-good. */
export function noteGatewaySuccess(base: string, now = Date.now()): void {
  const current = gatewayHealth(base)
  // A gallery loads many images from the same gateway; re-stamping a healthy record on each one
  // would write to storage per thumbnail for no new information.
  if (current.failures === 0 && current.cooldownUntil === 0 && now - current.lastGood < 30_000)
    return
  write({ ...read(), [base]: { lastGood: now, failures: 0, cooldownUntil: 0, reason: null } })
}

/**
 * Record a failed attempt. `missing` deliberately changes nothing — a dead CID must not cool a
 * healthy gateway for every other item. `retryAfterMs` (from the response header) wins over backoff.
 */
export function noteGatewayFault(
  base: string,
  fault: GatewayFault,
  retryAfterMs: number | null = null,
  now = Date.now(),
): void {
  if (fault === 'missing') return
  const current = gatewayHealth(base)
  const failures = current.failures + 1
  const wait = retryAfterMs ?? backoffMs(fault, failures)
  const cooldownUntil = Math.max(current.cooldownUntil, now + wait)
  write({
    ...read(),
    [base]: { lastGood: current.lastGood, failures, cooldownUntil, reason: fault },
  })
}

/** True while this gateway is inside a cooldown window. */
export function isCooling(base: string, now = Date.now()): boolean {
  return gatewayHealth(base).cooldownUntil > now
}

/**
 * The gateways worth asking, best-first: everything not cooling, most-recently-good first. Roster
 * order breaks ties, so a fresh session (no history at all) walks the roster as authored.
 */
export function readyGateways(bases: readonly string[], now = Date.now()): string[] {
  return bases
    .map((base, index) => ({ base, index, health: gatewayHealth(base) }))
    .filter((entry) => entry.health.cooldownUntil <= now)
    .sort((a, b) => b.health.lastGood - a.health.lastGood || a.index - b.index)
    .map((entry) => entry.base)
}

/**
 * When EVERY given gateway is cooling, the epoch ms at which the first one becomes askable again;
 * null while at least one is ready. This is what the UI turns into "roughly how long".
 */
export function cooldownEndsAt(bases: readonly string[], now = Date.now()): number | null {
  if (bases.length === 0) return null
  let earliest = Infinity
  for (const base of bases) {
    const until = gatewayHealth(base).cooldownUntil
    if (until <= now) return null
    earliest = Math.min(earliest, until)
  }
  return earliest
}

/** True when at least one of the given gateways is cooling because it refused us for volume. */
export function anyThrottled(bases: readonly string[], now = Date.now()): boolean {
  return bases.some((base) => {
    const health = gatewayHealth(base)
    return health.cooldownUntil > now && health.reason === 'throttled'
  })
}

/** The gateway base a resolved URL came from, or null when it belongs to none of them. */
export function gatewayOfUrl(url: string, bases: readonly string[]): string | null {
  for (const base of bases) {
    if (url.startsWith(base)) return base
  }
  return null
}
