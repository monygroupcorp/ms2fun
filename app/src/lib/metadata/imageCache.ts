/**
 * Content-addressed art cache — one request per CID, retained under our own policy.
 *
 * Art referenced by an `ipfs://`/`ar://` pointer is immutable: the pointer is a hash of the bytes.
 * Two things follow, and this module implements both.
 *
 *  1. **One request per CID, ever.** A grid where fourteen cards share one collection's art base
 *     should issue one request, not fourteen. A raw `<img>` per component cannot express that, so
 *     callers resolve through `loadArt()`: concurrent callers for the same content share a single
 *     in-flight promise, and once resolved the object URL is handed out from memory for free.
 *  2. **Retention we control.** The HTTP cache is evictable at the browser's discretion and keyed on
 *     whichever gateway answered, so the same bytes get re-fetched across visits and across gateway
 *     rotations. Bytes are stored in the Cache API keyed by CONTENT (`contentKey`), so a hit is a
 *     hit regardless of which gateway served it, and survives a reload.
 *
 * Everything here is client-side and dies with the browser profile — no server, no hosted cache.
 * Where the Cache API is unavailable (private modes, SSR, test environments) every persistent step
 * degrades to a no-op and the in-memory dedup layer still applies.
 *
 * Gateway ORDER is not this module's business: candidate URLs come from `resolveCandidates`, which
 * is health-ordered, and are tried in the order given. What this module DOES owe the health module
 * is the outcome of each attempt, so a gateway that refuses an image is parked for metadata too.
 */
import { classifyStatus, noteOutcome, parseRetryAfter } from './gatewayHealth'
import { contentKey, isImmutableUri, resolveCandidates, retryAtFor } from './uri'

/** Cache API bucket. Bump the suffix to discard every stored object (breaking format change). */
export const ART_CACHE_NAME = 'noesis-art-v1'

/**
 * Size cap for stored art, enforced by least-recently-used eviction.
 *
 * Sizing: collection art on public gateways runs a few hundred KB per image, so 48 MiB holds on the
 * order of a couple hundred distinct pieces — comfortably more than a week of browsing the same
 * collections, which is the case this exists to serve. It is also small enough to be a polite
 * tenant of an origin's storage quota (typically a percentage of free disk, shared with everything
 * else the origin stores), so a gallery app cannot grow this without bound.
 */
export const ART_CACHE_MAX_BYTES = 48 * 1024 * 1024

/** Synthetic origin for cache keys — never dereferenced, it only has to be a well-formed URL. */
const CACHE_KEY_ORIGIN = 'https://art-cache.noesis.invalid/'
const INDEX_KEY = `${CACHE_KEY_ORIGIN}__index__`

/** Per-request timeout: a hung gateway must not pin the entry's in-flight slot forever. */
const ART_TIMEOUT_MS = 15_000

type IndexEntry = { size: number; at: number }
type ArtIndex = Record<string, IndexEntry>

/** Resolved content keys → an object URL valid for this session. */
const resolved = new Map<string, string>()
/** Content keys currently being fetched → the single shared promise every caller awaits. */
const inFlight = new Map<string, Promise<string>>()

/** Serializes index read-modify-write so concurrent stores can't clobber each other's bookkeeping. */
let indexQueue: Promise<unknown> = Promise.resolve()

function cacheKeyFor(key: string): string {
  return `${CACHE_KEY_ORIGIN}${encodeURIComponent(key)}`
}

async function openStore(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(ART_CACHE_NAME)
  } catch {
    return null // storage disabled (private mode, blocked cookies) — memory layer still works
  }
}

async function readIndex(store: Cache): Promise<ArtIndex> {
  try {
    const res = await store.match(INDEX_KEY)
    if (!res) return {}
    const parsed: unknown = await res.json()
    return parsed && typeof parsed === 'object' ? (parsed as ArtIndex) : {}
  } catch {
    return {}
  }
}

async function writeIndex(store: Cache, index: ArtIndex): Promise<void> {
  try {
    await store.put(
      INDEX_KEY,
      new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } }),
    )
  } catch {
    /* quota or storage failure — the bytes are still served, only bookkeeping is lost */
  }
}

/** Queue an index read-modify-write; failures never surface to the caller. */
function withIndex(fn: (store: Cache, index: ArtIndex) => Promise<ArtIndex | void>): Promise<void> {
  const next = indexQueue.then(async () => {
    const store = await openStore()
    if (!store) return
    const index = await readIndex(store)
    const updated = await fn(store, index)
    if (updated) await writeIndex(store, updated)
  })
  indexQueue = next.catch(() => undefined)
  return indexQueue as Promise<void>
}

/** Drop least-recently-used entries until the stored total fits under the cap. */
async function evictToCap(store: Cache, index: ArtIndex): Promise<ArtIndex> {
  let total = Object.values(index).reduce((sum, e) => sum + e.size, 0)
  if (total <= ART_CACHE_MAX_BYTES) return index
  const byAge = Object.entries(index).sort((a, b) => a[1].at - b[1].at)
  for (const [key, entry] of byAge) {
    if (total <= ART_CACHE_MAX_BYTES) break
    try {
      await store.delete(cacheKeyFor(key))
    } catch {
      /* already gone */
    }
    delete index[key]
    total -= entry.size
  }
  return index
}

/** Store bytes for a content key and re-enforce the cap. Best-effort: never throws. */
function storeArt(key: string, blob: Blob): Promise<void> {
  // A single object larger than the whole cap would evict everything else to fit; skip it instead.
  if (blob.size > ART_CACHE_MAX_BYTES) return Promise.resolve()
  return withIndex(async (store, index) => {
    try {
      await store.put(cacheKeyFor(key), new Response(blob))
    } catch {
      return // quota rejection: leave the index describing what is actually stored
    }
    index[key] = { size: blob.size, at: Date.now() }
    return evictToCap(store, index)
  })
}

/** Mark a content key as just-used so eviction sees it as recent. Best-effort. */
function touchArt(key: string): void {
  void withIndex(async (_store, index) => {
    const entry = index[key]
    if (!entry) return
    index[key] = { size: entry.size, at: Date.now() }
    return index
  })
}

/** Stored bytes for a content key, or null when absent/unavailable. */
async function matchArt(key: string): Promise<Blob | null> {
  const store = await openStore()
  if (!store) return null
  try {
    const res = await store.match(cacheKeyFor(key))
    if (!res) return null
    return await res.blob()
  } catch {
    return null
  }
}

/**
 * Why an art pointer could not be resolved. `throttled` and `missing` must not render the same
 * thing: one is temporary and about the viewer, the other is permanent and about the content.
 */
export type ArtFailureReason = 'throttled' | 'missing' | 'offline'

/** Rejection carrying the reason, so the render layer can show the right state. */
export class ArtUnavailableError extends Error {
  readonly reason: ArtFailureReason
  /** Epoch ms the earliest gateway can be asked again (0 when not throttled/unknown). */
  readonly retryAt: number

  constructor(reason: ArtFailureReason, retryAt = 0) {
    super(`art unavailable: ${reason}`)
    this.name = 'ArtUnavailableError'
    this.reason = reason
    this.retryAt = retryAt
  }
}

/** The reason an art load failed; anything unrecognised reads as `offline`. */
export function artFailureReason(err: unknown): ArtFailureReason {
  return err instanceof ArtUnavailableError ? err.reason : 'offline'
}

/** `Retry-After` in ms, or null. Tolerates a response object that exposes no headers at all. */
function retryAfterOf(res: Response): number | null {
  try {
    return parseRetryAfter(res.headers?.get('retry-after'))
  } catch {
    return null
  }
}

/** Fetch one candidate URL with its own timeout, reporting the outcome to the health module. */
async function fetchCandidate(url: string, gatewayKey: string | null): Promise<Blob> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ART_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const outcome = classifyStatus(typeof res.status === 'number' ? res.status : res.ok ? 200 : 0)
    if (gatewayKey) noteOutcome(gatewayKey, outcome, retryAfterOf(res))
    if (outcome === 'throttled') throw new ArtUnavailableError('throttled')
    if (outcome === 'missing') throw new ArtUnavailableError('missing')
    // Any other non-2xx: this gateway did not deliver, but the content may still exist elsewhere.
    if (outcome !== 'ok') throw new ArtUnavailableError('offline')
    return await res.blob()
  } catch (err) {
    if (err instanceof ArtUnavailableError) throw err
    // Timeout or network error: the gateway did not deliver, so it is demoted like any other fault.
    if (gatewayKey) noteOutcome(gatewayKey, 'fault')
    throw new ArtUnavailableError('offline')
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArt(uri: string, key: string): Promise<string> {
  const stored = await matchArt(key)
  if (stored) {
    touchArt(key)
    return URL.createObjectURL(stored)
  }
  const candidates = resolveCandidates(uri)
  if (candidates.length === 0) {
    // Addressable, but every gateway that could serve it is cooling. Asking anyway is what keeps
    // the window from clearing, so nothing is spent and the state is reported as what it is.
    throw new ArtUnavailableError('throttled', retryAtFor(uri))
  }
  let sawThrottle = false
  let sawMissing = false
  for (const candidate of candidates) {
    try {
      const blob = await fetchCandidate(candidate.url, candidate.gatewayKey)
      void storeArt(key, blob)
      return URL.createObjectURL(blob)
    } catch (err) {
      const reason = artFailureReason(err)
      if (reason === 'throttled') sawThrottle = true
      else if (reason === 'missing') sawMissing = true
      // this candidate failed; try the next in the order we were given
    }
  }
  if (sawThrottle) throw new ArtUnavailableError('throttled', retryAtFor(uri))
  if (sawMissing) throw new ArtUnavailableError('missing')
  throw new ArtUnavailableError('offline')
}

/** Already-resolved URL for a pointer, or undefined. A hit means a re-mount costs no request. */
export function peekArt(uri: string): string | undefined {
  const trimmed = uri.trim()
  if (trimmed.startsWith('data:')) return trimmed
  return resolved.get(contentKey(trimmed))
}

/**
 * Resolve an immutable art pointer to a URL usable as an `<img src>`, fetching at most once per
 * content key across the whole app. `data:` resolves inline with no network access at all.
 *
 * Only content-addressed pointers may be passed: an `http(s)://` URL is mutable, so caching it
 * permanently would serve bytes the server has since replaced. Callers render those directly.
 */
export function loadArt(uri: string): Promise<string> {
  const trimmed = uri.trim()
  if (trimmed.startsWith('data:')) return Promise.resolve(trimmed)
  if (!isImmutableUri(trimmed)) {
    return Promise.reject(new Error('loadArt is only valid for content-addressed pointers'))
  }

  const key = contentKey(trimmed)
  const done = resolved.get(key)
  if (done) return Promise.resolve(done)
  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = fetchArt(trimmed, key)
    .then((url) => {
      resolved.set(key, url)
      return url
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}

/** Drop the in-memory layer (tests). Does not touch stored bytes. */
export function resetArtMemoryCache(): void {
  for (const url of resolved.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  resolved.clear()
  inFlight.clear()
}
