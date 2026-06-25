/**
 * URI resolution for the backend-free metadata model (ADR-0004): every metadata pointer is an
 * on-chain URI; the content lives on IPFS / Arweave / inline data-URI. This resolves a pointer to a
 * fetchable URL and fetches+parses JSON. For ipfs:// it RACES all gateways (first healthy response
 * wins, losers aborted) so one dead gateway can't add tail latency. Pure TS (no React/wagmi) so
 * NOEMA can reuse it; the only dep is the pure, SSR-safe custom-gateway store (W-A3/A4).
 */
import { customGatewayStore } from '../storage/keys'

/** Public IPFS gateways, raced in parallel. No backend of our own. (cloudflare-ipfs.com is dead.) */
export const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
] as const

/** Per-gateway request timeout — a hung gateway is aborted and the others still race. */
const GATEWAY_TIMEOUT_MS = 8_000

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
function normalizeGateway(base: string): string {
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

  const path = ipfsPath(trimmed)
  const gateways = getIpfsGateways()
  // Shared "stop everyone" signal: fires when a winner is found (finally) or the caller aborts.
  const stop = new AbortController()
  const onCallerAbort = () => stop.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    return await Promise.any(gateways.map((g) => fetchOne<T>(`${g}${path}`, stop.signal)))
  } catch {
    // AggregateError: every gateway failed. Surface a caller-abort as such; else soft-fail.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return null
  } finally {
    stop.abort() // cancel any losers still in flight
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
