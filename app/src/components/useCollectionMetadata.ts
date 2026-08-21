import { useQuery } from '@tanstack/react-query'
import {
  fetchJson,
  isImmutableUri,
  isResolvableUri,
  parseCollection,
  type CollectionMetadata,
} from '../lib/metadata'

/** Revalidation window for MUTABLE (http/https) metadata pointers only. */
const MUTABLE_STALE_TIME = 5 * 60_000

/**
 * React-Query wrapper over the (framework-agnostic) metadata layer: resolve a collection's on-chain
 * `metadataURI` → fetch the JSON from IPFS/Arweave/data-URI → coerce to a safe shape. Returns
 * `undefined` while loading or when there's no resolvable URI; callers fall back to on-chain fields.
 */
export function useCollectionMetadata(uri: string | undefined): CollectionMetadata | undefined {
  const { data } = useQuery({
    queryKey: ['collection-metadata', uri],
    enabled: isResolvableUri(uri),
    // A content-addressed pointer (ipfs://, ar://, data:) names its own bytes: they cannot change,
    // so the cached value is valid permanently and a refetch could only re-buy what we hold — on
    // public gateways, out of the visitor's own per-IP quota. http(s):// pointers are mutable and
    // keep a finite staleTime; immutability must not leak onto them.
    staleTime: isImmutableUri(uri) ? Infinity : MUTABLE_STALE_TIME,
    queryFn: async ({ signal }) => parseCollection(await fetchJson(uri as string, signal)),
  })
  return data
}
