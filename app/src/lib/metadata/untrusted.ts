/**
 * Untrusted-content guards for the backend-free metadata model (ADR-0004).
 *
 * Two inputs reaching this app are chosen by someone else and must be treated as hostile:
 *
 *  1. **Collection/profile-authored URIs** — `image`, `banner_image`, `external_link`, `styleUri`
 *     are strings written by whoever deployed the collection. Anyone can deploy one.
 *  2. **What a public gateway returns** — a gateway is an untrusted intermediary and can answer any
 *     bytes for any CID, including an HTML interstitial where a PNG or a JSON document was asked
 *     for.
 *
 * This module holds the parse-time scheme allowlist for (1) and the response-shape guards for (2).
 * The allowlist is applied where the untrusted JSON is first coerced (`schemas.ts`) and again at the
 * render component, rather than at each call site — a per-call-site list only grows.
 */

/**
 * Whether a collection-authored URI may point at an arbitrary `http(s)` host.
 *
 * `true` (RULED BY rth 2026-08-21): accept `https://…` / `http://…` alongside the content-addressed
 * and inline schemes.
 *
 * The tracking channel is real — the pointer is fetched automatically as a card scrolls into view,
 * with no click, exposing the viewer's IP address, User-Agent and browsing time to a host the
 * collection's author chose. It is also the ordinary behaviour of every third-party `<img>` on the
 * web, and of every NFT marketplace. Marketplaces neutralise it by proxying art through a CDN they
 * own; that is precisely the infrastructure this platform refuses to run, so the choice here is
 * allow-or-break rather than allow-or-proxy.
 *
 * `false` breaks collections that legitimately host their own art, and strands `IpfsImage`'s native
 * loading path entirely — every remaining scheme is immutable and routes through the art cache, so
 * the mutable path becomes unreachable code.
 *
 * What we DO mitigate: `IpfsImage` sets `referrerPolicy="no-referrer"`, so a remote host learns that
 * someone fetched an image, not which collection page they were viewing. The IP cannot be hidden
 * without a proxy.
 *
 * If a stricter posture is ever wanted, the lever is CURATION — permit remote art for collections
 * that pass the alignment gate, reject it for arbitrary ones — not a warning banner the viewer
 * cannot act on.
 *
 * The choice is a product ruling, not a code detail; it is a single constant so the ruling is one
 * edit.
 */
export const ALLOW_REMOTE_HTTP_URIS = true

/** Content-addressed / inline schemes, always permitted. */
const CONTENT_ADDRESSED_RE = /^(ipfs:\/\/|ar:\/\/)/i
const HTTP_RE = /^https?:\/\//i
const DATA_RE = /^data:/i

/** `data:<media-type>[;…],<payload>` → the media type, lowercased (`''` when malformed). */
function dataMediaType(uri: string): string {
  const comma = uri.indexOf(',')
  if (comma === -1) return ''
  return uri.slice('data:'.length, comma).split(';')[0]?.trim().toLowerCase() ?? ''
}

/**
 * A root-relative, same-origin path (`/art/x.css`), which cannot reach another host. `//host/x` is
 * protocol-relative — a remote fetch wearing a path's clothes — and is NOT one of these.
 */
function isSameOriginPath(uri: string): boolean {
  return uri.startsWith('/') && !uri.startsWith('//')
}

/**
 * Core of the allowlist: return `uri` when its scheme is permitted for `mediaPrefix`-typed content,
 * else `''`. Callers treat `''` as "no pointer" and render their fallback.
 */
function sanitize(uri: string | undefined | null, mediaPrefix: string, allowPath: boolean): string {
  if (!uri) return ''
  const t = uri.trim()
  if (t === '') return ''
  if (CONTENT_ADDRESSED_RE.test(t)) return t
  if (DATA_RE.test(t)) return dataMediaType(t).startsWith(mediaPrefix) ? t : ''
  if (HTTP_RE.test(t)) return ALLOW_REMOTE_HTTP_URIS ? t : ''
  if (allowPath && isSameOriginPath(t)) return t
  // Everything else — javascript:, blob:, vbscript:, file:, unknown custom schemes, and bare
  // strings — is dropped. `javascript:` is inert inside `<img src>`, but these strings are one
  // refactor away from an `<a href>`, a CSS `url()` or an iframe, where it is not.
  return ''
}

/**
 * Allowlist a collection/profile-authored **image** pointer. `data:` is restricted to image media
 * types: a `data:text/html` in an `image` field has no honest use.
 */
export function sanitizeImageUri(uri: string | undefined | null): string {
  return sanitize(uri, 'image/', false)
}

/**
 * Allowlist a collection-authored **stylesheet** pointer (`styleUri`). Same scheme rules as an
 * image, with `data:` restricted to `text/css`, plus root-relative same-origin paths, which are
 * served by this app rather than by a host the author picked.
 */
export function sanitizeStyleUri(uri: string | undefined | null): string {
  return sanitize(uri, 'text/css', true)
}

/** Media types that mean "this is a document", i.e. never the asset we asked a gateway for. */
const DOCUMENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml)$/i

/** `Content-Type: text/html; charset=utf-8` → `text/html`. */
function mediaType(res: { headers: { get(name: string): string | null } }): string {
  return (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

/**
 * True when a gateway answered with an HTML/XML document. A challenge page, a rate-limit notice or
 * a directory listing all arrive this way, with a 200 status, in place of the requested bytes —
 * this is a failure of that gateway, not a missing CID, and callers should treat it as such (try
 * the next gateway) rather than reporting the content as absent.
 */
export function isDocumentResponse(res: {
  headers: { get(name: string): string | null }
}): boolean {
  return DOCUMENT_TYPE_RE.test(mediaType(res))
}

/**
 * True when a response actually claims to be an image. Stricter than {@link isDocumentResponse}
 * because it is used only where we control the fetch and can afford to demand a positive answer.
 *
 * It does NOT cover art rendering: art is fetched by the browser through `<img>` (see `IpfsImage`),
 * which never runs script, so the browser's own type handling plus the `img-src` policy in
 * `index.html` bound that path.
 */
export function isImageResponse(res: { headers: { get(name: string): string | null } }): boolean {
  return mediaType(res).startsWith('image/')
}

/** Upper bound on a gateway body we read ourselves. Metadata documents are kilobytes. */
export const MAX_RESPONSE_BYTES = 512 * 1024

/**
 * Read a response body as text with a hard cap, so a gateway cannot stream an unbounded body into
 * memory. Rejects on the declared `Content-Length` when there is one, and stops reading once the
 * decoded text passes the cap otherwise.
 */
export async function readCappedText(
  res: { headers: { get(name: string): string | null }; text(): Promise<string> },
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('gateway response exceeds the size cap')
  }
  const text = await res.text()
  if (text.length > maxBytes) throw new Error('gateway response exceeds the size cap')
  return text
}

/**
 * Strip `@import` rules from creator-supplied CSS. An `@import` pulls a stylesheet from any host the
 * author names — the same automatic-request tracking channel the URI allowlist closes, reopened
 * from inside the stylesheet. Best-effort text defence; the enforced bound is the `style-src` /
 * `img-src` / `font-src` policy in `index.html`.
 */
export function stripCssImports(css: string): string {
  return css.replace(/@import\b[^;]*(;|$)/gi, '')
}
