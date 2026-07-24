import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { addressesForChain, type Addresses, type SupportedChainId } from '../../lib/addresses'

interface CollectionChainContextValue {
  chainId: SupportedChainId
  addresses: Addresses
  slug: string
}

const CollectionChainContext = createContext<CollectionChainContextValue | undefined>(undefined)

/**
 * Scopes the collection subtree to one route-resolved `(chainId, slug)` pair. Mounted by the three
 * collection route pages (`CollectionPage`, `EditionDetailPage`, `TokenDetailPage`) AFTER slug
 * resolution succeeds, so every read inside passes the route's chain explicitly instead of the
 * module-level `forkChainId`/`forkAddresses` default (chain-scoped-slug-routes, noesis-079).
 */
export function CollectionChainProvider({
  chainId,
  slug,
  children,
}: {
  chainId: number
  slug: string
  children: ReactNode
}) {
  const addresses = addressesForChain(chainId)
  if (!addresses) {
    throw new Error(`CollectionChainProvider: no addresses for chain ${chainId}`)
  }
  // `addressesForChain` returning a hit IS the proof this chainId is one wagmi's `config` knows —
  // `addressesByChain` is only ever populated at `SupportedChainId` keys (see lib/addresses.ts).
  const supportedChainId = chainId as SupportedChainId
  const value = useMemo(
    () => ({ chainId: supportedChainId, addresses, slug }),
    [supportedChainId, addresses, slug],
  )
  return <CollectionChainContext.Provider value={value}>{children}</CollectionChainContext.Provider>
}

function useCollectionChainContext(): CollectionChainContextValue {
  const ctx = useContext(CollectionChainContext)
  if (!ctx) {
    throw new Error('useCollectionChain hooks must be used inside a <CollectionChainProvider>')
  }
  return ctx
}

export function useCollectionChainId(): SupportedChainId {
  return useCollectionChainContext().chainId
}

export function useCollectionAddresses(): Addresses {
  return useCollectionChainContext().addresses
}

export function useCollectionSlug(): string {
  return useCollectionChainContext().slug
}
