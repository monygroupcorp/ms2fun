import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { globalMessageRegistryAbi, useReadGlobalMessageRegistryPostThreshold } from '../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../lib/addresses'
import { scanBackward } from '../lib/logScan'

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

export function useMessageFeed(filter: FeedFilter): {
  data: FeedMessage[] | undefined
  isPending: boolean
  isError: boolean
} {
  const client = usePublicClient({ chainId: forkChainId })

  const hasFilter = filter.instance !== undefined || filter.sender !== undefined

  const { data, isPending, isError } = useQuery({
    queryKey: ['message-feed', filter.instance ?? null, filter.sender ?? null],
    enabled: !!client && hasFilter,
    staleTime: 15_000,
    queryFn: async (): Promise<FeedMessage[]> => {
      if (!client) return []

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
        { latest, floor: deployBlock },
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
        messages.push({ messageId, instance, sender, messageType, refId, value: value ?? 0n, content })
      }

      // Newest first — sort by messageId descending
      messages.sort((a, b) => (a.messageId > b.messageId ? -1 : a.messageId < b.messageId ? 1 : 0))

      return messages
    },
  })

  return { data, isPending, isError }
}
