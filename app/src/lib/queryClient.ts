import { QueryClient } from '@tanstack/react-query'
import { PERSIST_MAX_AGE } from './queryPersister'

/**
 * Single TanStack Query client — the only read-cache layer (wagmi reads flow through it).
 *
 * `gcTime` must be >= the persistence maxAge (ADR-0010): a query is only persisted/restored while it's
 * still in cache, so a short gcTime would evict entries before they can rehydrate on the next load.
 * Per-hook `staleTime` still governs when a restored value refetches.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: PERSIST_MAX_AGE,
    },
  },
})
