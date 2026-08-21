/**
 * URI resolution for the backend-free metadata model (ADR-0004): every metadata pointer is an
 * on-chain URI; the content lives on IPFS / Arweave / inline data-URI. This resolves a pointer to a
 * fetchable URL and fetches+parses JSON.
 *
 * For ipfs:// the gateways are tried ONE AT A TIME, best-first, not in parallel. Public gateways
 * rate-limit per client IP, so asking three of them for the same bytes spends three times the
 * browser's own budget for one item and reaches the limit three times sooner; the roster exists to
 * survive a dead gateway, not to be swept on every fetch. The order and the skipping come from
 * `gatewayHealth`, which both this module and `IpfsImage` read, so a gateway that has just refused
 * us is left alone by both until its window passes.
 *
 * Pure TS (no React/wagmi) so NOEMA can reuse it; the deps are the pure, SSR-safe custom-gateway
 * store (W-A3/A4) and the equally pure health module.
 */
import { customGatewayStore } from '../storage/keys'
import {
  classifyStatus,
  cooldownEndsAt,
  isCooling,
  noteGatewayFault,
  noteGatewaySuccess,
  parseRetryAfter,
  readyGateways,
  type GatewayFault,
} from './gatewayHealth'

/**
 * Copy shown beside the custom-gateway input: a gateway a user pastes sees every CID they browse.
 * For someone running their own node that is the point; for someone pasting a URL a stranger
 * recommended it is a surveillance channel they did not know they opened, so it is stated plainly
 * at the input rather than in a tooltip.
 */
export const CUSTOM_GATEWAY_PRIVACY_NOTICE =
  'A custom gateway sees every piece of art and metadata you load, along with your IP address. ' +
  'Only use a gateway you run or trust.'

/** Public IPFS gateways, tried in order. No backend of our own. (cloudflare-ipfs.com is dead.) */
export const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
] as const

/** Per-gateway request timeout — a hung gateway is abandoned and the next one is tried. */
const GATEWAY_TIMEOUT_MS = 8_000

/**
 * A tiny, widely-replicated raw block used to prove a pasted gateway actually serves content.
 * Raw-codec CIDv1, so a gateway has to fetch the block to answer — a host that merely returns 200
 * for anything fails the check, and so does a typo'd URL.
 */
export const GATEWAY_PROBE_CID = 'bafkreicysg23kiwv34eg2d7qweipxwosdo2py4ldv42nbauguluen5v6am'
const GATEWAY_PROBE_EXPECTED = 'hello'

/**
 * The outcome of a metadata fetch, with the REASON intact.
 *
 * A bare `null` cannot tell a caller whether the art is absent or the browser has been rate-limited,
 * and those are different things to show a person: one is a property of the collection, the other is
 * temporary and belongs to this browser. Anything that renders a fallback needs to know which.
 */
export type MetadataResult<T> =
  /** The content was fetched and parsed. */
  | { readonly status: 'found'; readonly data: T }
  /** The pointer resolved but the content is not there (or is not JSON). Fall back to on-chain. */
  | { readonly status: 'not-found' }
  /** Every gateway we may ask is inside a rate-limit window. `readyAt` is epoch ms. */
  | { readonly status: 'throttled'; readonly readyAt: number }
  /** Nothing answered: transport failure, timeouts, or no gateway can address this pointer. */
  | { readonly status: 'offline' }

/** The payload, or null for every non-`found` outcome — for callers that only want the data. */
export function metadataOrNull<T>(result: MetadataResult<T>): T | null {
  return result.status === 'found' ? result.data : null
}

/** Resolve a metadata URI to a fetchable URL for a given gateway (used for ipfs:// fallback). */
export function resolveUri(uri: string, gatewayIndex = 0): string {
  const trimmed = uri.trim()
  if (trimmed.startsWith('ipfs://')) {
    const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length] ?? IPFS_GATEWAYS[0]
    return `${gateway}${ipfsPath(trimmed)}`
  }
  if (trimmed.startsWith('ar://')) {
    return `https://arweave.net/${trimmed.slice('ar://'.length)}`
  }
  // data:, http(s):, and already-resolved URLs pass through.
  return trimmed
}

/**
 * Ordered list of fetchable URLs to try for a pointer, best-first. For ipfs:// this is EVERY gateway
 * (custom override first, then the public set) so an `<img>` can rotate to the next on a load
 * error/timeout instead of dying on gateway 0. ar:/http/data resolve to a single URL.
 *
 * This is the unranked list — it ignores health. `rankedUriCandidates` is what callers that spend
 * request budget should use.
 */
export function resolveUriCandidates(uri: string): string[] {
  const trimmed = uri.trim()
  if (trimmed.startsWith('ipfs://')) {
    const path = ipfsPath(trimmed)
    return getIpfsGateways().map((g) => `${g}${path}`)
  }
  return [resolveUri(trimmed)]
}

/** Candidate URLs filtered and ordered by gateway health. */
export interface RankedCandidates {
  /** URLs worth trying now, best-first. Empty when every gateway is inside a cooldown window. */
  urls: string[]
  /** When `urls` is empty because of cooldowns: epoch ms the first gateway becomes askable. */
  readyAt: number | null
}

/**
 * The URLs an image should actually try, in the order it should try them: the user's own gateway
 * first when set, then the public gateways that are not cooling, most-recently-good first.
 *
 * An empty list with a `readyAt` is a real answer — it means "do not ask anyone yet", which is the
 * whole point: firing at a gateway that is refusing us is what keeps the window from clearing.
 */
export function rankedUriCandidates(uri: string, now = Date.now()): RankedCandidates {
  const trimmed = uri.trim()
  if (!trimmed.startsWith('ipfs://')) {
    return { urls: trimmed ? [resolveUri(trimmed)] : [], readyAt: null }
  }
  const path = ipfsPath(trimmed)
  const gateways = getIpfsGateways()
  const ordered = orderedGateways(gateways, now)
  if (ordered.length === 0) return { urls: [], readyAt: cooldownEndsAt(gateways, now) }
  return { urls: ordered.map((g) => `${g}${path}`), readyAt: null }
}

/** True for pointers we can resolve/fetch; empty/garbage returns false (callers show a fallback). */
export function isResolvableUri(uri: string | undefined | null): uri is string {
  if (!uri) return false
  const t = uri.trim()
  return /^(ipfs:\/\/|ar:\/\/|https?:\/\/|data:)/.test(t)
}

/** ipfs://CID[/path] (and ipfs://ipfs/CID) → `CID[/path]`. */
function ipfsPath(uri: string): string {
  return uri
    .trim()
    .slice('ipfs://'.length)
    .replace(/^ipfs\//, '')
}

/** Normalize a custom gateway base (any form) to end with `/ipfs/`. */
export function normalizeGateway(base: string): string {
  const g = base.trim().replace(/\/+$/, '')
  return g.endsWith('/ipfs') ? `${g}/` : `${g}/ipfs/`
}

/**
 * The ordered gateway list to try for an ipfs:// pointer: a user's custom gateway (if set, via the
 * A3 store) first, then the public set. `customGateway` is injectable for testing; it defaults to
 * the persisted override (SSR-safe — returns null when unavailable).
 */
export function getIpfsGateways(customGateway: string | null = customGatewayStore.get()): string[] {
  const list: string[] = [...IPFS_GATEWAYS]
  if (customGateway && customGateway.trim()) {
    return [normalizeGateway(customGateway), ...list]
  }
  return list
}

/**
 * Health-ordered subset of `gateways`: the user's own gateway keeps its place at the head (it is
 * theirs, and we are not spending a shared public budget on it), the public set behind it is
 * filtered to whatever is not cooling and sorted most-recently-good first, so the common case costs
 * one request.
 */
function orderedGateways(gateways: string[], now = Date.now()): string[] {
  const head = gateways[0]
  const isPublic = (base: string): boolean => (IPFS_GATEWAYS as readonly string[]).includes(base)
  const custom = head !== undefined && !isPublic(head) ? head : undefined
  const publics = custom === undefined ? gateways : gateways.slice(1)
  const ordered = readyGateways(publics, now)
  // A custom gateway that has just refused us is skipped too — hammering it is no kinder than
  // hammering a public one — but it never loses its place to a public gateway.
  if (custom !== undefined && !isCooling(custom, now)) ordered.unshift(custom)
  return ordered
}

/** One gateway attempt: 2xx-JSON, or a classified fault. Only a caller abort throws. */
type Attempt<T> =
  | { kind: 'found'; data: T }
  | { kind: 'fault'; fault: GatewayFault; retryAfterMs: number | null }

function retryAfterOf(res: Response): number | null {
  return parseRetryAfter(res.headers?.get?.('retry-after') ?? null)
}

async function fetchOne<T>(
  url: string,
  parentSignal: AbortSignal | undefined,
): Promise<Attempt<T>> {
  const ctrl = new AbortController()
  const onParent = () => ctrl.abort()
  parentSignal?.addEventListener('abort', onParent, { once: true })
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      return { kind: 'fault', fault: classifyStatus(res.status), retryAfterMs: retryAfterOf(res) }
    }
    return { kind: 'found', data: (await res.json()) as T }
  } catch (err) {
    // A caller cancelling is not a gateway fault and must not be recorded as one.
    if (parentSignal?.aborted) throw err
    // A timeout aborts the same way a transport error fails: soft demote, not a refusal.
    return { kind: 'fault', fault: 'network', retryAfterMs: null }
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParent)
  }
}

/** Default assumed window when a gateway refuses without telling us when to come back. */
const ASSUMED_THROTTLE_MS = 60_000

/**
 * Fetch + JSON-parse a metadata URI, returning the outcome WITH its reason.
 *
 * ipfs:// walks the health-ordered gateway list one request at a time and stops at the first 2xx, so
 * a healthy list costs exactly one request per item. A gateway that refuses (`429`/`503`) is cooled
 * and skipped on the next item; a `404` is attributed to the content, not the gateway. When every
 * gateway is inside a cooldown window nothing is sent at all and the result is `throttled` — the
 * silence is what lets the window clear. data:/http/ar resolve once, as before.
 *
 * `signal` lets React Query cancel in-flight work; cancellation still rejects with an AbortError.
 */
export async function fetchJson<T = unknown>(
  uri: string,
  signal?: AbortSignal,
): Promise<MetadataResult<T>> {
  if (!isResolvableUri(uri)) return { status: 'not-found' }
  const trimmed = uri.trim()

  // Non-ipfs: a single resolve + fetch. None of our gateways is involved, so no health is recorded.
  if (!trimmed.startsWith('ipfs://')) {
    try {
      const res = await fetch(resolveUri(trimmed), signal ? { signal } : {})
      if (!res.ok) {
        const fault = classifyStatus(res.status)
        if (fault === 'throttled') {
          const wait = retryAfterOf(res) ?? ASSUMED_THROTTLE_MS
          return { status: 'throttled', readyAt: Date.now() + wait }
        }
        return fault === 'missing' ? { status: 'not-found' } : { status: 'offline' }
      }
      return { status: 'found', data: (await res.json()) as T }
    } catch (err) {
      if (signal?.aborted) throw err
      return { status: 'offline' }
    }
  }

  // Already-cancelled callers shouldn't fire any requests.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const path = ipfsPath(trimmed)
  const gateways = getIpfsGateways()
  const ordered = orderedGateways(gateways)
  if (ordered.length === 0) {
    const readyAt = cooldownEndsAt(gateways)
    return readyAt === null ? { status: 'offline' } : { status: 'throttled', readyAt }
  }

  let sawMissing = false
  let throttledUntil = 0
  for (const gateway of ordered) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const attempt = await fetchOne<T>(`${gateway}${path}`, signal)
    if (attempt.kind === 'found') {
      // The gateway that answered becomes last-known-good, so the next item starts here and the
      // common case stays at one request.
      noteGatewaySuccess(gateway)
      return { status: 'found', data: attempt.data }
    }
    noteGatewayFault(gateway, attempt.fault, attempt.retryAfterMs)
    if (attempt.fault === 'missing') sawMissing = true
    if (attempt.fault === 'throttled') {
      const wait = attempt.retryAfterMs ?? ASSUMED_THROTTLE_MS
      throttledUntil = Math.max(throttledUntil, Date.now() + wait)
    }
  }

  // Every gateway we were allowed to ask has answered. A refusal anywhere in that walk is the more
  // actionable reason to report; an absent CID is next; otherwise nothing reachable answered.
  if (throttledUntil > 0) return { status: 'throttled', readyAt: throttledUntil }
  return sawMissing ? { status: 'not-found' } : { status: 'offline' }
}

/**
 * Prove a pasted gateway actually serves IPFS content before it is saved. A typo'd or dead gateway
 * that is stored silently is worse than none — it would sit at the head of the list and fail every
 * item — so the check fetches a known raw block and compares the bytes rather than trusting a 200.
 */
export async function probeGateway(base: string, timeoutMs = GATEWAY_TIMEOUT_MS): Promise<boolean> {
  const url = `${normalizeGateway(base)}${GATEWAY_PROBE_CID}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return false
    return (await res.text()).trim() === GATEWAY_PROBE_EXPECTED
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
