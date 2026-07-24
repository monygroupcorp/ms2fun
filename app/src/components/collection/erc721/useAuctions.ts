/**
 * useAuctions (W-B3) — reads an ERC721 auction instance's config + the current active auction on
 * every parallel line. The instance runs `lines` independent auction queues; `getActiveAuction(line)`
 * gives the live tokenId per line (0 = none), and `getAuction(tokenId)` the full struct. We multicall
 * to keep it one round-trip per phase. State is derived by `deriveAuctionState` in the card, not here.
 */
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc721AuctionInstanceAbi } from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import type { AuctionView } from './auctionState'

export interface AuctionConfig {
  lines: number
  baseDuration: bigint
  timeBuffer: bigint
  bidIncrement: bigint
}

/** A live auction plus the line it sits on and its full struct fields (superset of AuctionView). */
export interface ActiveAuction extends AuctionView {
  line: number
  tokenId: bigint
  tokenURI: string
  minBid: bigint
  highBid: bigint
}

export interface AuctionsData {
  config: AuctionConfig
  auctions: ActiveAuction[]
}

export function useAuctions(instance: `0x${string}`): {
  data: AuctionsData | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
} {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['erc721-auctions', instance],
    enabled: !!client,
    staleTime: 10_000,
    queryFn: async (): Promise<AuctionsData> => {
      if (!client) throw new Error('no client')
      const base = { address: instance, abi: erc721AuctionInstanceAbi } as const

      const [lines, baseDuration, timeBuffer, bidIncrement] = await client.multicall({
        allowFailure: false,
        contracts: [
          { ...base, functionName: 'lines' },
          { ...base, functionName: 'baseDuration' },
          { ...base, functionName: 'timeBuffer' },
          { ...base, functionName: 'bidIncrement' },
        ],
      })

      const lineCount = Number(lines)
      const config: AuctionConfig = {
        lines: lineCount,
        baseDuration: BigInt(baseDuration),
        timeBuffer: BigInt(timeBuffer),
        bidIncrement: bidIncrement,
      }

      if (lineCount === 0) return { config, auctions: [] }

      // Active tokenId per line (0 = no live auction on that line).
      const activeIds = await client.multicall({
        allowFailure: true,
        contracts: Array.from({ length: lineCount }, (_, line) => ({
          ...base,
          functionName: 'getActiveAuction' as const,
          args: [line] as const,
        })),
      })

      const live: { line: number; tokenId: bigint }[] = []
      activeIds.forEach((r, line) => {
        if (r.status === 'success' && BigInt(r.result) !== 0n) {
          live.push({ line, tokenId: BigInt(r.result) })
        }
      })
      if (live.length === 0) return { config, auctions: [] }

      const structs = await client.multicall({
        allowFailure: true,
        contracts: live.map(({ tokenId }) => ({
          ...base,
          functionName: 'getAuction' as const,
          args: [Number(tokenId)] as const,
        })),
      })

      const auctions: ActiveAuction[] = []
      structs.forEach((r, i) => {
        if (r.status !== 'success') return
        const a = r.result
        const slot = live[i]
        if (!slot) return
        auctions.push({
          line: slot.line,
          tokenId: BigInt(a.tokenId),
          tokenURI: a.tokenURI,
          minBid: a.minBid,
          highBid: a.highBid,
          highBidder: a.highBidder,
          startTime: BigInt(a.startTime),
          endTime: BigInt(a.endTime),
          settled: a.settled,
        })
      })

      return { config, auctions }
    },
  })

  return { data, isPending, isError, refetch: () => void refetch() }
}
