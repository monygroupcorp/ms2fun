/**
 * The ETH → USD rate behind every fiat figure the app prints, and the arithmetic that turns a wei
 * amount into one. Pure TS — no React/wagmi; the read lives in `./useEthUsd`.
 *
 * WHY A PRICE FEED AND NOT A PRICE API. A collector at a drop is quoted in ETH and has to convert in
 * their head; every live peer quotes both. The rate that fixes that has to come from somewhere this
 * app is allowed to go, and this client ships no API key and no server (`./rpc`, ADR-0010) — so a
 * keyed quote service is out on the same grounds the keyed RPC endpoints were. Chainlink's ETH/USD
 * aggregator is read over the transport already in use, needs no key, and — the part that decides it
 * — publishes the timestamp of its own last update, so staleness is a fact read off the answer
 * rather than a guess about when we last fetched.
 *
 * WHAT A FAILURE LOOKS LIKE. Nothing. Every path out of `deriveEthUsdRate` that is not a fresh,
 * positive answer is `unavailable`, and the surfaces render the ETH figure alone — the same figure
 * they rendered before any of this existed. A wrong dollar number beside a price someone is about to
 * pay is worse than no dollar number, so there is no fallback rate, no last-known-good, and no
 * constant to fall back to: a fallback that looks like a read is the defect this exists to remove
 * (the same rule `useGasPriceGwei` states for gas).
 */

/** Chainlink's `AggregatorV3Interface`, narrowed to the two views a rate needs. */
export const aggregatorV3Abi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

/**
 * Chainlink ETH/USD aggregator proxies, by chain id. Proxies, not the underlying aggregators: the
 * proxy address is stable across the aggregator upgrades Chainlink performs, which is the whole
 * reason it is published as the integration point.
 *
 *   1          Ethereum mainnet — the canonical ETH/USD feed.
 *   1337       the local anvil MAINNET fork (`./chains`), which carries mainnet's own state, so the
 *              mainnet proxy is live there at the same address. Whether its last round is still
 *              fresh depends on how old the fork is, and that is exactly what the staleness check
 *              below answers rather than assumes.
 *   11155111   Sepolia. The feed reports the real ETH/USD reference rate; Sepolia ETH is not that
 *              asset, so what the showcase prints is the reference price of one ETH and not a claim
 *              about what testnet ETH is worth.
 *
 * A chain absent from this map has no feed, and the surfaces there stay ETH-only. That is the
 * honest state for a chain nobody has named a source on — not a reason to borrow another chain's.
 */
export const ETH_USD_FEEDS: Record<number, `0x${string}`> = {
  1: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  1337: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  11155111: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
}

/** The ETH/USD feed for a chain, or `undefined` when this app names no source there. */
export function ethUsdFeedFor(chainId: number): `0x${string}` | undefined {
  return ETH_USD_FEEDS[chainId]
}

/**
 * How old the feed's last round may be before the rate is refused, in seconds.
 *
 * Chainlink publishes a one-hour heartbeat for ETH/USD — the aggregator writes a round at least
 * that often even when the price has not moved past its deviation threshold. Two heartbeats is the
 * ceiling because one missed round is an operational hiccup that should not blank a price the
 * visitor is reading, and two consecutive missed rounds is a feed nobody is maintaining on this
 * chain. Past it the rate is not used at all: an hours-old number is precisely the wrong number this
 * degrades away from.
 */
export const MAX_RATE_AGE_SEC = 2 * 60 * 60

/** One round of the feed, as read. */
export interface EthUsdRound {
  /** `latestRoundData().answer` — USD per ETH, scaled by `decimals`. */
  answer: bigint
  /** `decimals()` — 8 for every ETH/USD feed shipped to date, read rather than assumed. */
  decimals: number
  /** `latestRoundData().updatedAt` — a CHAIN timestamp, in unix seconds. */
  updatedAt: bigint
}

/** Why no rate is being shown. Each maps to one visible behaviour: the ETH figure, alone. */
export type RateUnavailableReason =
  /** This chain is not in {@link ETH_USD_FEEDS}. */
  | 'no-feed'
  /** The feed (or the chain clock it is judged against) did not read. */
  | 'unread'
  /** A zero or negative answer — the feed is in a broken state and is reporting no price. */
  | 'nonpositive'
  /** The last round is further from chain time than {@link MAX_RATE_AGE_SEC}. */
  | 'stale'

export type EthUsdRate =
  | { status: 'live'; answer: bigint; decimals: number; ageSec: number }
  | { status: 'unavailable'; reason: RateUnavailableReason }

/**
 * The rate, or the reason there isn't one.
 *
 * `chainNowSec` is the chain's own `block.timestamp`, read in the same batch as the round (see
 * `./useEthUsd`). Comparing a chain timestamp to the browser's wall clock would fold the visitor's
 * clock skew — and, on a time-advanced dev fork, hours of deliberate divergence — into a staleness
 * verdict about the feed. The two clocks compared here are the same clock.
 *
 * A round dated in the FUTURE is treated the same as one too far in the past: it is a disagreement
 * between the answer and the clock it was stamped by, and neither direction of that disagreement is
 * evidence the price is current.
 */
export function deriveEthUsdRate(
  round: EthUsdRound | undefined,
  chainNowSec: bigint | undefined,
): EthUsdRate {
  if (round === undefined || chainNowSec === undefined) {
    return { status: 'unavailable', reason: 'unread' }
  }
  if (round.answer <= 0n) return { status: 'unavailable', reason: 'nonpositive' }
  const ageSec = Number(chainNowSec - round.updatedAt)
  if (Math.abs(ageSec) > MAX_RATE_AGE_SEC) return { status: 'unavailable', reason: 'stale' }
  return { status: 'live', answer: round.answer, decimals: round.decimals, ageSec }
}

/** Micro-dollars per dollar — the fixed-point scale every USD figure here is carried in. */
const USD_SCALE = 1_000_000n

/**
 * A wei amount in micro-dollars at `rate`, truncated toward zero.
 *
 * Kept in bigint the whole way: `wei` is an 18-decimal quantity and the answer is another 8-decimal
 * one, so multiplying them as `number` loses the low end of a small mint price before it is ever
 * rounded for display. Micro-dollars is four orders of magnitude finer than the cent the display
 * shows, which leaves the rounding decision entirely to the formatter.
 */
export function usdMicrosFromWei(wei: bigint, rate: { answer: bigint; decimals: number }): bigint {
  return (wei * rate.answer * USD_SCALE) / (10n ** 18n * 10n ** BigInt(rate.decimals))
}

const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Above this, cents are noise on a price nobody reads to the cent. */
const USD_WHOLE_FLOOR = 10_000n * USD_SCALE

/**
 * Display form of a micro-dollar figure: `$0.54`, `$32.10`, `$18,204` — the shape the peer surfaces
 * print beside their crypto figure.
 *
 * A nonzero amount under half a cent renders `<$0.01` rather than `$0.00`: something was priced, and
 * rounding it to nothing on screen reads as free. A genuine zero still prints `$0.00`.
 */
export function formatUsdMicros(micros: bigint): string {
  const neg = micros < 0n
  const abs = neg ? -micros : micros
  const sign = neg ? '-' : ''
  if (abs > 0n && abs < USD_SCALE / 200n) return `${sign}<$0.01`
  const fmt = abs >= USD_WHOLE_FLOOR ? USD_WHOLE : USD_CENTS
  return `${sign}${fmt.format(Number(abs) / Number(USD_SCALE))}`
}

/** A wei amount as a display-ready USD string. */
export function formatUsdFromWei(wei: bigint, rate: { answer: bigint; decimals: number }): string {
  return formatUsdMicros(usdMicrosFromWei(wei, rate))
}

/** Whole minutes, rounded down — the resolution a rate's age is worth quoting at. */
function ageWords(ageSec: number): string {
  const mins = Math.floor(Math.abs(ageSec) / 60)
  if (ageSec < 0) return 'stamped ahead of chain time'
  if (mins < 1) return 'updated less than a minute ago'
  if (mins === 1) return 'updated 1 minute ago'
  return `updated ${mins} minutes ago`
}

/**
 * The provenance line that rides along as the `title` of every fiat figure: the named source, the
 * rate it resolved to, and how old that rate is. A dollar figure with no attribution is a number the
 * reader has no way to check, so the attribution travels with it.
 */
export function describeRate(rate: Extract<EthUsdRate, { status: 'live' }>): string {
  const perEth = formatUsdMicros(usdMicrosFromWei(10n ** 18n, rate))
  return `Chainlink ETH/USD — ${perEth} per ETH, ${ageWords(rate.ageSec)}`
}
