/**
 * IpfsImage — an <img> that ROTATES IPFS gateways on load failure. resolveUri() only ever points at
 * gateway 0, so a single hung/timing-out gateway (common with public IPFS) leaves art blank. This
 * tries each candidate URL in turn on `onError`, and renders `fallback` only once every gateway has
 * failed.
 *
 * The candidate list comes from `rankedUriCandidates`, which reads the same health record
 * `fetchJson` writes: the user's own gateway first, then whichever public gateways are not inside a
 * rate-limit window, most-recently-good first. A gateway that just refused the metadata layer is
 * therefore not asked for images either — the two layers kept separate notions of "working", and the
 * image half went on spending against a bucket the JSON half already knew was empty.
 *
 * A load error carries no status, so it cannot be attributed: an `<img>` cannot tell a `429` from a
 * `404`. This component therefore records SUCCESS (which is unambiguous) and never records a fault;
 * classification stays with `fetchJson`, which can read the response. When every gateway is cooling
 * there is nothing to try, and the throttled state renders distinctly from missing art — those are
 * different facts, and one glyph for both tells the viewer a piece does not exist when it does.
 */
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  gatewayHealthVersion,
  gatewayOfUrl,
  getIpfsGateways,
  noteGatewaySuccess,
  rankedUriCandidates,
  subscribeGatewayHealth,
} from '../../lib/metadata'
import styles from './IpfsImage.module.css'

/**
 * Session cache of the gateway URL that LOADED for a given pointer. Every <IpfsImage> starts at the
 * head of the ranked list, so without this a thumbnail that rotated to a working gateway wouldn't
 * share it — the detail view would start over and could fail even though the thumb rendered. Once
 * any instance loads a URL we pin it for that pointer, so all other instances (and revisits) skip
 * straight to the known-good URL (also a browser-cache hit). Module-level = shared, per session.
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

const THROTTLED_TITLE =
  'Public IPFS gateways are rate-limiting this browser. The artwork is still there — it will load again shortly.'

export function IpfsImage({
  uri,
  alt,
  className,
  fallback = null,
  throttledFallback,
  loading = 'lazy',
  testId,
}: {
  uri: string
  alt: string
  // `| undefined` on the optionals: callers pass CSS-module classes, which are typed `string |
  // undefined`, and exactOptionalPropertyTypes rejects that against a bare `?: string`.
  className?: string | undefined
  /** Rendered when the URI is empty or every gateway failed on this specific pointer. */
  fallback?: ReactNode
  /**
   * Rendered instead of `fallback` when the art could not be requested at all, because every gateway
   * is inside a rate-limit window. Defaults to a distinct marker so a throttled card never reads as
   * a card whose art is missing.
   */
  throttledFallback?: ReactNode
  loading?: 'lazy' | 'eager' | undefined
  /** data-testid for the <img> (the fallback node carries its own if the caller needs one). */
  testId?: string | undefined
}) {
  // Re-rank whenever health changes: a gateway leaving cooldown should let a stalled card retry.
  const health = useSyncExternalStore(
    subscribeGatewayHealth,
    gatewayHealthVersion,
    () => 0, // SSR: no health to read — the server render uses the roster as authored.
  )
  const ranked = useMemo(() => {
    // `health` is a version counter rather than an input: reading it here is what makes the ranking
    // recompute when a gateway is cooled or cleared elsewhere in the app.
    void health
    return uri.trim() ? rankedUriCandidates(uri) : { urls: [], readyAt: null }
  }, [uri, health])
  const candidates = ranked.urls
  const [idx, setIdx] = useState(() => startSrc(uri, candidates))

  // Re-seed from the cache whenever the pointer (or the ranking) changes — instances are reused.
  useEffect(() => {
    setIdx(startSrc(uri, candidates))
  }, [uri, candidates])

  const src = candidates[idx]
  if (src === undefined) {
    if (ranked.readyAt === null) return <>{fallback}</>
    if (throttledFallback !== undefined) return <>{throttledFallback}</>
    return (
      <span
        className={styles.throttled}
        data-testid="ipfs-throttled"
        title={THROTTLED_TITLE}
        aria-label="artwork paused — public gateways are rate-limiting this browser"
      >
        ⏳
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      data-testid={testId}
      onLoad={() => {
        // Pin the URL that actually loaded so every other instance skips straight to it, and credit
        // the gateway so the metadata layer starts there too.
        loadedSrc.set(uri, src)
        const base = gatewayOfUrl(src, getIpfsGateways())
        if (base !== null) noteGatewaySuccess(base)
      }}
      // Advance to the next gateway; when they're exhausted idx passes the end → fallback renders.
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
