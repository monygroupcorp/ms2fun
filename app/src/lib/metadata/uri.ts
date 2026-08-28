/**
 * URI resolution for the backend-free metadata model (ADR-0004): every metadata pointer is an
 * on-chain URI; the content lives on IPFS / Arweave / inline data-URI. This resolves a pointer to a
 * fetchable URL and fetches+parses JSON.
 *
 * For ipfs:// the gateways are tried ONE AT A TIME, in health order, and rotation happens only on
 * failure. Public gateways meter by client IP, so asking all of them for the same bytes spends the
 * viewer's own quota once per gateway for every item they browse; a grid of a thousand items is the
 * difference between a thousand requests and several thousand. The gateway that answers becomes
 * last-known-good, so the next item starts there and costs one request.
 *
 * Pure TS (no React/wagmi) so NOEMA can reuse it; the deps are the pure, SSR-safe custom-gateway
 * store (W-A3/A4) and the gateway-health module that owns the ordering.
 */
import { customGatewayStore } from '../storage/keys'
import {
  classifyStatus,
  gatewayKey,
  nextAvailableAt,
  noteOutcome,
  noteRosterFault,
  noteRosterRecovered,
  orderGateways,
  parseRetryAfter,
  THROTTLE_BASE_MS,
  type AttemptOutcome,
} from './gatewayHealth'
import { isDocumentResponse, readCappedText } from './untrusted'

/**
 * Copy shown beside the custom-gateway input: a gateway a user pastes sees every CID they browse.
 * For someone running their own node that is the point; for someone pasting a URL a stranger
 * recommended it is a surveillance channel they did not know they opened, so it is stated plainly
 * at the input rather than in a tooltip.
 */
export const CUSTOM_GATEWAY_PRIVACY_NOTICE =
  'A custom gateway sees every piece of art and metadata you load, along with your IP address. ' +
  'Only use a gateway you run or trust.'

/** How a gateway addresses a CID. */
export type GatewayForm = 'path' | 'subdomain'

/** One public gateway endpoint. */
export interface IpfsGateway {
  /**
   * The organisation that runs the endpoint. This is the field that matters: entries sharing an
   * operator share a budget, a CDN config and an outage, so a roster that has re-converged on one
   * operator is a one-entry roster wearing several hostnames. Check this before adding a host.
   */
  operator: string
  /**
   * `path`      — base ending in `/ipfs/`; the CID is appended.
   * `subdomain` — bare host; the URL is built as `https://<cid>.ipfs.<host>/`.
   */
  form: GatewayForm
  base: string
}

/**
 * Public IPFS gateways, tried in sequence. No backend, account, API key or dashboard of ours —
 * public endpoints only, so the list stays walkawayable.
 *
 * Deliberately spans three independent operators. Ordered by observed retrieval reliability, and
 * kept short: under sequential rotation a long roster is a long tail of failures to walk before
 * giving up.
 *
 * Each entry was checked against a live CID in a real browser (a real Chrome, not a spoofed
 * user-agent) before being listed; documentation alone is not evidence a gateway serves bytes.
 */
export const IPFS_GATEWAYS: readonly IpfsGateway[] = [
  // Pinata. Path form only — the public gateway has no wildcard subdomain host.
  { operator: 'Pinata', form: 'path', base: 'https://gateway.pinata.cloud/ipfs/' },
  // Filebase. Path form only — subdomain requests to this host do not resolve to content.
  { operator: 'Filebase', form: 'path', base: 'https://ipfs.filebase.io/ipfs/' },
  // 4EVERLAND. Subdomain form only: the path endpoint does not respond, and the subdomain host
  // lower-cases the label, so a CIDv0 sent here comes back as a client error. See
  // `isSubdomainSafeCid` — CIDv0 pointers skip this entry rather than emitting a URL that 400s.
  { operator: '4EVERLAND', form: 'subdomain', base: '4everland.io' },
] as const

/**
 * Per-gateway request timeout — a hung gateway is aborted and the next one is tried.
 *
 * Measured against a live public gateway serving real seed content: 6.2-7.6 s wall, against the
 * previous 8 s cap — close enough that a routine response classified as a timeout `fault` rather
 * than a slow success. Raised to give a genuinely-serving-but-slow gateway room to finish instead
 * of being penalised for it.
 */
const GATEWAY_TIMEOUT_MS = 12_000

/**
 * True when a CID can be carried in a DNS label without changing meaning.
 *
 * Subdomain form gives every CID its own web origin, so anything active in the content can only
 * reach storage belonging to that CID rather than to everything else the gateway serves. It is the
 * form to prefer — but a DNS label is case-insensitive, so only a case-insensitive multibase
 * encoding survives it: base32 (`b…`) and base36 (`k…`) CIDv1. A CIDv0 (`Qm…`) is base58btc and
 * case-SENSITIVE; expressing it as a subdomain requires converting it to CIDv1 first. That
 * conversion needs a multiformats dependency we do not carry here, so CIDv0 pointers stay on
 * path-form gateways instead of being silently mangled.
 */
export function isSubdomainSafeCid(cid: string): boolean {
  return /^(b[a-z2-7]+|k[a-z0-9]+)$/.test(cid)
}

/** Build the URL for one gateway, or null when this gateway cannot address this CID. */
export function gatewayUrl(gateway: IpfsGateway, path: string): string | null {
  if (gateway.form === 'path') return `${gateway.base}${path}`
  const slash = path.indexOf('/')
  const cid = slash === -1 ? path : path.slice(0, slash)
  const rest = slash === -1 ? '' : path.slice(slash + 1)
  if (!isSubdomainSafeCid(cid)) return null
  return `https://${cid}.ipfs.${gateway.base}/${rest}`
}

/** Resolve a metadata URI to a fetchable URL for a given gateway (used for ipfs:// fallback). */
export function resolveUri(uri: string, gatewayIndex = 0): string {
  const trimmed = uri.trim()
  if (trimmed.startsWith('ipfs://')) {
    const urls = ipfsUrls(ipfsPath(trimmed), IPFS_GATEWAYS)
    return urls[gatewayIndex % urls.length] ?? urls[0] ?? trimmed
  }
  if (trimmed.startsWith('ar://')) {
    return `https://arweave.net/${trimmed.slice('ar://'.length)}`
  }
  // data:, http(s):, and already-resolved URLs pass through.
  return trimmed
}

/**
 * EVERY fetchable URL for a pointer, in roster order and ignoring health. For ipfs:// this is every
 * gateway that can address the CID (custom override first, then the public set); ar:/http/data
 * resolve to a single URL. Callers use this to answer "is this pointer addressable at all" —
 * to actually spend a request, use {@link resolveCandidates}, which is health-ordered.
 */
export function resolveUriCandidates(uri: string): string[] {
  const trimmed = uri.trim()
  if (trimmed.startsWith('ipfs://')) {
    return ipfsUrls(ipfsPath(trimmed), getIpfsGateways())
  }
  return [resolveUri(trimmed)]
}

/** True for pointers we can resolve/fetch; empty/garbage returns false (callers show a fallback). */
export function isResolvableUri(uri: string | undefined | null): uri is string {
  if (!uri) return false
  const t = uri.trim()
  return /^(ipfs:\/\/|ar:\/\/|https?:\/\/|data:)/.test(t)
}

/**
 * True for pointers whose bytes are fixed for all time, so a cached response can never go stale:
 *
 *  - `ipfs://` and `ar://` are content-addressed — the identifier IS a hash of the content, so
 *    different bytes are necessarily a different pointer.
 *  - `data:` carries its bytes inline; there is nothing to re-fetch.
 *
 * `http(s)://` is deliberately excluded: a server may serve different bytes tomorrow under the same
 * URL, so those pointers keep a finite staleTime and a normal revalidation cycle.
 */
export function isImmutableUri(uri: string | undefined | null): uri is string {
  if (!isResolvableUri(uri)) return false
  return /^(ipfs:\/\/|ar:\/\/|data:)/.test(uri.trim())
}

/**
 * Stable cache key for a pointer's CONTENT, independent of which gateway serves it: `ipfs://QmX`
 * and `ipfs://ipfs/QmX` are one entry. Non-ipfs pointers key on the trimmed pointer itself.
 */
export function contentKey(uri: string): string {
  const trimmed = uri.trim()
  return trimmed.startsWith('ipfs://') ? `ipfs://${ipfsPath(trimmed)}` : trimmed
}

/** ipfs://CID[/path] (and ipfs://ipfs/CID) → `CID[/path]`. */
function ipfsPath(uri: string): string {
  return uri
    .trim()
    .slice('ipfs://'.length)
    .replace(/^ipfs\//, '')
}

/** Every URL the given gateways can serve this path from, in order; unusable entries drop out. */
function ipfsUrls(path: string, gateways: readonly IpfsGateway[]): string[] {
  const urls: string[] = []
  for (const gateway of gateways) {
    const url = gatewayUrl(gateway, path)
    if (url) urls.push(url)
  }
  return urls
}

/**
 * Normalize a custom gateway base (any form) to end with `/ipfs/`. A user-supplied gateway is
 * treated as path form: an arbitrary host cannot be assumed to serve subdomain requests.
 */
export function normalizeGateway(base: string): string {
  const g = base.trim().replace(/\/+$/, '')
  return g.endsWith('/ipfs') ? `${g}/` : `${g}/ipfs/`
}

/**
 * The ordered gateway list to try for an ipfs:// pointer: a user's custom gateway (if set, via the
 * A3 store) first, then the public set. `customGateway` is injectable for testing; it defaults to
 * the persisted override (SSR-safe — returns null when unavailable).
 */
export function getIpfsGateways(
  customGateway: string | null = customGatewayStore.get(),
): IpfsGateway[] {
  const list = [...IPFS_GATEWAYS]
  if (customGateway && customGateway.trim()) {
    return [{ operator: 'custom', form: 'path', base: normalizeGateway(customGateway) }, ...list]
  }
  return list
}

/**
 * The health-ordered URLs to try for a pointer, best-first, each tagged with the gateway identity
 * whose health it reports to.
 *
 * For ipfs://: the viewer's custom gateway (if set) first, then every public gateway that can
 * address this CID and is NOT in cooldown, most-recently-good first. A cooling gateway is DROPPED,
 * not appended — asking it anyway is what keeps a rate-limit window from clearing. An empty result
 * for an otherwise-addressable pointer therefore means "every gateway is cooling", which callers
 * must report as throttled rather than as missing content.
 *
 * ar:/http/data resolve to a single URL with no gateway identity — there is nothing to rotate to
 * and no shared bucket to protect.
 */
export function resolveCandidates(uri: string): UriCandidate[] {
  const trimmed = uri.trim()
  if (!trimmed.startsWith('ipfs://')) return [{ url: resolveUri(trimmed), gatewayKey: null }]
  const path = ipfsPath(trimmed)
  const candidates: UriCandidate[] = []
  for (const gateway of orderGateways(usableGateways(path))) {
    const url = gatewayUrl(gateway, path)
    if (url) candidates.push({ url, gatewayKey: gatewayKey(gateway) })
  }
  return candidates
}

/** One URL to try, and the gateway whose health an attempt at it reports to (null = not a gateway). */
export interface UriCandidate {
  url: string
  gatewayKey: string | null
}

/** Every gateway that can address this path at all, regardless of health. */
function usableGateways(path: string): IpfsGateway[] {
  return getIpfsGateways().filter((gateway) => gatewayUrl(gateway, path) !== null)
}

/**
 * When a pointer is addressable but every gateway for it is cooling, the epoch ms at which the
 * first one can be asked again. 0 when at least one is askable now.
 */
export function retryAtFor(uri: string): number {
  const trimmed = uri.trim()
  if (!trimmed.startsWith('ipfs://')) return 0
  return nextAvailableAt(usableGateways(ipfsPath(trimmed)))
}

/**
 * The outcome of a metadata fetch, with the REASON preserved.
 *
 * A rate limit, an absent CID and a dead network are three different situations that want three
 * different responses from the UI: wait and retry, fall back to on-chain fields, and try again
 * later respectively. Collapsing them into one empty value makes every one of those indistinguishable
 * by the time a component renders, so the reason is carried instead.
 */
export type MetadataResult<T> =
  /** The document was retrieved and parsed. */
  | { status: 'found'; data: T }
  /** The pointer is unusable, or a gateway answered that the content is not there. */
  | { status: 'not-found' }
  /** Gateways are refusing us. `retryAt` is epoch ms of the earliest retry (0 when unknown). */
  | { status: 'throttled'; retryAt: number }
  /** Nothing answered: network failure, timeouts, or misbehaving gateways. */
  | { status: 'offline' }

const NOT_FOUND: MetadataResult<never> = { status: 'not-found' }
const OFFLINE: MetadataResult<never> = { status: 'offline' }

/**
 * The document, or null for every non-success. For call sites whose behaviour on a miss is already
 * "fall back to on-chain fields" and which do not render a throttle state themselves — the throttle
 * notice is app-level and reads gateway health directly, so those call sites stay one line.
 */
export function jsonOrNull<T>(result: MetadataResult<T>): T | null {
  return result.status === 'found' ? result.data : null
}

/** What one attempt learned: how it ended, the parsed body if it succeeded, and any `Retry-After`. */
interface Attempt<T> {
  outcome: AttemptOutcome
  data?: T
  retryAfterMs: number | null
}

/**
 * Classify a response. Falls back to `ok` when a response exposes no numeric status, so a minimal
 * response object is still read as success/failure rather than as a parse accident.
 */
function classifyResponse(res: Response): AttemptOutcome {
  const status = typeof res.status === 'number' && res.status > 0 ? res.status : res.ok ? 200 : 0
  return classifyStatus(status)
}

function retryAfterOf(res: Response): number | null {
  try {
    return parseRetryAfter(res.headers.get('retry-after'))
  } catch {
    return null
  }
}

/** One gateway attempt with its own timeout-abort, linked to the caller's signal. */
async function fetchOne<T>(url: string, parentSignal: AbortSignal): Promise<Attempt<T>> {
  const ctrl = new AbortController()
  const onParent = () => ctrl.abort()
  parentSignal.addEventListener('abort', onParent, { once: true })
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const outcome = classifyResponse(res)
    if (outcome !== 'ok') return { outcome, retryAfterMs: retryAfterOf(res) }
    // A gateway can answer 200 with an HTML challenge/error page instead of the CID's bytes.
    // That is this gateway failing, not the content being absent, so it demotes the gateway and
    // rotation continues rather than reporting the content as missing.
    if (isDocumentResponse(res)) return { outcome: 'fault', retryAfterMs: null }
    return { outcome: 'ok', data: JSON.parse(await readCappedText(res)) as T, retryAfterMs: null }
  } catch (err) {
    if (parentSignal.aborted) throw err
    // Network error, timeout, oversized body, or unparseable JSON — this gateway did not deliver.
    return { outcome: 'fault', retryAfterMs: null }
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParent)
  }
}

/**
 * Fetch + JSON-parse a metadata URI, returning the reason on failure.
 *
 * ipfs:// walks the health-ordered gateway list one at a time and stops at the first that answers:
 * N items cost N requests, not N x roster. A gateway that refuses is parked (see `gatewayHealth`)
 * so later items skip it entirely instead of re-spending the viewer's quota against a closed door.
 * data:/http/ar resolve once. `signal` lets React Query cancel in-flight work; cancellation
 * propagates exactly as before.
 */
export async function fetchJson<T = unknown>(
  uri: string,
  signal?: AbortSignal,
): Promise<MetadataResult<T>> {
  if (!isResolvableUri(uri)) return NOT_FOUND
  const trimmed = uri.trim()

  // Non-ipfs: a single resolve + fetch. No gateway roster, so nothing to rotate or to cool.
  if (!trimmed.startsWith('ipfs://')) {
    try {
      const res = await fetch(resolveUri(trimmed), signal ? { signal } : {})
      const outcome = classifyResponse(res)
      if (outcome === 'missing') return NOT_FOUND
      if (outcome === 'throttled') {
        return {
          status: 'throttled',
          retryAt: Date.now() + (retryAfterOf(res) ?? THROTTLE_BASE_MS),
        }
      }
      if (outcome !== 'ok') return OFFLINE
      if (isDocumentResponse(res)) return OFFLINE
      return { status: 'found', data: JSON.parse(await readCappedText(res)) as T }
    } catch (err) {
      if (signal?.aborted) throw err
      return OFFLINE
    }
  }

  // Already-cancelled callers shouldn't fire any requests.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const path = ipfsPath(trimmed)
  const addressable = usableGateways(path)
  if (addressable.length === 0) return NOT_FOUND
  const candidates = resolveCandidates(trimmed)
  if (candidates.length === 0) {
    // Every gateway that could serve this CID is in cooldown. Firing at them anyway is precisely
    // what keeps the window from clearing, so we report the state instead of spending the request.
    // A real cooldown is a throttle signal, not starvation — clear any fault streak.
    noteRosterRecovered()
    return { status: 'throttled', retryAt: nextAvailableAt(addressable) }
  }

  // Shared "stop" signal: fires when the caller aborts or when we are done.
  const stop = new AbortController()
  const onCallerAbort = () => stop.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  let sawThrottle = false
  let sawMissing = false
  try {
    for (const candidate of candidates) {
      const attempt = await fetchOne<T>(candidate.url, stop.signal)
      if (candidate.gatewayKey) {
        noteOutcome(candidate.gatewayKey, attempt.outcome, attempt.retryAfterMs)
      }
      if (attempt.outcome === 'ok') {
        noteRosterRecovered()
        return { status: 'found', data: attempt.data as T }
      }
      if (attempt.outcome === 'throttled') sawThrottle = true
      else if (attempt.outcome === 'missing') sawMissing = true
    }
    // Every gateway tried faulted — no ok, no throttle, no missing anywhere in the roster. That is
    // the starvation signal `GatewayThrottleNotice` needs; anything else (a throttle or a missing
    // mixed in) means the roster is still answering, so the streak resets instead.
    if (!sawThrottle && !sawMissing) noteRosterFault()
    else noteRosterRecovered()
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    throw err
  } finally {
    stop.abort()
    signal?.removeEventListener('abort', onCallerAbort)
  }

  if (sawThrottle) return { status: 'throttled', retryAt: nextAvailableAt(addressable) }
  if (sawMissing) return NOT_FOUND
  // Some gateways may have been skipped as cooling; if so this is a throttle, not a dead network.
  const retryAt = candidates.length < addressable.length ? nextAvailableAt(addressable) : 0
  return retryAt > 0 ? { status: 'throttled', retryAt } : OFFLINE
}

/**
 * The CID used to prove a pasted gateway actually serves IPFS content: the canonical zero-byte
 * UnixFS file. It is the most widely pinned object on the network and costs nothing to transfer, so
 * a gateway that cannot serve it cannot serve anything. CIDv0 is fine here — a custom gateway is
 * always addressed in path form.
 */
export const GATEWAY_PROBE_CID = 'QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH'

/** How long to wait for a pasted gateway to prove itself before calling it unusable. */
const PROBE_TIMEOUT_MS = 10_000

/** Outcome of validating a pasted gateway: the normalized base, or why it was rejected. */
export type GatewayProbeResult = { ok: true; base: string } | { ok: false; reason: string }

/**
 * Validate and probe a viewer-supplied gateway before it is saved.
 *
 * A typo'd gateway that is stored and silently fails is worse than no custom gateway at all: it
 * takes priority over the public set, so every subsequent load starts by failing. The shape is
 * checked first (an https/http URL), then the gateway is asked for a known-good CID and must answer
 * with content rather than a challenge document.
 */
export async function probeGateway(input: string): Promise<GatewayProbeResult> {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, reason: 'Enter a gateway URL.' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      ok: false,
      reason: 'That is not a URL. It should look like https://your-gateway.example.',
    }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'A gateway URL must start with https:// (or http:// on a local node).',
    }
  }

  const base = normalizeGateway(trimmed)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${GATEWAY_PROBE_CID}`, { signal: ctrl.signal })
    const outcome = classifyResponse(res)
    if (outcome === 'throttled') {
      return { ok: false, reason: 'That gateway is rate-limiting this browser right now.' }
    }
    if (outcome !== 'ok') {
      return {
        ok: false,
        reason: 'That gateway did not serve a test CID, so it would not serve art.',
      }
    }
    if (isDocumentResponse(res)) {
      return { ok: false, reason: 'That URL answered with a web page instead of IPFS content.' }
    }
    return { ok: true, base }
  } catch {
    return { ok: false, reason: 'Could not reach that gateway. Check the URL and try again.' }
  } finally {
    clearTimeout(timer)
  }
}
