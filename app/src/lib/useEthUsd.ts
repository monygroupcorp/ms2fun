/**
 * The read behind {@link deriveEthUsdRate} — one multicall per chain, shared by every fiat figure on
 * the page through react-query's own de-duplication (same key, one request).
 *
 * THREE CALLS, ONE BATCH, ONE INSTANT. The feed's `decimals()` and `latestRoundData()` are read
 * alongside Multicall3's `getCurrentBlockTimestamp()`, so the clock the round's age is measured
 * against is the chain's own, sampled in the same call as the round itself. That is what lets the
 * staleness verdict be a fact rather than an estimate: no wall clock, no ticking timer re-rendering
 * every price on the page once a second, and no window in which the two values drifted apart.
 *
 * The verdict is therefore exactly as fresh as the rate, and both refresh together on `staleTime`.
 */
import { useReadContracts } from 'wagmi'
import { multicall3Abi } from 'viem'
import type { SupportedChainId } from './addresses'
import { SUPPORTED_CHAINS } from './chains'
import {
  aggregatorV3Abi,
  deriveEthUsdRate,
  ethUsdFeedFor,
  type EthUsdRate,
  type EthUsdRound,
} from './fiat'

/**
 * How long a fetched rate is served before it is re-read. Chainlink writes a round on a 0.5%
 * deviation or a one-hour heartbeat, whichever comes first; a minute is well inside either and keeps
 * the figure moving with the market without turning a page of prices into a poll loop.
 */
const RATE_STALE_TIME_MS = 60_000

/**
 * Placeholder address for the disabled case. `useReadContracts` builds its query key (and viem its
 * calldata) from the contracts array whether or not `enabled` is false, so the slot has to hold a
 * well-formed address even when nothing will be read from it — same reason `SwapPanel` keeps one for
 * its gated quote.
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** The Multicall3 deployment on a chain the app can reach, per its own chain definition. */
function multicall3For(chainId: number): `0x${string}` | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.contracts?.multicall3?.address
}

/**
 * The ETH/USD rate on `chainId`, or the reason there is none.
 *
 * Never throws and never suspends: a chain with no feed, a chain with no Multicall3, a failed read,
 * a broken answer and a stale round all arrive as `{ status: 'unavailable' }`, and the caller renders
 * its ETH figure alone. `retry: false` because a rate that needs three attempts to arrive is not
 * worth delaying a price behind — the next `staleTime` window tries again on its own.
 */
export function useEthUsdRate(chainId: SupportedChainId): EthUsdRate {
  const feed = ethUsdFeedFor(chainId)
  const multicall3 = multicall3For(chainId)
  const enabled = feed !== undefined && multicall3 !== undefined

  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: feed ?? ZERO_ADDRESS,
        abi: aggregatorV3Abi,
        functionName: 'decimals' as const,
        chainId,
      },
      {
        address: feed ?? ZERO_ADDRESS,
        abi: aggregatorV3Abi,
        functionName: 'latestRoundData' as const,
        chainId,
      },
      {
        address: multicall3 ?? ZERO_ADDRESS,
        abi: multicall3Abi,
        functionName: 'getCurrentBlockTimestamp' as const,
        chainId,
      },
    ],
    query: { enabled, staleTime: RATE_STALE_TIME_MS, retry: false },
  })

  if (feed === undefined) return { status: 'unavailable', reason: 'no-feed' }

  const decimalsResult = data?.[0]
  const roundResult = data?.[1]
  const clockResult = data?.[2]

  const round: EthUsdRound | undefined =
    decimalsResult?.status === 'success' && roundResult?.status === 'success'
      ? {
          decimals: Number(decimalsResult.result),
          // `latestRoundData` is a 5-tuple: [roundId, answer, startedAt, updatedAt, answeredInRound].
          answer: roundResult.result[1],
          updatedAt: roundResult.result[3],
        }
      : undefined

  const chainNowSec = clockResult?.status === 'success' ? clockResult.result : undefined

  return deriveEthUsdRate(round, chainNowSec)
}
