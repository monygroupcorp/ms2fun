import type { PublicClient } from 'viem'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { deployBlock, forkAddresses } from '../addresses'
import { scanBackward } from '../logScan'

/** One registry log, reduced to the fields the discovery index actually reads. */
interface RegistryEvent {
  kind: 'added' | 'revoked'
  instance: `0x${string}` | undefined
  blockNumber: bigint | null
  logIndex: number | null
}

/**
 * Scans `MasterRegistryV1.CreatorInstanceAdded` and `InstanceRevoked` and returns the ordered,
 * deduped list of instance addresses that are still registered, in discovery (chronological) order.
 *
 * Pass `creator` to narrow the added-event scan to one creator's instances; omit it for the whole
 * registry. Revocation is never narrowed: `InstanceRevoked(address indexed instance)` carries no
 * creator, so every revocation in range is collected and subtracted. Subtracting a superset is
 * correct — the extra addresses are not in this creator's added-set to begin with.
 *
 * Both events are read in ONE walk of the block range — each window fetches the added and the
 * revoked logs for that window — so the revoked set costs no extra range traversal.
 *
 * Reads via the shared reverse-windowed scanner (ADR-0010 Tier 1B): floored at our deploy block (not
 * `0n`/genesis) and split into cap-safe windows. `scanBackward` yields newest-window-first, so we
 * re-sort ascending by `(blockNumber, logIndex)` to restore discovery order before deduping.
 *
 * Revocation is subtracted, not annotated. The chain honours `revokeInstance` — `getInstanceInfo`
 * reverts `NotRegistered` afterwards — but `QueryAggregator._hydrateProject` wraps that read in a
 * tolerant `try/catch` while every other hydration step still answers from the instance itself. A
 * revoked collection therefore hydrates with an empty name and a zero creator and stays browsable:
 * the visible effect of a revocation would be to strip the attribution that identifies it, not to
 * remove it. Dropping the address here is what makes the moderation action mean what it says.
 *
 * Pure async function — no React, no hooks — so it runs from any context (React Query queryFn, Node
 * scripts, tests).
 */
async function scanLiveInstances(
  client: PublicClient,
  creator?: `0x${string}`,
): Promise<`0x${string}`[]> {
  const latest = await client.getBlockNumber()
  const events = await scanBackward<RegistryEvent>(
    async (fromBlock, toBlock) => {
      const [added, revoked] = await Promise.all([
        client.getContractEvents({
          address: forkAddresses.MasterRegistryV1,
          abi: masterRegistryV1Abi,
          eventName: 'CreatorInstanceAdded',
          ...(creator ? { args: { creator } } : {}),
          fromBlock,
          toBlock,
        }),
        client.getContractEvents({
          address: forkAddresses.MasterRegistryV1,
          abi: masterRegistryV1Abi,
          eventName: 'InstanceRevoked',
          fromBlock,
          toBlock,
        }),
      ])
      return [
        ...added.map((log) => ({
          kind: 'added' as const,
          instance: log.args.instance,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        })),
        ...revoked.map((log) => ({
          kind: 'revoked' as const,
          instance: log.args.instance,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        })),
      ]
    },
    { latest, floor: deployBlock },
  )

  // Restore chronological order (scanBackward returns newest window first).
  events.sort((a, b) => {
    const ba = a.blockNumber ?? 0n
    const bb = b.blockNumber ?? 0n
    if (ba !== bb) return ba < bb ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })

  const revoked = new Set<`0x${string}`>()
  const seen = new Set<`0x${string}`>()
  const instances: `0x${string}`[] = []
  for (const event of events) {
    const inst = event.instance
    if (!inst) continue
    if (event.kind === 'revoked') {
      revoked.add(inst)
      continue
    }
    if (!seen.has(inst)) {
      seen.add(inst)
      instances.push(inst)
    }
  }
  // A set subtraction, not a last-event-wins reduction: `revokeInstance` only ever sets
  // `revokedInstances[instance] = true` and the registry exposes no un-revoke, so a revocation is
  // terminal for that address however the logs happen to interleave.
  return revoked.size === 0 ? instances : instances.filter((inst) => !revoked.has(inst))
}

/** Every still-registered instance in the registry, in discovery order. */
export function scanAllInstances(client: PublicClient): Promise<`0x${string}`[]> {
  return scanLiveInstances(client)
}

/**
 * One creator's still-registered instances, in discovery order.
 *
 * Shares `scanLiveInstances` with the global index so the creator profile cannot drift back to
 * listing revoked collections: there is one scanner, and it subtracts revocations.
 */
export function scanCreatorInstances(
  client: PublicClient,
  creator: `0x${string}`,
): Promise<`0x${string}`[]> {
  return scanLiveInstances(client, creator)
}
