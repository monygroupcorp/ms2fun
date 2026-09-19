/**
 * What a collector actually sees beside the ETH figure, and — the half that matters more — what they
 * see when the rate cannot be trusted.
 *
 * The whole point of the degrade path is that a wrong dollar number beside a price someone is about
 * to pay is worse than no dollar number, so every unusable-rate case is asserted to render NOTHING
 * rather than a fallback, a placeholder, or a last-known-good figure.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FiatAmount } from './FiatAmount'
import { MAX_RATE_AGE_SEC } from '../../lib/fiat'
import type { SupportedChainId } from '../../lib/addresses'

type Result = { status: 'success'; result: unknown } | { status: 'failure' }

const mockReads = vi.hoisted(() => vi.fn<() => { data: Result[] | undefined }>())
vi.mock('wagmi', () => ({ useReadContracts: mockReads }))

const ONE_ETH = 10n ** 18n
const NOW = 1_800_000_000n
/** $4,200.00 at 8 decimals. */
const ANSWER = 420_000_000_000n

const ok = (result: unknown): Result => ({ status: 'success', result })

/** Base — reachable in principle, but nothing here names an ETH/USD source on it. */
const UNSOURCED_CHAIN = 8453 as unknown as SupportedChainId
const failed: Result = { status: 'failure' }

/** The three reads `useEthUsdRate` batches: decimals, latestRoundData, chain clock. */
function reads(round: Result, clock: Result = ok(NOW), decimals: Result = ok(8)) {
  mockReads.mockReturnValue({ data: [decimals, round, clock] })
}

function roundAt(ageSec: number, answer = ANSWER): Result {
  return ok([1n, answer, NOW - BigInt(ageSec), NOW - BigInt(ageSec), 1n])
}

afterEach(() => {
  cleanup()
  mockReads.mockReset()
})

describe('with a fresh rate', () => {
  it('prints the dollar equivalent beside the amount', () => {
    reads(roundAt(60))
    render(<FiatAmount wei={ONE_ETH / 100n} chainId={1} data-testid="fiat" />)
    expect(screen.getByTestId('fiat')).toHaveTextContent('$42.00')
  })

  it('carries the named source and the round’s age as its title', () => {
    reads(roundAt(300))
    render(<FiatAmount wei={ONE_ETH} chainId={1} data-testid="fiat" />)
    expect(screen.getByTestId('fiat')).toHaveAttribute(
      'title',
      'Chainlink ETH/USD — $4,200.00 per ETH, updated 5 minutes ago',
    )
  })
})

describe('when the rate cannot be trusted, it renders nothing', () => {
  it('on a chain this app names no feed for', () => {
    reads(roundAt(60))
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={UNSOURCED_CHAIN} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('when the feed read failed', () => {
    reads(failed)
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('when the chain clock read failed, so the round’s age is unjudgeable', () => {
    reads(roundAt(60), failed)
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('when the last round is older than the ceiling', () => {
    reads(roundAt(MAX_RATE_AGE_SEC + 1))
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('when the feed reports a non-positive price', () => {
    reads(roundAt(60, 0n))
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('before any read has landed', () => {
    mockReads.mockReturnValue({ data: undefined })
    const { container } = render(<FiatAmount wei={ONE_ETH} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('when the amount itself has not resolved yet', () => {
    reads(roundAt(60))
    const { container } = render(<FiatAmount wei={undefined} chainId={1} />)
    expect(container).toBeEmptyDOMElement()
  })
})
