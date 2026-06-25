/**
 * Current time in unix seconds (bigint), ANCHORED to the chain's `block.timestamp`.
 *
 * On a normal chain `block.timestamp` ≈ wall clock, so this equals `Date.now()`. On a dev fork whose
 * clock has been advanced (`evm_increaseTime` — the dev-chain deploy jumps +2h so seeded auction /
 * bonding states materialize), wall clock and chain time diverge. Auction/bonding state in the UI is
 * derived against this value while the CONTRACTS use `block.timestamp` — so anchoring here keeps the
 * UI consistent with the chain (an on-chain-ended auction reads as ended; a bid isn't offered then
 * reverted). We read the latest block once, hold the `chainTime − wallTime` offset, and tick every
 * second off the wall clock for a smooth countdown; the offset is re-anchored periodically.
 */
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { forkChainId } from '../addresses'

export function useChainNow(tickMs = 1_000): bigint {
  const client = usePublicClient({ chainId: forkChainId })
  const [offset, setOffset] = useState<bigint>(0n) // chainSeconds − wallSeconds

  useEffect(() => {
    if (!client) return
    let cancelled = false
    const sync = async (): Promise<void> => {
      try {
        const block = await client.getBlock({ blockTag: 'latest' })
        if (!cancelled) setOffset(block.timestamp - BigInt(Math.floor(Date.now() / 1000)))
      } catch {
        // keep the prior offset on a transient read failure
      }
    }
    void sync()
    const id = setInterval(() => void sync(), 12_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [client])

  const [wall, setWall] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const id = setInterval(() => setWall(BigInt(Math.floor(Date.now() / 1000))), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  return wall + offset
}
