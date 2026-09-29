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
 * ── The two requests this answers ─────────────────────────────────────────────────────────────
 *   GET /art/<ipfs-path>?w=<width>    the image, at one of the rungs the app snaps to
 *   GET /meta/<ipfs-path>             the collection's metadata JSON, verbatim
 *
 * BOTH, because one without the other does not achieve the thing. A card cannot render art until it
 * has read the JSON that names the art's CID, so a grid served art from here and metadata from a
 * public gateway still spends one third-party request per card, still on the viewer's own metered
 * IP, and still before anything appears. The JSON is the FIRST request of the two and the art
 * service was answering only the second.
 *
 * `<ipfs-path>` is `<cid>` or `<cid>/<file>`. Both shapes are fixed by `artServiceUrl()` and
 * `metaServiceUrl()` in app/src/lib/metadata/uri.ts; this file answers them and does not get to
 * invent its own.
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
  /**
   * CIDs this deployment will not redistribute, comma- or whitespace-separated.
   *
   * THE SCOPE IS OUR OWN DOMAIN AND NOTHING WIDER. An entry here stops this service serving the
   * object and drops whatever it had cached; it does not remove the object from IPFS, which is not
   * ours to remove, and it does not touch the public roster the app falls back to. A denied CID
   * therefore still reaches a viewer through a gateway — what changes is that it no longer reaches
   * them through us. Saying more than that in a takedown reply would be a promise nobody can keep.
   *
   * A path under a denied CID is denied too: a takedown is about the work, not one file of it.
   */
  ART_DENYLIST?: string
  /**
   * A gateway on an account WE control, tried before the public roster. A base URL
   * (`https://<name>.mypinata.cloud`, with or without a trailing `/ipfs/`).
   *
   * The public roster meters by client IP, and the client here is a Cloudflare datacentre rather
   * than a visitor: measured 2026-09-29, `ipfs.io` and `dweb.link` answer a plain request 429, and
   * the roster as shipped returned this worker nothing at all while the same CID came back
   * `200 image/png` to a laptop. Every card 502'd. A dedicated gateway answers an origin server
   * because its quota belongs to the account that pins the art, not to whoever is asking.
   *
   * SET AT DEPLOY TIME AND NAMED NOWHERE IN THIS REPOSITORY (`wrangler deploy --var
   * ART_GATEWAY_LEAD:...`), for the same reason no account identifier is: a fork stands up its own
   * or runs without one. Unset is supported and is exactly today's behaviour, the public roster
   * alone. It LEADS the roster, it does not replace it: a dedicated gateway that is down, over
   * quota or misconfigured falls through to the public entries like any other operator.
   */
  ART_GATEWAY_LEAD?: string
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
 * Cap on a metadata document, far below the art cap on purpose.
 *
 * A collection's JSON is a name, a description and some pointers — kilobytes. Anything at this size
 * is not metadata, and refusing it here is what stops one pathological document being read into
 * memory and stored under a key the app will ask for on every card.
 */
const MAX_META_BYTES = 512 * 1024

/**
 * A CID with an optional path after it, and nothing that could climb out of it.
 *
 * `.` and `..` segments are refused outright rather than normalised, because normalising invites
 * the question of which layer normalised first — this worker, the runtime, or the gateway — and the
 * three do not have to agree.
 */
const IPFS_PATH = /^[A-Za-z0-9]{46,}(?:\/[A-Za-z0-9._~+-]+)*$/

/**
 * The roster this deployment asks, lead gateway first.
 *
 * Returns `IPFS_GATEWAYS` unchanged when no lead is configured, so an unset deployment behaves
 * exactly as it did before this existed — the same promise `ART_WIDTHS` and `ART_DENYLIST` make.
 */
function rosterOf(env: Env): readonly IpfsGateway[] {
  const lead = leadGateway(env.ART_GATEWAY_LEAD)
  return lead === null ? IPFS_GATEWAYS : [lead, ...IPFS_GATEWAYS]
}

/**
 * Turns the configured value into a path-form gateway, or null when it names none.
 *
 * `https://x.mypinata.cloud` and `https://x.mypinata.cloud/ipfs/` mean the same deployment, so both
 * are accepted and normalised to the second — an operator should not have to remember which half of
 * the URL this variable wants.
 *
 * Anything that is not an https origin is IGNORED rather than prepended as a broken entry. A
 * malformed lead left in the list would be a guaranteed timeout at the head of every single fetch,
 * which is worse than not having one.
 */
export function leadGateway(raw: string | undefined): IpfsGateway | null {
  const trimmed = raw?.trim().replace(/\/+$/, '')
  if (!trimmed || !/^https:\/\//.test(trimmed)) return null
  const base = trimmed.endsWith('/ipfs') ? `${trimmed}/` : `${trimmed}/ipfs/`
  return { operator: 'lead', form: 'path', base }
}

function widthsOf(env: Env): readonly number[] {
  const raw = env.ART_WIDTHS?.trim()
  if (!raw) return DEFAULT_WIDTHS
  const parsed = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 8192)
  return parsed.length > 0 ? parsed : DEFAULT_WIDTHS
}

/**
 * The CIDs this deployment refuses, as a set.
 *
 * Parsed per request rather than cached in module scope: an isolate can live for a long time, and a
 * takedown that only takes effect after a redeploy or an eviction is not a takedown. Splitting a
 * short string is cheaper than the R2 read it precedes.
 */
function denylistOf(env: Env): ReadonlySet<string> {
  const raw = env.ART_DENYLIST?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      // Only the CID is matched, so an operator who pastes a full path or an ipfs:// URL by mistake
      // still denies the right work rather than nothing at all.
      .map((entry) => entry.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '').split('/')[0]!),
  )
}

/** The CID part of a request path — the unit a takedown names. */
function cidOf(path: string): string {
  return path.split('/')[0]!
}

function isSafePath(path: string): boolean {
  if (!IPFS_PATH.test(path)) return false
  return !path.split('/').some((seg) => seg === '.' || seg === '..')
}

/** The bucket key for one variant. The width is part of the key, so rungs never collide. */
function cacheKey(path: string, width: number): string {
  return `${path}@w${width}`
}

/** The bucket key for a metadata document. Prefixed so it can never collide with a width key. */
function metaKey(path: string): string {
  return `meta/${path}`
}

/**
 * Whether an upstream answer is plausibly the JSON document that was asked for.
 *
 * A public gateway that cannot serve a CID often answers 200 with an HTML error page, and a
 * gateway-supplied HTML document stored under a metadata key and then served from our own origin is
 * the shape of a much worse bug than a cache miss. The app has the same guard; this one exists so a
 * bad answer is never STORED, which the app cannot undo.
 */
function looksLikeJson(contentType: string, body: string): boolean {
  if (/^\s*text\/html\b/i.test(contentType)) return false
  const head = body.trimStart().slice(0, 1)
  return head === '{' || head === '['
}

/** The response for a metadata document: JSON, never interpreted, cacheable by content address. */
function servedJson(body: string, cacheStatus: 'hit' | 'miss'): Response {
  return new Response(body, {
    headers: {
      // Served as JSON whatever the gateway called it — gateways label IPFS JSON as octet-stream,
      // text/plain and worse, and the body has already been checked to parse as JSON.
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-art-cache': cacheStatus,
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
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

/**
 * Ask the roster for a metadata document, one gateway at a time, in the same order and for the same
 * reason as the art path.
 *
 * Returns the body as text rather than a stream: it has to be read to be checked, it is small by
 * definition, and having it in hand is what lets the same bytes go to the visitor and the bucket
 * without a tee.
 */
async function fetchMetaFromRoster(
  path: string,
  gateways: readonly IpfsGateway[],
): Promise<string | null> {
  for (const gateway of gateways) {
    const url = gatewayUrl(gateway, path)
    if (url === null) continue
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) })
      if (!res.ok) continue
      const length = Number.parseInt(res.headers.get('content-length') ?? '', 10)
      if (Number.isInteger(length) && length > MAX_META_BYTES) continue
      const body = await res.text()
      // Re-checked after reading, because a gateway need not send content-length at all and this is
      // the only bound that always holds.
      if (body.length > MAX_META_BYTES) continue
      if (!looksLikeJson(res.headers.get('content-type') ?? '', body)) continue
      // Parsed and not merely sniffed: an answer this cannot parse is one the app could not use, and
      // storing it would serve the same unusable bytes from our origin until it was evicted.
      try {
        JSON.parse(body)
      } catch {
        continue
      }
      return body
    } catch {
      // Timed out, refused, DNS, a body that would not read — try the next operator.
    }
  }
  return null
}

/** 410 for a denied CID, with every key this deployment could be holding for it dropped. */
function gone(env: Env, ctx: ExecutionContext, path: string, widths: readonly number[]): Response {
  ctx.waitUntil(
    Promise.all([
      ...widths.map((w) => env.ART_CACHE.delete(cacheKey(path, w))),
      env.ART_CACHE.delete(metaKey(path)),
    ]).then(
      () => undefined,
      () => undefined,
    ),
  )
  return new Response('gone', {
    status: 410,
    headers: {
      'content-type': 'text/plain',
      // Never cached at the edge: the next request must re-read the denylist, so removing an entry
      // takes effect immediately and a stale 410 cannot outlive the decision.
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })
}

/**
 * The metadata half of the service: a read-through cache for a collection's JSON.
 *
 * No width, no resize, no variants — one document, one key. Everything else is the art path's
 * reasoning applied to a different content type: the denylist first so a denied work costs nothing,
 * one gateway at a time so one answer does not spend every operator's budget, and 502 when the
 * roster is silent so the app cools this service and falls back to asking the roster itself.
 */
async function serveMeta(
  path: string,
  env: Env,
  ctx: ExecutionContext,
  widths: readonly number[],
): Promise<Response> {
  if (denylistOf(env).has(cidOf(path))) return gone(env, ctx, path, widths)

  const key = metaKey(path)
  const hit = await env.ART_CACHE.get(key)
  if (hit !== null) return servedJson(await hit.text(), 'hit')

  const body = await fetchMetaFromRoster(path, rosterOf(env))
  if (body === null) return new Response('no gateway answered', { status: 502 })

  ctx.waitUntil(
    env.ART_CACHE.put(key, body, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    }).catch(() => {
      // A failed write is a miss next time. It is not a reason to fail this request.
    }),
  )
  return servedJson(body, 'miss')
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 })
    }

    const url = new URL(request.url)
    const ART = '/art/'
    const META = '/meta/'
    const prefix = url.pathname.startsWith(META) ? META : ART
    if (!url.pathname.startsWith(prefix)) return new Response('not found', { status: 404 })

    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!isSafePath(path)) return new Response('bad request', { status: 400 })

    const widths = widthsOf(env)

    if (prefix === META) return serveMeta(path, env, ctx, widths)

    // BEFORE the bucket read and before any gateway is asked, so a denied object costs nothing and
    // cannot be re-cached by the request that asks for it — the difference between a takedown and a
    // pause. Every rung goes and so does the metadata, because a takedown is about the work and not
    // about one representation of it.
    if (denylistOf(env).has(cidOf(path))) return gone(env, ctx, path, widths)

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

    const upstream = await fetchFromRoster(path, wanted, rosterOf(env))
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
