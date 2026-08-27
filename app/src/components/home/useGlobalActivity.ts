import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { globalMessageRegistryAbi } from '../../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../../lib/addresses'
import { scanBackward } from '../../lib/logScan'
import type { FeedMessage } from '../useMessageFeed'

/**
 * Home's own cache key. The invalidation PREFIX (`['message-feed']`) is shared with the board —
 * `BoardCartBar` invalidates that prefix on reply/react, and this query refetches along with it —
 * but the cache ENTRY under this exact key is not, and must never be. The board's `useGlobalFeed`
 * (BoardPage) is an infinite query caching `{ pages, pageParams }`; this is a plain query caching
 * `FeedMessage[]`. Two shapes under one key means whichever query populates the cache first
 * poisons the other's read — see noesis-422.
 */
export const homeActivityQueryKey = ['message-feed', 'global', 'preview'] as const

/**
 * Global activity feed for the home landing surface — every `MessagePosted` event across all
 * channels, newest first. Mirrors the board's `useGlobalFeed` (BoardPage) but lives here so the
 * home route doesn't import a route module. Read-only — no compose surface here; home links into
 * `/board` for that.
 */
export function useGlobalActivity(): {
  data: FeedMessage[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending, isError } = useQuery({
    queryKey: homeActivityQueryKey,
    enabled: !!client,
    staleTime: 15_000,
    queryFn: async (): Promise<FeedMessage[]> => {
      if (!client) return []

      // Home preview shows only the most-recent handful, so EARLY-STOP after a couple of windows
      // (ADR-0010 Tier 1B) — never scan to the floor for a preview.
      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: forkAddresses.GlobalMessageRegistry,
            abi: globalMessageRegistryAbi,
            eventName: 'MessagePosted',
            fromBlock,
            toBlock,
          }),
        { latest, floor: deployBlock, maxWindows: 2 },
      )

      const messages: FeedMessage[] = []
      for (const log of logs) {
        const { messageId, instance, sender, messageType, refId, value, content } = log.args
        if (
          messageId === undefined ||
          instance === undefined ||
          sender === undefined ||
          messageType === undefined ||
          refId === undefined ||
          content === undefined
        ) {
          continue
        }
        messages.push({
          messageId,
          instance,
          sender,
          messageType,
          refId,
          value: value ?? 0n,
          content,
        })
      }

      // Newest first — sort by messageId descending.
      messages.sort((a, b) => (a.messageId > b.messageId ? -1 : a.messageId < b.messageId ? 1 : 0))

      return messages
    },
  })

  return { data, isPending, isError }
}
