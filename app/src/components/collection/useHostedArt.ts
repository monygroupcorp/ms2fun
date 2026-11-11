/**
 * What the collection page knows about a collection's hosted art: the art host's record of it
 * (graduated, migrated), and the migrated metadata root worked out here in the browser from that record.
 *
 * The root is computed locally rather than taken from the host's `migrationCid`, because the
 * "verified on IPFS" badge is a claim this page makes to the visitor: the chain's base must equal
 * what the hosted images and the piece list regenerate to, by a computation the visitor's own
 * browser did.
 */
import { useQuery } from '@tanstack/react-query'

import { artHostBase, fetchHostingStatus, type HostingStatus } from '../../lib/art/hostClient'

/** The art host's record for this collection; undefined while loading or when there is none. */
export function useHostingStatus(instance: `0x${string}`) {
  const host = artHostBase()
  return useQuery({
    queryKey: ['art-hosting-status', host, instance.toLowerCase()],
    queryFn: () => fetchHostingStatus(host!, instance),
    enabled: host !== null,
    staleTime: 60_000,
    retry: 1,
  })
}

/** The migrated metadata root for a hosted collection, computed in this browser. */
export function useMigratedMetaCid(status: HostingStatus | null | undefined) {
  const pieces = status?.pieces ?? []
  return useQuery({
    // The two hosted roots fix the piece list (the metadata root names one file per piece), so they
    // identify the answer without putting thousands of names in the key.
    queryKey: ['art-migrated-cid', status?.imgCid, status?.metaCid, pieces.length],
    queryFn: async () => {
      // The UnixFS importer loads on first use: visitors to collections with no hosted art never
      // download it.
      const { migratedMetaCidOf } = await import('../../lib/art/migrate')
      return migratedMetaCidOf(status!.imgCid, pieces)
    },
    enabled: status != null && pieces.length > 0,
    staleTime: Infinity,
  })
}
