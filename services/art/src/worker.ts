/**
 * The art delivery service: a read-through cache in front of the public IPFS gateway roster.
 *
 * ── What it is, and the thing it deliberately is not ──────────────────────────────────────────
 * A visitor's first, cold-cache view of a collection grid asks a public gateway for every card.
 * Public gateways meter by client IP, so the grid that decides whether a stranger stays is the one
 * most likely to go grey. This serves those bytes from infrastructure we control instead.
 *
 * It is a CACHE AND NOT CUSTODY (rth 2026-09-25). It stores what it has served, it evicts on the
 * bucket's own lifecycle rule, and it claims no permanence: a collection whose own pin dies
 * degrades visibly rather than being hosted by us forever. Nothing here pins, re-pins, or promises
 * to hold anything. That is a deliberate refusal — pinning work that is not ours is an unbounded
 * bill, a moderation surface, and a promise we would have to keep.
 *
 * ── Why the app is not required to know about it ──────────────────────────────────────────────
 * The app addresses this service only when `VITE_ART_SERVICE` names one, and it reports failures
 * against the same health tracking it uses for gateways (`ART_SERVICE_KEY`), so a service that is
 * down, throttled or switched off cools and is skipped — and the roster underneath it carries on
 * exactly as it did before this existed. Unset is a supported state, not a degraded one. That is
 * what keeps a fork able to run with its own service or with none at all.
 *
 * ── The request this answers ──────────────────────────────────────────────────────────────────
 *   GET /art/<ipfs-path>?w=<width>
 * where `<ipfs-path>` is `<cid>` or `<cid>/<file>` and `<width>` is one of the rungs the app snaps
 * to. The shape is fixed by `artServiceUrl()` in app/src/lib/metadata/uri.ts; this file answers it
 * and does not get to invent its own.
 */

import { gatewayUrl, IPFS_GATEWAYS, type IpfsGateway } from '../../../app/src/lib/metadata/gateways'

export interface Env {
  /** Where served bytes are cached. Eviction is the bucket's lifecycle rule, not this worker's job. */
  ART_CACHE: R2Bucket
  /**
   * Comma-separated width rungs this deployment will serve, mirroring `ART_WIDTHS` in the app.
   * Read from configuration rather than hardcoded so a deployment cannot be made to mint an
   * unbounded number of variants by a caller that invents its own widths.
   */
  ART_WIDTHS?: string
}

/** Mirrors `ART_WIDTHS` in app/src/lib/metadata/uri.ts. Kept in sync by the test in this package. */
const DEFAULT_WIDTHS = [320, 640, 1024] as const

/** How long a gateway gets before it is counted as silent and the next one is tried. */
const GATEWAY_TIMEOUT_MS = 12_000

/**
 * The largest object worth caching. Art above this is proxied but not stored: a grid card never
 * needs it, and one multi-hundred-megabyte upload should not be able to fill the bucket.
 */
const MAX_CACHEABLE_BYTES = 32 * 1024 * 1024

/**
 * A CID with an optional path after it, and nothing that could climb out of it.
 *
 * `.` and `..` segments are refused outright rather than normalised, because normalising invites
 * the question of which layer normalised first — this worker, the runtime, or the gateway — and the
 * three do not have to agree.
 */
const IPFS_PATH = /^[A-Za-z0-9]{46,}(?:\/[A-Za-z0-9._~+-]+)*$/

function widthsOf(env: Env): readonly number[] {
  const raw = env.ART_WIDTHS?.trim()
  if (!raw) return DEFAULT_WIDTHS
  const parsed = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 8192)
  return parsed.length > 0 ? parsed : DEFAULT_WIDTHS
}

function isSafePath(path: string): boolean {
  if (!IPFS_PATH.test(path)) return false
  return !path.split('/').some((seg) => seg === '.' || seg === '..')
}

/** The bucket key for one variant. The width is part of the key, so rungs never collide. */
function cacheKey(path: string, width: number): string {
  return `${path}@w${width}`
}

function served(body: BodyInit, contentType: string, cacheStatus: 'hit' | 'miss'): Response {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      // Addressed by CID, so the bytes for a given key never change. The bucket may evict them;
      // that is a miss next time and not a different answer.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-art-cache': cacheStatus,
      'access-control-allow-origin': '*',
      // The service returns other people's art. It is never HTML we want interpreted.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}

/**
 * Ask the roster for the bytes, one gateway at a time, in order.
 *
 * ONE AT A TIME AND NOT IN PARALLEL, for the same reason the app does it that way: public gateways
 * meter by client IP, and asking all of them for the same object spends the budget of every one of
 * them to receive a single answer.
 */
async function fetchFromRoster(
  path: string,
  width: number,
  gateways: readonly IpfsGateway[],
): Promise<Response | null> {
  for (const gateway of gateways) {
    const url = gatewayUrl(gateway, path)
    if (url === null) continue
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
        // Cloudflare resizes at the edge when the zone has Image Resizing enabled. Where it is not
        // enabled the option is ignored and the original comes back, which is why the width is also
        // part of the cache key rather than assumed to have been applied.
        cf: { image: { width, fit: 'scale-down' } },
      } as RequestInit)
      if (res.ok && res.body !== null) return res
    } catch {
      // Timed out, refused, DNS — all the same thing here: try the next operator.
    }
  }
  return null
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }

    const url = new URL(request.url)
    const prefix = '/art/'
    if (!url.pathname.startsWith(prefix)) return new Response('not found', { status: 404 })

    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!isSafePath(path)) return new Response('bad request', { status: 400 })

    const widths = widthsOf(env)
    const wanted = Number.parseInt(url.searchParams.get('w') ?? '', 10)
    // An unknown width is refused rather than snapped. Snapping here would let any caller mint a
    // new bucket object per width it invents, which is an unbounded bill dressed as a convenience.
    if (!widths.includes(wanted)) return new Response('unsupported width', { status: 400 })

    const key = cacheKey(path, wanted)

    const hit = await env.ART_CACHE.get(key)
    if (hit !== null) {
      const type = hit.httpMetadata?.contentType ?? 'application/octet-stream'
      return served(hit.body, type, 'hit')
    }

    const upstream = await fetchFromRoster(path, wanted, IPFS_GATEWAYS)
    if (upstream === null) {
      // Every operator failed. 502 so the app cools this service the way it cools a gateway and
      // falls back to asking the roster itself — the fallback is the point, not a last resort.
      return new Response('no gateway answered', { status: 502 })
    }

    const type = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const length = Number.parseInt(upstream.headers.get('content-length') ?? '', 10)

    if (Number.isInteger(length) && length > MAX_CACHEABLE_BYTES) {
      return served(upstream.body!, type, 'miss')
    }

    // Tee: one copy to the visitor now, one to the bucket after the response is on its way, so a
    // slow write never delays the render this service exists to speed up.
    const [toClient, toCache] = upstream.body!.tee()
    ctx.waitUntil(
      env.ART_CACHE.put(key, toCache, { httpMetadata: { contentType: type } }).catch(() => {
        // A failed write is a miss next time. It is not a reason to fail this request.
      }),
    )
    return served(toClient, type, 'miss')
  },
}
