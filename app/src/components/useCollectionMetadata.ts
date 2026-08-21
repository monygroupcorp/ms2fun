import { useQuery } from '@tanstack/react-query'
import {
  fetchJson,
  isResolvableUri,
  parseCollection,
  type CollectionMetadata,
} from '../lib/metadata'

/** What a collection's metadata fetch produced, with the reason a miss was a miss. */
export interface CollectionMetadataState {
  /** Parsed metadata, or undefined while loading / when there is no resolvable URI. */
  metadata: CollectionMetadata | undefined
  /**
   * True when the fetch could not be made because every gateway is rate-limiting this browser.
   * Distinct from "no metadata": the on-chain fallback is still the right thing to render, but a
   * surface must not present the collection as having no metadata when it could not be asked for.
   */
  throttled: boolean
  /** Epoch ms at which a gateway becomes askable again; null unless `throttled`. */
  readyAt: number | null
}

/**
 * React-Query wrapper over the (framework-agnostic) metadata layer: resolve a collection's on-chain
 * `metadataURI` → fetch the JSON from IPFS/Arweave/data-URI → coerce to a safe shape.
 *
 * Keeps the reason a fetch missed. On not-found the parsed shape is the empty one and callers fall
 * back to on-chain fields exactly as before; on a throttle the same fallback renders, but the flag
 * travels up so a surface can caption it as paused rather than as absent. The app-level notice reads
 * the shared gateway health directly, so nothing has to thread this flag to the shell.
 */
export function useCollectionMetadataState(uri: string | undefined): CollectionMetadataState {
  const { data } = useQuery({
    queryKey: ['collection-metadata', uri],
    enabled: isResolvableUri(uri),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const result = await fetchJson(uri as string, signal)
      return {
        metadata: parseCollection(result.status === 'found' ? result.data : null),
        throttled: result.status === 'throttled',
        readyAt: result.status === 'throttled' ? result.readyAt : null,
      }
    },
  })
  return data ?? { metadata: undefined, throttled: false, readyAt: null }
}

/** Metadata only — the shape every existing caller wants. */
export function useCollectionMetadata(uri: string | undefined): CollectionMetadata | undefined {
  return useCollectionMetadataState(uri).metadata
}
