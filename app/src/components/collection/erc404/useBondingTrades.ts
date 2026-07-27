/**
 * useBondingTrades (W-B5) — indexes `BondingSale(user indexed, amount, cost, isBuy)` for one ERC404
 * bonding instance and derives a per-trade price = cost / amount (ETH per token). Mirrors the
 * event-read idiom in useMessageFeed / useBidHistory: public client + getContractEvents, fromBlock 0.
 *
 * Price is a float in ETH-per-token: both `cost` (wei) and `amount` (token base units, `decimals`)
 * are WAD-ish, so dividing the formatted values yields ETH/token directly. The chart only needs a
 * relative shape, so float precision is fine here (the on-chain quote path stays bigint).
 */
import { useQuery } from '@tanstack/react-query'
import { formatEther, formatUnits } from 'viem'
import { usePublicClient } from 'wagmi'
import { erc404BondingInstanceAbi } from '../../../generated/contracts'
import { deployBlock } from '../../../lib/addresses'
import { useCollectionChainId } from '../useCollectionChain'
import { scanBackward } from '../../../lib/logScan'
import type { Trade } from './candleAggregator'

export interface BondingTrade extends Trade {
  user: `0x${string}`
  isBuy: boolean
  /** Raw ETH cost (wei) of the trade. */
  cost: bigint
  /** Raw token amount (base units) of the trade. */
  amount: bigint
}

export function useBondingTrades(
  instance: `0x${string}`,
  decimals: number,
): { data: BondingTrade[]; isPending: boolean; isError: boolean } {
  const chainId = useCollectionChainId()
  const client = usePublicClient({ chainId })

  const { data, isPending, isError } = useQuery({
    queryKey: ['erc404-trades', instance, decimals],
    enabled: !!client,
    staleTime: 10_000,
    queryFn: async (): Promise<BondingTrade[]> => {
      if (!client) return []
      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: instance,
            abi: erc404BondingInstanceAbi,
            eventName: 'BondingSale',
            fromBlock,
            toBlock,
          }),
        { latest, floor: deployBlock },
      )

      const trades: BondingTrade[] = []
      for (const log of logs) {
        const { user, amount, cost, isBuy } = log.args
        if (
          user === undefined ||
          amount === undefined ||
          cost === undefined ||
          isBuy === undefined ||
          amount === 0n
        ) {
          continue
        }
        // ETH per token: cost (wei) / amount (token base units), both formatted to decimals.
        const price = Number(formatEther(cost)) / Number(formatUnits(amount, decimals))
        if (!Number.isFinite(price) || price <= 0) continue
        trades.push({
          user,
          amount,
          cost,
          isBuy,
          price,
          blockNumber: log.blockNumber,
        })
      }

      // Ascending by block for the aggregator (it re-sorts, but keep it natural).
      trades.sort((a, b) =>
        a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
      )
      return trades
    },
  })

  return { data: data ?? [], isPending, isError }
}
