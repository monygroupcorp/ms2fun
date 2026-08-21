/**
 * IpfsImage — an <img> for content-addressed art.
 *
 * Two loading paths, chosen by what the pointer is and what the environment offers:
 *
 *  - **Shared path** (content-addressed pointer, plus an IntersectionObserver to schedule with or an
 *    `eager` caller): the bytes resolve through the per-CID art cache, so N components sharing one
 *    CID issue ONE request, a re-mount issues none, and a later visit is served from stored bytes
 *    rather than a gateway. Gateway rotation happens inside that loader, in the candidate order
 *    `resolveUriCandidates` gives.
 *  - **Native path** (mutable `http(s)://` pointers, or no IntersectionObserver available): the
 *    browser loads the URL directly and we ROTATE gateways on `onError`, trying each candidate in
 *    turn — a single hung/timing-out gateway must not leave art blank. Mutable URLs are never
 *    resolved through the immutable cache.
 *
 * `fallback` renders once the content is genuinely unavailable (or the pointer is unusable). A
 * THROTTLED pointer is not that: the gateways are refusing this browser for a while and the art
 * exists. Those two states render differently — a card that shows the same glyph for "this piece
 * has no art" and "come back in ten minutes" is telling the viewer something untrue about the work.
 *
 * Gateway ORDER comes from the health module: a gateway in cooldown is not asked at all, here or in
 * the art cache, because asking it is what keeps the cooldown from clearing.
 *
 * LAZY BY DEFAULT, and deliberately so: a 1000-item grid is survivable because the viewer scrolls
 * past a thousand thumbnails and actually looks at a few dozen, so that is the number of requests we
 * spend. Both paths honour it — the native path via the `loading` attribute, the shared path by not
 * fetching until the element approaches the viewport. Prefetching a screen ahead is intended;
 * prefetching a whole grid is what this avoids.
 *
 * SECURITY — art is rendered through `<img>` and ONLY through `<img>`, which does not execute
 * script even when the bytes are an SVG. Gateway-supplied bytes must never be inlined into the DOM:
 * no `dangerouslySetInnerHTML`, no `<object>`, no `<embed>`, no `<iframe>`, no inline `<svg>` built
 * from a fetched document — each of those turns a hostile gateway response into script running on
 * this origin. Inline SVG styling is the usual reason someone reaches for one of them; it is not
 * worth that trade.
 *
 * The pointer is re-checked against the URI allowlist here as well as at parse time, so a caller
 * that hands over a raw, unparsed metadata field is still bounded.
 *
 * `referrerPolicy="no-referrer"` on both render paths: remote art is permitted (see
 * ALLOW_REMOTE_HTTP_URIS), and a host the collection's author chose is fetched automatically as a
 * card scrolls into view. It cannot be denied the viewer's IP without a proxy we do not run, but it
 * has no business also learning WHICH collection page was being viewed.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  artFailureReason,
  isImmutableUri,
  loadArt,
  peekArt,
  resolveCandidates,
  resolveUriCandidates,
  retryAtFor,
  sanitizeImageUri,
  type ArtFailureReason,
} from '../../lib/metadata'
import styles from './IpfsImage.module.css'

/**
 * Session cache of the gateway URL that LOADED for a given pointer, for the native path. Every
 * <IpfsImage> starts at gateway 0, so without this a thumbnail that rotated to a working gateway
 * wouldn't share it — the detail view would start over at gateway 0 and could fail even though the
 * thumb rendered. Once any instance loads a URL we pin it for that pointer, so all other instances
 * (and revisits) skip straight to the known-good gateway (also a browser-cache hit).
 */
const loadedSrc = new Map<string, string>()

/** How far outside the viewport the shared path starts fetching: roughly a screen ahead. */
const PREFETCH_MARGIN = '600px'

/** 1×1 transparent GIF: gives the element a real box to observe before its bytes exist. */
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Renders in place of the art while gateways are refusing this browser — never the plain fallback. */
function ThrottledArt({
  className,
  testId,
}: {
  className?: string | undefined
  testId?: string | undefined
}) {
  return (
    <span
      className={[styles.throttled, className].filter(Boolean).join(' ')}
      role="img"
      aria-label="art temporarily unavailable — gateways are rate-limiting this browser"
      title="Public IPFS gateways are rate-limiting this browser. The art will load once the limit clears."
      data-testid={testId}
      data-state="throttled"
    >
      <span aria-hidden className={styles.throttledMark}>
        ⏳
      </span>
    </span>
  )
}

/** Best starting URL for `uri`: the cached known-good one if present, else the first candidate. */
function startSrc(uri: string, candidates: string[]): number {
  const cached = loadedSrc.get(uri)
  if (cached) {
    const i = candidates.indexOf(cached)
    if (i >= 0) return i
  }
  return 0
}

export function IpfsImage({
  uri,
  alt,
  className,
  fallback = null,
  loading = 'lazy',
  testId,
}: {
  uri: string
  alt: string
  // `| undefined` on the optionals: callers pass CSS-module classes, which are typed `string |
  // undefined`, and exactOptionalPropertyTypes rejects that against a bare `?: string`.
  className?: string | undefined
  /** Rendered when the URI is empty or every gateway failed. */
  fallback?: ReactNode
  loading?: 'lazy' | 'eager' | undefined
  /** data-testid for the <img> (the fallback node carries its own if the caller needs one). */
  testId?: string | undefined
}) {
  // Allowlist FIRST: everything below operates on the sanitized pointer, never the raw one.
  const safeUri = useMemo(() => sanitizeImageUri(uri), [uri])
  // EVERY URL this pointer could ever be served from — the test for "addressable at all".
  const addressable = useMemo(() => (safeUri ? resolveUriCandidates(safeUri) : []), [safeUri])
  // The URLs it is worth spending a request on right now: health-ordered, cooling gateways dropped.
  const candidates = useMemo(
    () => (safeUri ? resolveCandidates(safeUri).map((c) => c.url) : []),
    [safeUri],
  )
  // The shared cache is only correct for immutable pointers, and only schedules lazily when there
  // is an IntersectionObserver to schedule with; otherwise the browser's own lazy loading is used.
  const shared = useMemo(
    () =>
      isImmutableUri(safeUri) &&
      typeof fetch !== 'undefined' &&
      (loading === 'eager' || typeof IntersectionObserver !== 'undefined'),
    [safeUri, loading],
  )

  const [idx, setIdx] = useState(() => startSrc(safeUri, candidates))
  // Seeded from the resolved-content cache so a second mount of a known CID renders with no request.
  const [artSrc, setArtSrc] = useState<string | undefined>(() =>
    shared ? peekArt(safeUri) : undefined,
  )
  const [artFailure, setArtFailure] = useState<ArtFailureReason | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Re-seed from the caches whenever the pointer changes (component instances are reused).
  useEffect(() => {
    setIdx(startSrc(safeUri, candidates))
    setArtSrc(shared ? peekArt(safeUri) : undefined)
    setArtFailure(null)
  }, [safeUri, candidates, shared])

  useEffect(() => {
    if (!shared || artSrc !== undefined) return
    let cancelled = false

    const start = () => {
      loadArt(safeUri).then(
        (url) => {
          if (!cancelled) setArtSrc(url)
        },
        (err: unknown) => {
          if (!cancelled) setArtFailure(artFailureReason(err))
        },
      )
    }

    const el = imgRef.current
    if (loading === 'eager' || typeof IntersectionObserver === 'undefined' || !el) {
      start()
      return () => {
        cancelled = true
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect()
          start()
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    )
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [shared, artSrc, safeUri, loading])

  // Unusable pointer: nothing addresses it, so there is nothing to wait for.
  if (addressable.length === 0) return <>{fallback}</>
  // Addressable, but every gateway that could serve it is cooling: temporary, and it must say so.
  if (candidates.length === 0 && retryAtFor(safeUri) > 0) {
    return <ThrottledArt className={className} testId={testId} />
  }

  if (shared) {
    if (artFailure === 'throttled') return <ThrottledArt className={className} testId={testId} />
    if (artFailure !== null) return <>{fallback}</>
    return (
      <img
        ref={imgRef}
        src={artSrc ?? BLANK_PIXEL}
        alt={alt}
        className={className}
        loading={loading}
        referrerPolicy="no-referrer"
        data-testid={testId}
        data-pending={artSrc === undefined ? '' : undefined}
      />
    )
  }

  const src = candidates[idx]
  // Every candidate errored. An <img> reports no status, so the health map is what distinguishes a
  // rate limit from art that is simply not there.
  if (src === undefined) {
    return retryAtFor(safeUri) > 0 ? (
      <ThrottledArt className={className} testId={testId} />
    ) : (
      <>{fallback}</>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      referrerPolicy="no-referrer"
      data-testid={testId}
      // Pin the gateway that actually loaded so every other instance skips straight to it.
      onLoad={() => loadedSrc.set(safeUri, src)}
      // Advance to the next gateway; when they're exhausted idx passes the end → fallback renders.
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
