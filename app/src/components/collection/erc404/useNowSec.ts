/**
 * A ticking unix-seconds clock (bigint) for phase derivation + countdowns. Ticks once per second so
 * the `preopen → bonding` transition and the countdown stay live without manual refetch.
 */
import { useEffect, useState } from 'react'

export function useNowSec(tickMs = 1_000): bigint {
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const id = setInterval(() => {
      setNow(BigInt(Math.floor(Date.now() / 1000)))
    }, tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return now
}
