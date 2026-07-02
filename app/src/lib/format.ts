/** Small formatting helpers shared across components. Pure TS — no React/wagmi. */

/** Shorten a 0x address to `0x1234…abcd` for display. */
export function truncateAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/**
 * Format a fixed-point token amount to a display string capped at `maxFrac` fraction digits, with
 * trailing zeros trimmed (e.g. 4 → "1234.5678", "0.5", "12"). Full-precision 18-decimal values
 * otherwise overflow narrow panels (N2). Truncates toward zero — no rounding surprises on a quote.
 */
export function formatTokenAmount(value: bigint, decimals = 18, maxFrac = 4): string {
  const neg = value < 0n
  const abs = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  let frac = ''
  if (maxFrac > 0) {
    // Scale the fractional remainder down to `maxFrac` digits (truncating the rest).
    const scaled = (abs % base) / 10n ** BigInt(Math.max(0, decimals - maxFrac))
    frac = scaled.toString().padStart(maxFrac, '0').replace(/0+$/, '')
  }
  return `${neg ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`
}
