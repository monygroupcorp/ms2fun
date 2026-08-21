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
 * `fallback` renders only once every candidate has failed (or the pointer is unusable).
 *
 * LAZY BY DEFAULT, and deliberately so: a 1000-item grid is survivable because the viewer scrolls
 * past a thousand thumbnails and actually looks at a few dozen, so that is the number of requests we
 * spend. Both paths honour it — the native path via the `loading` attribute, the shared path by not
 * fetching until the element approaches the viewport. Prefetching a screen ahead is intended;
 * prefetching a whole grid is what this avoids.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { isImmutableUri, loadArt, peekArt, resolveUriCandidates } from '../../lib/metadata'

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
  const candidates = useMemo(() => (uri.trim() ? resolveUriCandidates(uri) : []), [uri])
  // The shared cache is only correct for immutable pointers, and only schedules lazily when there
  // is an IntersectionObserver to schedule with; otherwise the browser's own lazy loading is used.
  const shared = useMemo(
    () =>
      isImmutableUri(uri) &&
      typeof fetch !== 'undefined' &&
      (loading === 'eager' || typeof IntersectionObserver !== 'undefined'),
    [uri, loading],
  )

  const [idx, setIdx] = useState(() => startSrc(uri, candidates))
  // Seeded from the resolved-content cache so a second mount of a known CID renders with no request.
  const [artSrc, setArtSrc] = useState<string | undefined>(() =>
    shared ? peekArt(uri) : undefined,
  )
  const [artFailed, setArtFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // Re-seed from the caches whenever the pointer changes (component instances are reused).
  useEffect(() => {
    setIdx(startSrc(uri, candidates))
    setArtSrc(shared ? peekArt(uri) : undefined)
    setArtFailed(false)
  }, [uri, candidates, shared])

  useEffect(() => {
    if (!shared || artSrc !== undefined) return
    let cancelled = false

    const start = () => {
      loadArt(uri).then(
        (url) => {
          if (!cancelled) setArtSrc(url)
        },
        () => {
          if (!cancelled) setArtFailed(true)
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
  }, [shared, artSrc, uri, loading])

  if (candidates.length === 0) return <>{fallback}</>

  if (shared) {
    if (artFailed) return <>{fallback}</>
    return (
      <img
        ref={imgRef}
        src={artSrc ?? BLANK_PIXEL}
        alt={alt}
        className={className}
        loading={loading}
        data-testid={testId}
        data-pending={artSrc === undefined ? '' : undefined}
      />
    )
  }

  const src = candidates[idx]
  if (src === undefined) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      data-testid={testId}
      // Pin the gateway that actually loaded so every other instance skips straight to it.
      onLoad={() => loadedSrc.set(uri, src)}
      // Advance to the next gateway; when they're exhausted idx passes the end → fallback renders.
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
