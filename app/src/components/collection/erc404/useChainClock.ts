/**
 * The chain's clock and the creator's, side by side, for the bonding schedule form.
 *
 * Reads the PENDING block's timestamp, because that is the time the next transaction is checked
 * against. The latest block can be stale: a dev chain that mines only on demand keeps returning the
 * block mined at the last transaction, while the next block takes the clock as it is now. A
 * provider that does not serve `pending` falls back to `latest`. Either way the result is never
 * earlier than the creator's wall clock, so a stale block can only make the form stricter.
 *
 * The chain-minus-wall offset is held between reads and the wall clock ticks it forward, so the
 * earliest allowed time keeps moving while the form sits open.
 */
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { SupportedChainId } from '../../../lib/addresses'

const wallSeconds = (): number => Math.floor(Date.now() / 1000)

export function useChainClock(
  chainId: SupportedChainId,
  { refreshMs = 15_000, tickMs = 5_000 } = {},
): { chainNow: number; wallNow: number; synced: boolean } {
  const client = usePublicClient({ chainId })
  const [offset, setOffset] = useState<number | undefined>(undefined)
  const [wallNow, setWallNow] = useState(wallSeconds)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    const sync = async (): Promise<void> => {
      let ts: bigint | undefined
      try {
        ts = (await client.getBlock({ blockTag: 'pending' })).timestamp
      } catch {
        try {
          ts = (await client.getBlock({ blockTag: 'latest' })).timestamp
        } catch {
          // keep the prior offset on a transient read failure
        }
      }
      if (!cancelled && ts !== undefined) setOffset(Math.max(0, Number(ts) - wallSeconds()))
    }
    void sync()
    const id = setInterval(() => void sync(), refreshMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [client, refreshMs])

  useEffect(() => {
    const id = setInterval(() => setWallNow(wallSeconds()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  return { chainNow: wallNow + (offset ?? 0), wallNow, synced: offset !== undefined }
}
