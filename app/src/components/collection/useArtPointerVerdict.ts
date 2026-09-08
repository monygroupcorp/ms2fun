/**
 * useArtPointerVerdict (noesis-384) — can this collection's own art be rendered at all?
 *
 * Two ways a collection ends up showing every viewer the fallback tile, and they need different
 * words: the pointer is a scheme the app refuses (`sanitizeImageUri` blanked it, recorded by
 * `parseCollection` as `refusedPointers`), or it is a perfectly good pointer that nothing serves any
 * more. The verdict reuses the shared seams — the allowlist decision made in `schemas.ts` and the
 * shared art path `loadArt` — rather than re-deriving either.
 */
import { useQuery } from '@tanstack/react-query'
import {
  artFailureReason,
  isImmutableUri,
  loadArt,
  type CollectionMetadata,
} from '../../lib/metadata'

export type ArtPointerVerdict =
  /** Nothing decided yet — metadata still loading, or the probe cannot answer. Say nothing. */
  | 'unknown'
  /** No art authored. Art is optional; this is not a defect. */
  | 'absent'
  /** Authored, and the scheme allowlist refuses it — no viewer will ever see it. */
  | 'refused'
  /** Addressable, but no gateway served it. */
  | 'unreachable'
  | 'ok'

export function useArtPointerVerdict(meta: CollectionMetadata | undefined): ArtPointerVerdict {
  const image = meta?.image ?? ''
  const refused = meta?.refusedPointers?.includes('image') ?? false

  // Only content-addressed pointers are probed. `loadArt` is the same path `IpfsImage` takes, so a
  // probe shares its cache and its gateway-health accounting instead of competing with it, and it
  // only handles immutable URIs. A mutable http(s) pointer is the creator's own host answering
  // live; we do not spend one of the viewer's gateway requests to second-guess it.
  const probe = !refused && isImmutableUri(image)

  const { data, isPending } = useQuery({
    queryKey: ['art-pointer-verdict', image],
    enabled: probe,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<'ok' | 'unreachable' | 'unknown'> => {
      try {
        await loadArt(image)
        return 'ok'
      } catch (err) {
        // `throttled` is about the viewer's own gateways cooling off, not about the pointer.
        // Reporting it as a broken pointer would send a creator to fix something that is not broken.
        return artFailureReason(err) === 'throttled' ? 'unknown' : 'unreachable'
      }
    },
  })

  if (meta === undefined) return 'unknown'
  if (refused) return 'refused'
  if (image === '') return 'absent'
  if (!probe) return 'ok'
  if (isPending) return 'unknown'
  return data ?? 'unknown'
}
