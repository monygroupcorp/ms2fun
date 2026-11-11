/**
 * What the collection page knows about a collection's hosted art: the art host's record of it
 * (graduated, migrated), and the migrated metadata root worked out here in the browser.
 *
 * The root is computed locally rather than taken from the host's `migrationCid`, because the
 * "verified on IPFS" badge is a claim this page makes to the visitor: the chain's base must equal
 * what the hosted metadata regenerates to, by a computation the visitor's own browser did.
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

/**
 * The migrated metadata for a hosted collection, computed in this browser from the host's copy of
 * the hosted metadata (every block checked against the hosted root's CID).
 *
 * That copy is a download of every piece's JSON, so it is fetched only when it can matter: for the
 * owner, who needs it to move the art, and for a visitor only once the collection's on-chain base
 * points at IPFS — before that, there is no move to verify.
 */
export function useMigration(status: HostingStatus | null | undefined, enabled: boolean) {
  const host = artHostBase()
  return useQuery({
    queryKey: ['art-migration', host, status?.imgCid, status?.metaCid],
    queryFn: async () => {
      // The UnixFS importer loads on first use: visitors to collections with no hosted art never
      // download it.
      const { migrationOf } = await import('../../lib/art/migrate')
      return migrationOf(host!, status!.imgCid, status!.metaCid)
    },
    enabled: enabled && host !== null && status != null,
    staleTime: Infinity,
  })
}
