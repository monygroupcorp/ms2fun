import { useEffect, useState } from 'react'

/** Current unix time in seconds (bigint), ticking every second — drives auction countdowns. */
export function useNowSec(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}
