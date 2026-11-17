import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import {
  globalMessageRegistryAbi,
  useReadGlobalMessageRegistryPostThreshold,
} from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { DEFAULT_LOG_WINDOW, scanBackward } from '../lib/logScan'
import { useInstanceFloor } from './collection/useInstanceFloor'

export interface FeedFilter {
  instance?: `0x${string}`
  sender?: `0x${string}`
}

export interface FeedMessage {
  messageId: bigint
  instance: `0x${string}`
  sender: `0x${string}`
  messageType: number
  refId: bigint
  /** ETH attached to the post (N12 spam lever). 0 for replies/reactions and older posts. */
  value: bigint
  content: string
}

/**
 * The on-chain post-value spam threshold (N12). The feed hides top-level posts whose attached `value`
 * is below it; raising it is an owner action (PlatformConfigPanel). Reads 0 until the query resolves,
 * so the default (and un-raised) state shows every post.
 */
export function usePostThreshold(): bigint {
  const { data } = useReadGlobalMessageRegistryPostThreshold({
    address: forkAddresses.GlobalMessageRegistry,
    chainId: forkChainId,
  })
  return data ?? 0n
}

/**
 * How far back a collection's comment feed reads, in blocks: about two weeks at 12 s blocks. Held
 * in blocks rather than windows so it covers the same span on a chain with a narrower window.
 */
const COLLECTION_FEED_DEPTH = 100_000n

const collectionFeedWindows = Number(
  (COLLECTION_FEED_DEPTH + DEFAULT_LOG_WINDOW - 1n) / DEFAULT_LOG_WINDOW,
)

export function useMessageFeed(filter: FeedFilter): {
  data: FeedMessage[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })
  // A collection's feed starts at its registration; a sender's spans the protocol.
  const floor = useInstanceFloor(filter.instance, forkChainId)

  const hasFilter = filter.instance !== undefined || filter.sender !== undefined

  const { data, isPending, isError } = useQuery({
    queryKey: ['message-feed', filter.instance ?? null, filter.sender ?? null],
    enabled: !!client && hasFilter && floor !== undefined,
    staleTime: 15_000,
    // A failed walk is not retried here: react-query restarts the whole walk from its newest
    // window, and under a provider's rate limit that adds load where it is already refused.
    retry: false,
    queryFn: async (): Promise<FeedMessage[]> => {
      if (!client || floor === undefined) return []

      const args: {
        instance?: `0x${string}`
        sender?: `0x${string}`
      } = {}
      if (filter.instance !== undefined) args.instance = filter.instance
      if (filter.sender !== undefined) args.sender = filter.sender

      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: forkAddresses.GlobalMessageRegistry,
            abi: globalMessageRegistryAbi,
            eventName: 'MessagePosted',
            args,
            fromBlock,
            toBlock,
          }),
        {
          latest,
          floor,
          // A collection's comment feed is a recency feed, like home's activity preview: it shows
          // the most recent COLLECTION_FEED_DEPTH blocks and does not walk to the floor.
          ...(filter.instance !== undefined ? { maxWindows: collectionFeedWindows } : {}),
        },
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

      // Newest first — sort by messageId descending
      messages.sort((a, b) => (a.messageId > b.messageId ? -1 : a.messageId < b.messageId ? 1 : 0))

      return messages
    },
  })

  return { data, isPending, isError }
}
