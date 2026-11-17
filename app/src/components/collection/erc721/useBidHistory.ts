/**
 * useBidHistory (W-B3) — indexes `BidPlaced(tokenId indexed, bidder indexed, amount)` for one
 * auction token, newest-first. Mirrors the event-read idiom in useMessageFeed (public client +
 * getContractEvents with an indexed-arg filter, fromBlock 0).
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc721AuctionInstanceAbi } from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { useInstanceFloor } from '../useInstanceFloor'
import { scanBackward } from '../../../lib/logScan'

export interface BidRecord {
  bidder: `0x${string}`
  amount: bigint
  blockNumber: bigint
}

export function useBidHistory(
  instance: `0x${string}`,
  tokenId: bigint | undefined,
): { data: BidRecord[]; isPending: boolean } {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })
  const floor = useInstanceFloor(instance, chainId)

  const { data, isPending } = useQuery({
    queryKey: ['erc721-bids', instance, tokenId?.toString() ?? null],
    enabled: !!client && tokenId !== undefined && floor !== undefined,
    staleTime: 10_000,
    // A failed walk is not retried here: react-query restarts the whole walk from its newest
    // window, and under a provider's rate limit that adds load where it is already refused.
    retry: false,
    queryFn: async (): Promise<BidRecord[]> => {
      if (!client || tokenId === undefined || floor === undefined) return []
      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            eventName: 'BidPlaced',
            args: { tokenId: Number(tokenId) },
            fromBlock,
            toBlock,
          }),
        { latest, floor },
      )

      const bids: BidRecord[] = []
      for (const log of logs) {
        const { bidder, amount } = log.args
        if (bidder === undefined || amount === undefined) continue
        bids.push({ bidder, amount, blockNumber: log.blockNumber })
      }
      // Newest first.
      bids.sort((a, b) =>
        a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
      )
      return bids
    },
  })

  return { data: data ?? [], isPending }
}
