import type { PublicClient } from 'viem'
import { masterRegistryV1Abi } from '../../generated/contracts'
import { forkAddresses } from '../addresses'

/**
 * Block-range config for `scanAllInstances`.
 *
 * SINGLE_SHOT_ENABLED = true  → one `getContractEvents` call from block 0 to 'latest'.
 *   Correct for local Anvil forks and any RPC that supports unbounded log ranges (most archive
 *   nodes, Anvil, Hardhat).
 *
 * SINGLE_SHOT_ENABLED = false → chunked loop, CHUNK_SIZE blocks per request.
 *   Enable this for public RPC endpoints that cap eth_getLogs ranges (e.g. Alchemy free tier
 *   caps at 10 000 blocks, Infura at 10 000). Set CHUNK_SIZE to match the provider limit.
 *
 * ─── SEAM ──────────────────────────────────────────────────────────────────────────────────────
 * To switch to chunked mode: set SINGLE_SHOT_ENABLED = false and tune CHUNK_SIZE. The loop
 * skeleton below is already written — it just needs the `toBlock` for the current chain tip,
 * which callers have via `client.getBlockNumber()`. The single-shot branch is a strict subset
 * of the chunked approach (chunk size = ∞), so the output shape is identical.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
const SINGLE_SHOT_ENABLED = true
const CHUNK_SIZE = 10_000n // used only when SINGLE_SHOT_ENABLED = false

/**
 * Scans `MasterRegistryV1.CreatorInstanceAdded` from genesis to latest and returns the ordered,
 * deduped list of instance addresses. Discovery order (log order = chronological) is preserved.
 *
 * Pure async function — no React, no hooks — so it can be called from any context (React Query
 * queryFn, Node scripts, tests).
 */
export async function scanAllInstances(client: PublicClient): Promise<`0x${string}`[]> {
  const seen = new Set<`0x${string}`>()
  const instances: `0x${string}`[] = []

  if (SINGLE_SHOT_ENABLED) {
    // ── single-shot branch (default) ────────────────────────────────────────────────────────
    const logs = await client.getContractEvents({
      address: forkAddresses.MasterRegistryV1,
      abi: masterRegistryV1Abi,
      eventName: 'CreatorInstanceAdded',
      fromBlock: 0n,
      toBlock: 'latest',
    })

    for (const log of logs) {
      const inst = log.args.instance
      if (inst && !seen.has(inst)) {
        seen.add(inst)
        instances.push(inst)
      }
    }
  } else {
    // ── chunked branch (enable for public RPC range caps) ───────────────────────────────────
    const tip = await client.getBlockNumber()

    for (let from = 0n; from <= tip; from += CHUNK_SIZE) {
      const to = from + CHUNK_SIZE - 1n < tip ? from + CHUNK_SIZE - 1n : tip

      const logs = await client.getContractEvents({
        address: forkAddresses.MasterRegistryV1,
        abi: masterRegistryV1Abi,
        eventName: 'CreatorInstanceAdded',
        fromBlock: from,
        toBlock: to,
      })

      for (const log of logs) {
        const inst = log.args.instance
        if (inst && !seen.has(inst)) {
          seen.add(inst)
          instances.push(inst)
        }
      }
    }
  }

  return instances
}
