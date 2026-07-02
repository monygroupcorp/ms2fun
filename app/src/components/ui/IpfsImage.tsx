/**
 * IpfsImage — an <img> that ROTATES IPFS gateways on load failure. resolveUri() only ever points at
 * gateway 0, so a single hung/timing-out gateway (common with public IPFS) leaves art blank. This
 * tries each candidate URL (custom gateway first, then the public set) in turn on `onError`, and
 * renders `fallback` only once every gateway has failed. The image analogue of fetchJson's race.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { resolveUriCandidates } from '../../lib/metadata'

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
  const [idx, setIdx] = useState(0)

  // Restart from the first gateway whenever the pointer changes (component instances are reused).
  useEffect(() => {
    setIdx(0)
  }, [uri])

  const src = candidates[idx]
  if (src === undefined) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      data-testid={testId}
      // Advance to the next gateway; when they're exhausted idx passes the end → fallback renders.
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
