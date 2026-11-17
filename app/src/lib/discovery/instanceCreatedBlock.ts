import type { PublicClient } from 'viem'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { addressesForChain, deployBlockForChain } from '../addresses'
import { scanBackward } from '../logScan'

/**
 * The block each collection was registered in, as discovery has already seen it. Every
 * `CreatorInstanceAdded` log the discovery scan reads carries it, and a collection's own events
 * cannot start before it, so it is the floor for that collection's history scans.
 */
const createdBlocks = new Map<string, bigint>()

const key = (chainId: number, instance: `0x${string}`) => `${chainId}:${instance.toLowerCase()}`

export function rememberInstanceCreatedBlock(
  chainId: number,
  instance: `0x${string}`,
  block: bigint,
): void {
  createdBlocks.set(key(chainId, instance), block)
}

/**
 * The block `instance` was registered in, which is where its own history begins.
 *
 * Answered from what discovery has already read when the visitor came through `/collections` or a
 * creator profile. On a direct visit it is one lookup: `CreatorInstanceAdded` indexes `instance`, so
 * a newest-first walk filtered to it stops at the first window that holds the log, which for a new
 * collection is the first window. Falls back to the protocol's deploy block when the registry has
 * no record of the address, which is the floor every scan used before.
 */
export async function findInstanceCreatedBlock(
  client: PublicClient,
  chainId: number,
  instance: `0x${string}`,
): Promise<bigint> {
  const known = createdBlocks.get(key(chainId, instance))
  if (known !== undefined) return known

  const floor = deployBlockForChain(chainId)
  const registry = addressesForChain(chainId)?.MasterRegistryV1
  if (!registry) return floor

  const latest = await client.getBlockNumber()
  const [added] = await scanBackward(
    (fromBlock, toBlock) =>
      client.getContractEvents({
        address: registry,
        abi: masterRegistryV1Abi,
        eventName: 'CreatorInstanceAdded',
        args: { instance },
        fromBlock,
        toBlock,
      }),
    { latest, floor, untilFound: true },
  )
  // Only a found block is remembered: a collection opened the moment it is created can be asked
  // about before the answering node has indexed its registration, and the next mount should look
  // again rather than keep the wide floor.
  if (added?.blockNumber == null) return floor
  rememberInstanceCreatedBlock(chainId, instance, added.blockNumber)
  return added.blockNumber
}
