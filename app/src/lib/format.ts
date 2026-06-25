/** Small formatting helpers shared across components. Pure TS — no React/wagmi. */

/** Shorten a 0x address to `0x1234…abcd` for display. */
export function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
