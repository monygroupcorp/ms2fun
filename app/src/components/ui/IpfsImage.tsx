/**
 * IpfsImage — an <img> that ROTATES IPFS gateways on load failure. resolveUri() only ever points at
 * gateway 0, so a single hung/timing-out gateway (common with public IPFS) leaves art blank. This
 * tries each candidate URL (custom gateway first, then the public set) in turn on `onError`, and
 * renders `fallback` only once every gateway has failed. The image analogue of fetchJson's race.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { resolveUriCandidates } from '../../lib/metadata'

/**
 * Session cache of the gateway URL that LOADED for a given pointer. Every <IpfsImage> starts at
 * gateway 0, so without this a thumbnail that rotated to a working gateway wouldn't share it — the
 * detail view would start over at gateway 0 and could fail even though the thumb rendered. Once any
 * instance loads a URL we pin it for that pointer, so all other instances (and revisits) skip
 * straight to the known-good gateway (also a browser-cache hit). Module-level = shared, per session.
 */
const loadedSrc = new Map<string, string>()

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
  className?: string
  /** Rendered when the URI is empty or every gateway failed. */
  fallback?: ReactNode
  loading?: 'lazy' | 'eager'
  /** data-testid for the <img> (the fallback node carries its own if the caller needs one). */
  testId?: string
}) {
  const candidates = useMemo(() => (uri.trim() ? resolveUriCandidates(uri) : []), [uri])
  const [idx, setIdx] = useState(() => startSrc(uri, candidates))

  // Re-seed from the cache whenever the pointer changes (component instances are reused).
  useEffect(() => {
    setIdx(startSrc(uri, candidates))
  }, [uri, candidates])

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
