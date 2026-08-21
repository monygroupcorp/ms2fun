/**
 * Gateway health — one source of truth about WHICH gateway to try next.
 *
 * Public IPFS gateways meter by client IP, so every request this app makes to a public gateway
 * lands in the viewer's own bucket. Two consequences shape this module:
 *
 *  1. **Requests must be spent, not sprayed.** Asking every gateway for the same bytes multiplies
 *     the spend by the roster length and drains the one bucket that matters faster. Callers ask
 *     this module for an ORDER and walk it, spending one request in the common case.
 *  2. **A refusal must be remembered.** A gateway that just answered `429`/`503` is telling us to
 *     stop; continuing to ask is what keeps the window from clearing. A refusal parks the gateway
 *     for a cooldown that survives a reload, because the window outlives an F5.
 *
 * What is deliberately NOT penalised: a `404`/`410`. That is the CONTENT being absent, and the
 * gateway answering correctly. Cooling a healthy gateway because one CID is unpinned would spend
 * the roster on a single dead pointer.
 *
 * Pure TS — no React, no wagmi, SSR-safe (every persisted read degrades to defaults). The art cache
 * is authoritative about content; this module is authoritative about order.
 */
import { gatewayHealthStore, type GatewayHealthRecord } from '../storage/keys'
import type { IpfsGateway } from './uri'

/** How one attempt at a gateway ended. */
export type AttemptOutcome =
  /** 2xx with the bytes we asked for. */
  | 'ok'
  /** The gateway is refusing us by policy (rate limit / capacity). Park it. */
  | 'throttled'
  /** The CID is not retrievable here, but the gateway answered correctly. Do not penalise it. */
  | 'missing'
  /** The gateway misbehaved: a 5xx, a challenge document, a network error, a timeout. */
  | 'fault'

/**
 * Persisted per-gateway record. The shape lives in the storage registry (every persisted value is
 * declared in one auditable file); the semantics live here.
 */
export type GatewayHealth = GatewayHealthRecord

export type GatewayHealthMap = Record<string, GatewayHealth>

/**
 * Backoff floor and ceiling for a gateway that refused us. A minute is long enough that a burst
 * limit has actually rolled over; fifteen minutes is the ceiling because a viewer who leaves the
 * tab open should get a retry within a coffee break rather than never.
 */
export const THROTTLE_BASE_MS = 60_000
export const THROTTLE_MAX_MS = 15 * 60_000

/**
 * A misbehaving gateway is deprioritised, not parked: a 5xx or a dropped connection is usually a
 * blip on one edge node, and unlike a rate limit, retrying it does not make it worse.
 */
export const FAULT_BASE_MS = 15_000
export const FAULT_MAX_MS = 5 * 60_000

/** Stable identity for a roster entry: two hostnames of one operator are still two endpoints. */
export function gatewayKey(gateway: IpfsGateway): string {
  return `${gateway.operator}|${gateway.base}`
}

const EMPTY: GatewayHealth = { lastGoodAt: 0, failures: 0, cooldownUntil: 0 }

/** In-memory mirror of the persisted map; `undefined` until the first read. */
let cache: GatewayHealthMap | undefined
/** Bumped on every mutation so snapshot consumers can tell "nothing changed" cheaply. */
let version = 0
const listeners = new Set<() => void>()

function read(): GatewayHealthMap {
  if (cache === undefined) cache = { ...gatewayHealthStore.get() }
  return cache
}

function commit(next: GatewayHealthMap): void {
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

/** Current record for a gateway key. Never null — an unknown gateway is simply untried. */
export function healthOf(key: string): GatewayHealth {
  return read()[key] ?? EMPTY
}

/** True when `key` must not be asked right now. */
export function isCooling(key: string, now: number = Date.now()): boolean {
  return healthOf(key).cooldownUntil > now
}

function update(key: string, patch: GatewayHealth): void {
  commit({ ...read(), [key]: patch })
}

/** Record a 2xx: the gateway is good, any backoff it had accumulated is discharged. */
export function noteSuccess(key: string, now: number = Date.now()): void {
  const current = healthOf(key)
  if (current.lastGoodAt === now && current.failures === 0 && current.cooldownUntil === 0) return
  update(key, { lastGoodAt: now, failures: 0, cooldownUntil: 0 })
}

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Returns the delay in ms, or null when
 * the header is absent or unparseable — the caller then falls back to its own backoff.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

function backoff(base: number, max: number, failures: number): number {
  return Math.min(max, base * 2 ** Math.max(0, failures))
}

/**
 * Record a refusal. `retryAfterMs` (from the response's `Retry-After`) is honoured when the gateway
 * supplied one; otherwise the delay is exponential in the consecutive-failure count, capped.
 */
export function noteThrottled(
  key: string,
  retryAfterMs: number | null = null,
  now: number = Date.now(),
): void {
  const current = healthOf(key)
  const failures = current.failures + 1
  const delay =
    retryAfterMs !== null && retryAfterMs > 0
      ? Math.min(retryAfterMs, THROTTLE_MAX_MS)
      : backoff(THROTTLE_BASE_MS, THROTTLE_MAX_MS, current.failures)
  update(key, { lastGoodAt: current.lastGoodAt, failures, cooldownUntil: now + delay })
}

/** Record a 5xx / challenge document / network error: deprioritise, with a short cooldown. */
export function noteFault(key: string, now: number = Date.now()): void {
  const current = healthOf(key)
  const failures = current.failures + 1
  update(key, {
    lastGoodAt: current.lastGoodAt,
    failures,
    cooldownUntil: now + backoff(FAULT_BASE_MS, FAULT_MAX_MS, current.failures),
  })
}

/** Route an outcome to the right bookkeeping. `missing` deliberately touches nothing. */
export function noteOutcome(
  key: string,
  outcome: AttemptOutcome,
  retryAfterMs: number | null = null,
  now: number = Date.now(),
): void {
  if (outcome === 'ok') noteSuccess(key, now)
  else if (outcome === 'throttled') noteThrottled(key, retryAfterMs, now)
  else if (outcome === 'fault') noteFault(key, now)
  // 'missing' — the content is absent and the gateway is fine. Not its fault, not its cooldown.
}

/**
 * Classify an HTTP status.
 *
 * `429`/`503` are the two shapes of "you are asking too often" in the wild: gateways that meter
 * return `429`, gateways in front of a CDN shed load as `503`. Both mean back off.
 */
export function classifyStatus(status: number): AttemptOutcome {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 429 || status === 503) return 'throttled'
  if (status === 404 || status === 410) return 'missing'
  return 'fault'
}

/**
 * The order to try `gateways` in, best-first:
 *
 *  1. a custom gateway the viewer supplied — always, even while cooling. It is theirs, it is not
 *     metered against a shared public bucket, and skipping it would silently ignore the setting.
 *  2. every remaining gateway that is NOT cooling, most-recently-good first.
 *
 * Cooling public gateways are DROPPED, not appended. Asking one anyway is the behaviour that keeps
 * a rate-limit window from clearing.
 */
export function orderGateways(
  gateways: readonly IpfsGateway[],
  now: number = Date.now(),
): IpfsGateway[] {
  const custom = gateways.filter((g) => g.operator === 'custom')
  const rest = gateways
    .filter((g) => g.operator !== 'custom' && !isCooling(gatewayKey(g), now))
    .map((g, index) => ({ g, index, at: healthOf(gatewayKey(g)).lastGoodAt }))
    // Most-recently-good first; never-tried entries keep their roster order behind them.
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((entry) => entry.g)
  return [...custom, ...rest]
}

/** Epoch ms at which the first of `gateways` becomes askable again, or 0 when one already is. */
export function nextAvailableAt(
  gateways: readonly IpfsGateway[],
  now: number = Date.now(),
): number {
  let soonest = Number.POSITIVE_INFINITY
  for (const gateway of gateways) {
    const until = healthOf(gatewayKey(gateway)).cooldownUntil
    if (until <= now) return 0
    if (until < soonest) soonest = until
  }
  return Number.isFinite(soonest) ? soonest : 0
}

/** Whether the viewer is currently being refused by everything, and until when. */
export interface ThrottleSnapshot {
  /** True when no gateway can be asked right now. */
  cooling: boolean
  /** Epoch ms the first gateway becomes askable again (0 when `cooling` is false). */
  retryAt: number
}

const NOT_COOLING: ThrottleSnapshot = { cooling: false, retryAt: 0 }
let snapshot: ThrottleSnapshot = NOT_COOLING
let snapshotVersion = -1
let snapshotAt = 0

/**
 * Referentially stable snapshot for `useSyncExternalStore`: the same object is returned until the
 * health map changes or a cooldown actually elapses. `now` is a parameter so a component can force
 * a re-read on its own timer when a window expires with no event to announce it.
 */
export function throttleSnapshot(
  gateways: readonly IpfsGateway[],
  now: number = Date.now(),
): ThrottleSnapshot {
  if (snapshotVersion === version && now < snapshotAt) return snapshot
  const retryAt = gateways.length === 0 ? 0 : nextAvailableAt(gateways, now)
  const next: ThrottleSnapshot = retryAt > now ? { cooling: true, retryAt } : NOT_COOLING
  snapshotVersion = version
  // Re-evaluation is only required when the current cooldown lapses; until then the answer holds.
  snapshotAt = retryAt > now ? retryAt : Number.POSITIVE_INFINITY
  if (next.cooling !== snapshot.cooling || next.retryAt !== snapshot.retryAt) snapshot = next
  return snapshot
}

/** Discard all health (tests, and the "remove my gateway" path where the map is meaningless). */
export function resetGatewayHealth(): void {
  cache = {}
  version += 1
  snapshotVersion = -1
  snapshotAt = 0
  snapshot = NOT_COOLING
  gatewayHealthStore.remove()
  for (const fn of listeners) fn()
}
