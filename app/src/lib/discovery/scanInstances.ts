import type { PublicClient } from 'viem'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { deployBlock, forkAddresses } from '../addresses'
import { scanBackward } from '../logScan'

/**
 * Scans `MasterRegistryV1.CreatorInstanceAdded` and returns the ordered, deduped list of instance
 * addresses in discovery (chronological) order.
 *
 * Reads via the shared reverse-windowed scanner (ADR-0010 Tier 1B): floored at our deploy block (not
 * `0n`/genesis) and split into cap-safe windows. `scanBackward` yields newest-window-first, so we
 * re-sort ascending by `(blockNumber, logIndex)` to restore discovery order before deduping.
 *
 * Pure async function — no React, no hooks — so it runs from any context (React Query queryFn, Node
 * scripts, tests).
 */
export async function scanAllInstances(client: PublicClient): Promise<`0x${string}`[]> {
  const latest = await client.getBlockNumber()
  const logs = await scanBackward(
    (fromBlock, toBlock) =>
      client.getContractEvents({
        address: forkAddresses.MasterRegistryV1,
        abi: masterRegistryV1Abi,
        eventName: 'CreatorInstanceAdded',
        fromBlock,
        toBlock,
      }),
    { latest, floor: deployBlock },
  )

  // Restore chronological order (scanBackward returns newest window first).
  logs.sort((a, b) => {
    const ba = a.blockNumber ?? 0n
    const bb = b.blockNumber ?? 0n
    if (ba !== bb) return ba < bb ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })

  const seen = new Set<`0x${string}`>()
  const instances: `0x${string}`[] = []
  for (const log of logs) {
    const inst = log.args.instance
    if (inst && !seen.has(inst)) {
      seen.add(inst)
      instances.push(inst)
    }
  }
  return instances
}
