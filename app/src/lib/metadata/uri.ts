/**
 * URI resolution for the backend-free metadata model (ADR-0004): every metadata pointer is an
 * on-chain URI; the content lives on IPFS / Arweave / inline data-URI. This resolves a pointer to a
 * fetchable URL and fetches+parses JSON. For ipfs:// it RACES all gateways (first healthy response
 * wins, losers aborted) so one dead gateway can't add tail latency. Pure TS (no React/wagmi) so
 * NOEMA can reuse it; the only dep is the pure, SSR-safe custom-gateway store (W-A3/A4).
 */
import { customGatewayStore } from '../storage/keys'

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
 * Public IPFS gateways, raced in parallel. No backend, account, API key or dashboard of ours —
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

/** Per-gateway request timeout — a hung gateway is aborted and the others still race. */
const GATEWAY_TIMEOUT_MS = 8_000

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
 * Ordered list of fetchable URLs to try for a pointer, best-first. For ipfs:// this is EVERY gateway
 * that can address the CID (custom override first, then the public set) so an `<img>` can rotate to
 * the next on a load error/timeout instead of dying on gateway 0 — the image analogue of fetchJson's
 * gateway race. ar:/http/data resolve to a single URL.
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
function normalizeGateway(base: string): string {
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

/** One gateway attempt with its own timeout-abort, linked to the parent (winner/caller) signal. */
async function fetchOne<T>(url: string, parentSignal: AbortSignal): Promise<T> {
  const ctrl = new AbortController()
  const onParent = () => ctrl.abort()
  parentSignal.addEventListener('abort', onParent, { once: true })
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`gateway responded ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', onParent)
  }
}

/**
 * Fetch + JSON-parse a metadata URI. ipfs:// RACES every gateway (first 2xx-JSON wins, losers
 * aborted); data:/http/ar resolve once. Returns null on any failure (unreachable, non-JSON, bad
 * pointer) — callers fall back to on-chain fields. `signal` lets React Query cancel in-flight work.
 */
export async function fetchJson<T = unknown>(uri: string, signal?: AbortSignal): Promise<T | null> {
  if (!isResolvableUri(uri)) return null
  const trimmed = uri.trim()

  // Non-ipfs: a single resolve + fetch.
  if (!trimmed.startsWith('ipfs://')) {
    try {
      const res = await fetch(resolveUri(trimmed), signal ? { signal } : {})
      if (!res.ok) return null
      return (await res.json()) as T
    } catch (err) {
      if (signal?.aborted) throw err
      return null
    }
  }

  // Already-cancelled callers shouldn't fire any requests.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const urls = ipfsUrls(ipfsPath(trimmed), getIpfsGateways())
  if (urls.length === 0) return null
  // Shared "stop everyone" signal: fires when a winner is found (finally) or the caller aborts.
  const stop = new AbortController()
  const onCallerAbort = () => stop.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    return await Promise.any(urls.map((url) => fetchOne<T>(url, stop.signal)))
  } catch {
    // AggregateError: every gateway failed. Surface a caller-abort as such; else soft-fail.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return null
  } finally {
    stop.abort() // cancel any losers still in flight
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
