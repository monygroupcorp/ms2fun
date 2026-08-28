/** Small formatting helpers shared across components. Pure TS — no React/wagmi. */
import { formatEther, formatGwei } from 'viem'

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

/**
 * Wei threshold at which an adaptive price display switches from gwei to ETH (~1e-4 ETH). A
 * bonding-curve mint price sits well under it and reads as a clean whole gwei number; a graduated
 * market price sits well over it, where the same value in gwei is an eight-digit figure a reader
 * can't parse as a price at a glance.
 */
const PRICE_ETH_FLOOR = 10n ** 14n

/**
 * Adaptive-unit price display: ETH at or above `PRICE_ETH_FLOOR`, gwei below it — so one price
 * render reads legibly whether it's a fractional-gwei curve price or a full-ETH graduated price,
 * instead of a fixed unit picked per call site. Pair with `formatPriceTitle` for the full-
 * precision `title` attribute.
 */
export function formatPrice(value: bigint): string {
  return value >= PRICE_ETH_FLOOR
    ? `${formatTokenAmount(value, 18, 4)} ETH`
    : `${formatTokenAmount(value, 9, 4)} gwei`
}

/** Full-precision companion to `formatPrice` for a `title` attribute — same unit choice, no cap. */
export function formatPriceTitle(value: bigint): string {
  return value >= PRICE_ETH_FLOOR ? `${formatEther(value)} ETH` : `${formatGwei(value)} gwei`
}

const COMPACT_INT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * Compact whole-token-count display: an 18-decimal (or `decimals`) wei quantity → whole token
 * units, compacted (`3B`, `50B`) so a supply figure doesn't print all its raw digits.
 */
export function formatTokenCount(value: bigint, decimals = 18): string {
  const whole = value / 10n ** BigInt(decimals)
  return COMPACT_INT.format(whole)
}

/**
 * `ProjectCard.totalSupply`/`maxSupply` (QueryAggregator) are polymorphic by contract type:
 * ERC404 reports the DN404 fungible-scaled supply (18-decimal, one NFT = one unit — see
 * `erc404CardData`, `totalBondingSupply()`), ERC721/ERC1155 report a plain NFT/edition count (see
 * `erc721CardData`/`_hydrateERC1155CardData`). Compact-format only the ERC404 case — dividing an
 * ERC721/ERC1155 count by 1e18 would be wrong, so other types pass through unscaled.
 */
export function formatSupplyCount(value: bigint, contractType: string): string {
  return contractType === 'ERC404' ? formatTokenCount(value) : value.toString()
}

/** Full-precision companion to `formatSupplyCount` for a `title` attribute. */
export function formatSupplyCountTitle(value: bigint, contractType: string): string {
  return contractType === 'ERC404' ? formatTokenAmount(value) : value.toString()
}
