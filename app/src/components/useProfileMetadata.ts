import { useQuery } from '@tanstack/react-query'
import { fetchJson, isResolvableUri, parseProfile, type ProfileMetadata } from '../lib/metadata'

/**
 * React-Query wrapper over the (framework-agnostic) metadata layer: resolve a profile's on-chain
 * `profileURI` → fetch the JSON from IPFS/Arweave/data-URI → coerce to a safe shape. Returns
 * `undefined` while loading or when there's no resolvable URI; callers fall back to on-chain fields.
 */
export function useProfileMetadata(uri: string | undefined): ProfileMetadata | undefined {
  const { data } = useQuery({
    queryKey: ['profile-metadata', uri],
    enabled: isResolvableUri(uri),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => parseProfile(await fetchJson(uri as string, signal)),
  })
  return data
}
