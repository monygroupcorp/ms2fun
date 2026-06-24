/**
 * useBidHistory (W-B3) — indexes `BidPlaced(tokenId indexed, bidder indexed, amount)` for one
 * auction token, newest-first. Mirrors the event-read idiom in useMessageFeed (public client +
 * getContractEvents with an indexed-arg filter, fromBlock 0).
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc721AuctionInstanceAbi } from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'

export interface BidRecord {
  bidder: `0x${string}`
  amount: bigint
  blockNumber: bigint
}

export function useBidHistory(
  instance: `0x${string}`,
  tokenId: bigint | undefined,
): { data: BidRecord[]; isPending: boolean } {
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending } = useQuery({
    queryKey: ['erc721-bids', instance, tokenId?.toString() ?? null],
    enabled: !!client && tokenId !== undefined,
    staleTime: 10_000,
    queryFn: async (): Promise<BidRecord[]> => {
      if (!client || tokenId === undefined) return []
      const logs = await client.getContractEvents({
        address: instance,
        abi: erc721AuctionInstanceAbi,
        eventName: 'BidPlaced',
        args: { tokenId: Number(tokenId) },
        fromBlock: 0n,
        toBlock: 'latest',
      })

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
