/**
 * URI resolution for the backend-free metadata model (ADR-0004): every metadata pointer is an
 * on-chain URI; the content lives on IPFS / Arweave / inline data-URI. This resolves a pointer to a
 * fetchable URL and fetches+parses JSON, with public-gateway fallback. Pure TS (no React/wagmi) so
 * NOEMA can reuse it.
 */

/** Public IPFS gateways, tried in order on failure. No backend of our own. */
export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
] as const

/** Resolve a metadata URI to a fetchable URL for a given gateway (used for ipfs:// fallback). */
export function resolveUri(uri: string, gatewayIndex = 0): string {
  const trimmed = uri.trim()
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')
    const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length] ?? IPFS_GATEWAYS[0]
    return `${gateway}${path}`
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

/**
 * Fetch + JSON-parse a metadata URI. For ipfs:// it retries across gateways; data:/http resolve
 * once. Returns null on any failure (unreachable, non-JSON, bad pointer) — callers fall back to
 * on-chain fields. The optional `signal` lets React Query cancel in-flight fetches.
 */
export async function fetchJson<T = unknown>(uri: string, signal?: AbortSignal): Promise<T | null> {
  if (!isResolvableUri(uri)) return null
  const isIpfs = uri.trim().startsWith('ipfs://')
  const attempts = isIpfs ? IPFS_GATEWAYS.length : 1
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(resolveUri(uri, i), signal ? { signal } : {})
      if (!res.ok) continue
      return (await res.json()) as T
    } catch (err) {
      if (signal?.aborted) throw err
      // try the next gateway
    }
  }
  return null
}
